import 'server-only';
import { db } from '@/lib/db';
import { audienceMatches, workerFacts, type Audience } from '@/lib/audience';
import { addDays, startOfUTCDay } from '@/lib/format';
import { createTask } from '@/lib/tasks';

/**
 * Compliance engine (§46, §76). Rules are DATA, not code: jurisdiction,
 * authoritative source, applicability, deadline calculation, severity and
 * review dates all live in the ComplianceRule table so HR can update them as
 * laws change without a deploy.
 *
 * FSW People surfaces obligations and tracks evidence. It does not make legal
 * determinations — rules carry a source URL and a review date so a human owner
 * verifies them.
 */

export interface DeadlineRule {
  anchor: 'HIRE_DATE' | 'TERMINATION_DATE' | 'DOCUMENT_EXPIRY' | 'FIXED_DATE';
  offsetDays?: number;
  fixedDate?: string;
}

function computeDue(rule: DeadlineRule, worker: { hireDate: Date | null; terminationDate: Date | null }): Date | null {
  switch (rule.anchor) {
    case 'HIRE_DATE':
      return worker.hireDate ? addDays(worker.hireDate, rule.offsetDays ?? 0) : null;
    case 'TERMINATION_DATE':
      return worker.terminationDate ? addDays(worker.terminationDate, rule.offsetDays ?? 0) : null;
    case 'FIXED_DATE':
      return rule.fixedDate ? new Date(rule.fixedDate) : null;
    default:
      return null;
  }
}

/**
 * Materialize compliance items for every active rule × matching worker.
 * Idempotent: an open/completed item for the same rule+worker is never
 * duplicated. Returns the number of newly created items.
 */
export async function syncComplianceItems(): Promise<number> {
  const rules = await db.complianceRule.findMany({ where: { status: 'ACTIVE' } });
  const workers = await db.worker.findMany({
    where: { deletedAt: null, status: { notIn: ['TERMINATED'] } },
    select: { id: true, hireDate: true, terminationDate: true, legalFirstName: true, preferredName: true, lastName: true },
  });
  let created = 0;

  for (const rule of rules) {
    for (const worker of workers) {
      const facts = await workerFacts(worker.id);
      if (!facts || !audienceMatches(rule.appliesTo as Audience, facts)) continue;

      const existing = await db.complianceItem.findFirst({
        where: { ruleId: rule.id, workerId: worker.id },
      });
      if (existing) continue;

      const dueDate = computeDue(rule.deadlineRule as unknown as DeadlineRule, worker);
      const name = `${worker.preferredName || worker.legalFirstName} ${worker.lastName}`;
      const item = await db.complianceItem.create({
        data: {
          ruleId: rule.id,
          workerId: worker.id,
          title: `${rule.name} — ${name}`,
          dueDate,
          status: dueDate && dueDate < startOfUTCDay() ? 'OVERDUE' : 'OPEN',
        },
      });
      created++;

      // High/critical items also get a real task so they appear in someone's queue.
      if (rule.severity === 'HIGH' || rule.severity === 'CRITICAL') {
        const task = await createTask({
          title: item.title,
          description: `${rule.description}\n\nSource: ${rule.source ?? 'n/a'} ${rule.sourceUrl ?? ''}\nVerify this requirement with HR/legal/payroll before relying on it.`,
          category: 'COMPLIANCE',
          workerId: worker.id,
          ownerRoleKey: rule.ownerRoleKey,
          dueDate,
          priority: rule.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
          sourceType: 'COMPLIANCE',
          sourceId: rule.id,
          notify: false,
        });
        await db.complianceItem.update({ where: { id: item.id }, data: { taskId: task.id } });
      }
    }
  }

  // Refresh overdue flags
  await db.complianceItem.updateMany({
    where: { status: 'OPEN', dueDate: { lt: startOfUTCDay() } },
    data: { status: 'OVERDUE' },
  });

  return created;
}

/**
 * Retention: compute the earliest permitted destruction date for a record.
 * The system calculates eligibility but never destroys anything on its own —
 * permanent deletion requires explicit approval by a retention admin (§47).
 */
export async function retentionEligibility(): Promise<
  {
    policyId: string;
    recordType: string;
    jurisdiction: string;
    retainYears: number;
    eligible: { workerId: string; name: string; anchorDate: Date; destroyAfter: Date }[];
  }[]
> {
  const policies = await db.retentionPolicy.findMany({ where: { active: true } });
  const terminated = await db.worker.findMany({
    where: { status: 'TERMINATED', terminationDate: { not: null } },
    select: { id: true, legalFirstName: true, preferredName: true, lastName: true, terminationDate: true, hireDate: true, createdAt: true },
  });
  const now = new Date();

  return policies.map((p) => {
    const years = Number(p.retainYears);
    const eligible = terminated
      .map((w) => {
        const anchorDate =
          p.anchor === 'TERMINATION' ? w.terminationDate! : p.anchor === 'HIRE' ? (w.hireDate ?? w.createdAt) : w.createdAt;
        const destroyAfter = new Date(anchorDate);
        destroyAfter.setUTCFullYear(destroyAfter.getUTCFullYear() + Math.floor(years));
        destroyAfter.setUTCMonth(destroyAfter.getUTCMonth() + Math.round((years % 1) * 12));
        return {
          workerId: w.id,
          name: `${w.preferredName || w.legalFirstName} ${w.lastName}`,
          anchorDate,
          destroyAfter,
        };
      })
      .filter((e) => e.destroyAfter <= now);
    return {
      policyId: p.id,
      recordType: p.recordType,
      jurisdiction: p.jurisdiction,
      retainYears: years,
      eligible,
    };
  });
}
