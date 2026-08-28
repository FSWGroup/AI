import 'server-only';
import { db } from '@/lib/db';
import { median } from '@/lib/analytics/workforce';

/**
 * Compensation planning cycles.
 *
 * Merit planning normally happens in a spreadsheet and gets re-typed into the
 * HRIS afterwards, which is where errors and unapproved increases come from.
 * Here the proposal *is* the record: budget is delegated down the org,
 * managers propose against it, the roll-up is live, and applying an approved
 * cycle writes one effective-dated Compensation row per worker.
 *
 * Two rules the code enforces rather than trusts:
 *   - Only an APPROVED proposal is ever applied.
 *   - Applying is idempotent. A proposal already marked APPLIED is skipped,
 *     so a double click or a retried job cannot pay someone twice.
 */

export interface BudgetRollUp {
  managerId: string;
  budget: number;
  proposed: number;
  remaining: number;
  overBudget: boolean;
  proposalCount: number;
  submittedCount: number;
}

export function annualise(amount: number, rateType: string): number {
  return rateType === 'HOURLY' ? amount * 2080 : rateType === 'MONTHLY' ? amount * 12 : amount;
}

/** Increase as a percentage, to three decimals. Null when there is no proposal. */
export function increasePct(current: number, proposed: number | null): number | null {
  if (proposed === null || current <= 0) return null;
  return Math.round(((proposed - current) / current) * 100 * 1000) / 1000;
}

/**
 * Budget consumption per manager. Proposals in DRAFT count against the budget
 * as well as submitted ones — a manager needs to see the effect of what they
 * are typing, not only of what they have sent.
 */
export async function budgetRollUp(cycleId: string): Promise<BudgetRollUp[]> {
  const [budgets, proposals, employments] = await Promise.all([
    db.compCycleBudget.findMany({ where: { cycleId } }),
    db.compProposal.findMany({
      where: { cycleId, status: { not: 'REJECTED' } },
      select: { workerId: true, currentAmount: true, proposedAmount: true, rateType: true, status: true },
    }),
    db.employmentRecord.findMany({
      where: { effectiveTo: null },
      select: { workerId: true, managerId: true },
    }),
  ]);
  const managerOf = new Map(employments.map((e) => [e.workerId, e.managerId]));

  const rows = new Map<string, BudgetRollUp>();
  for (const b of budgets) {
    rows.set(b.managerId, {
      managerId: b.managerId,
      budget: Number(b.amount),
      proposed: 0,
      remaining: Number(b.amount),
      overBudget: false,
      proposalCount: 0,
      submittedCount: 0,
    });
  }

  for (const p of proposals) {
    const managerId = managerOf.get(p.workerId);
    if (!managerId) continue;
    const row = rows.get(managerId) ?? {
      managerId,
      budget: 0,
      proposed: 0,
      remaining: 0,
      overBudget: false,
      proposalCount: 0,
      submittedCount: 0,
    };
    const current = annualise(Number(p.currentAmount), p.rateType);
    const proposed = p.proposedAmount === null ? current : annualise(Number(p.proposedAmount), p.rateType);
    row.proposed += Math.max(0, proposed - current);
    row.proposalCount += 1;
    if (p.status !== 'DRAFT') row.submittedCount += 1;
    rows.set(managerId, row);
  }

  return [...rows.values()].map((row) => ({
    ...row,
    proposed: Math.round(row.proposed * 100) / 100,
    remaining: Math.round((row.budget - row.proposed) * 100) / 100,
    overBudget: row.proposed > row.budget,
  }));
}

/**
 * Build the proposal set for a cycle from its eligibility rules. Existing
 * proposals are never overwritten — re-running this only adds people who have
 * become eligible since.
 */
export async function populateCycle(cycleId: string): Promise<number> {
  const cycle = await db.compCycle.findUniqueOrThrow({ where: { id: cycleId } });
  const rules = (cycle.eligibility ?? {}) as {
    legalEntityIds?: string[];
    departmentIds?: string[];
    workerTypes?: string[];
    minTenureMonths?: number;
  };

  const workers = await db.worker.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      ...(rules.workerTypes?.length ? { workerType: { in: rules.workerTypes as never[] } } : {}),
      employments: {
        some: {
          effectiveTo: null,
          ...(rules.legalEntityIds?.length ? { legalEntityId: { in: rules.legalEntityIds } } : {}),
          ...(rules.departmentIds?.length ? { departmentId: { in: rules.departmentIds } } : {}),
        },
      },
    },
    select: {
      id: true,
      hireDate: true,
      compensations: {
        where: { effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
        take: 1,
        select: { amount: true, currency: true, rateType: true },
      },
    },
  });

  const minTenure = rules.minTenureMonths ?? 0;
  const cutoff = new Date(Date.now() - minTenure * 30.44 * 86_400_000);
  const existing = new Set(
    (await db.compProposal.findMany({ where: { cycleId }, select: { workerId: true } })).map((p) => p.workerId),
  );

  let created = 0;
  for (const w of workers) {
    if (existing.has(w.id)) continue;
    const comp = w.compensations[0];
    if (!comp) continue; // nothing to raise from
    if (minTenure > 0 && (!w.hireDate || w.hireDate > cutoff)) continue;
    await db.compProposal.create({
      data: {
        cycleId,
        workerId: w.id,
        currentAmount: comp.amount,
        currency: comp.currency,
        rateType: comp.rateType,
      },
    });
    created += 1;
  }
  return created;
}

export interface ApplyResult {
  applied: number;
  skipped: number;
}

/**
 * Write approved proposals to compensation history.
 *
 * Effective dating is respected: the current row is closed the day before the
 * cycle's effective date and a new row opened, so the history stays a
 * continuous timeline rather than an overwrite.
 */
export async function applyCycle(cycleId: string, actorUserId: string): Promise<ApplyResult> {
  const cycle = await db.compCycle.findUniqueOrThrow({ where: { id: cycleId } });
  if (cycle.status !== 'APPROVED') {
    throw new Error('Only an approved cycle can be applied.');
  }
  const proposals = await db.compProposal.findMany({
    where: { cycleId, status: 'APPROVED' },
  });

  let applied = 0;
  let skipped = 0;
  const effectiveFrom = cycle.effectiveDate;
  const dayBefore = new Date(effectiveFrom.getTime() - 86_400_000);

  for (const proposal of proposals) {
    // Idempotency: a proposal that already landed is never applied twice.
    if (proposal.appliedAt) {
      skipped += 1;
      continue;
    }
    if (proposal.proposedAmount === null) {
      skipped += 1;
      continue;
    }
    await db.$transaction(async (tx) => {
      await tx.compensation.updateMany({
        where: { workerId: proposal.workerId, effectiveTo: null },
        data: { effectiveTo: dayBefore },
      });
      await tx.compensation.create({
        data: {
          workerId: proposal.workerId,
          amount: proposal.proposedAmount!,
          currency: proposal.currency,
          rateType: proposal.rateType,
          reason: proposal.reason,
          note: proposal.justification ?? `Comp cycle: ${cycle.name}`,
          effectiveFrom,
          approvedById: proposal.decidedById ?? actorUserId,
        },
      });
      await tx.compProposal.update({
        where: { id: proposal.id },
        data: { status: 'APPLIED', appliedAt: new Date() },
      });
    });
    applied += 1;
  }

  await db.compCycle.update({
    where: { id: cycleId },
    data: { status: 'APPLIED', appliedAt: new Date(), appliedById: actorUserId },
  });
  return { applied, skipped };
}

// ---------------------------------------------------------------------------
// Pay equity
// ---------------------------------------------------------------------------

export interface EquityGroup {
  jobFamily: string;
  jobLevel: string;
  geography: string;
  headcount: number;
  medianCompaRatio: number | null;
  minCompaRatio: number | null;
  maxCompaRatio: number | null;
  /** Highest ÷ lowest pay inside the same family and level. */
  spread: number | null;
  belowMinimum: number;
}

/**
 * Pay dispersion within a job family and level.
 *
 * This deliberately reports on the *role*, not on people. A wide spread inside
 * one level is the thing worth investigating — it is where unexplained pay
 * differences live — and it can be published to a comp committee without
 * disclosing anybody's pay.
 *
 * It is not a legal pay-equity audit. A defensible audit is run by counsel,
 * controls for legitimate factors, and is usually privileged. This surfaces
 * where to look.
 */
export async function payEquityGroups(): Promise<EquityGroup[]> {
  const [workers, bands] = await Promise.all([
    db.worker.findMany({
      where: { status: { in: ['ACTIVE', 'ON_LEAVE'] }, deletedAt: null },
      select: {
        country: true,
        employments: { where: { effectiveTo: null }, take: 1, select: { jobFamily: true, jobLevel: true } },
        compensations: {
          where: { effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          select: { amount: true, rateType: true },
        },
      },
    }),
    db.salaryBand.findMany(),
  ]);

  const groups = new Map<string, { ratios: number[]; amounts: number[]; belowMin: number; band: (typeof bands)[number] }>();
  for (const w of workers) {
    const e = w.employments[0];
    const c = w.compensations[0];
    if (!e?.jobFamily || !e.jobLevel || !c) continue;
    const geography = w.country === 'PH' ? 'PH' : 'US';
    const band = bands.find((b) => b.jobFamily === e.jobFamily && b.jobLevel === e.jobLevel && b.geography === geography);
    if (!band) continue;
    const annual = annualise(Number(c.amount), c.rateType);
    const mid = Number(band.midAmount);
    if (mid <= 0) continue;
    const key = `${e.jobFamily}|${e.jobLevel}|${geography}`;
    const group = groups.get(key) ?? { ratios: [], amounts: [], belowMin: 0, band };
    group.ratios.push(annual / mid);
    group.amounts.push(annual);
    if (annual < Number(band.minAmount)) group.belowMin += 1;
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, g]) => {
      const [jobFamily, jobLevel, geography] = key.split('|');
      const min = Math.min(...g.amounts);
      const max = Math.max(...g.amounts);
      return {
        jobFamily,
        jobLevel,
        geography,
        headcount: g.amounts.length,
        medianCompaRatio: round3(median(g.ratios)),
        minCompaRatio: round3(Math.min(...g.ratios)),
        maxCompaRatio: round3(Math.max(...g.ratios)),
        // A single person in a level has no spread to report.
        spread: g.amounts.length > 1 && min > 0 ? Math.round((max / min) * 1000) / 1000 : null,
        belowMinimum: g.belowMin,
      };
    })
    .sort((a, b) => (b.spread ?? 0) - (a.spread ?? 0));
}

function round3(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Math.round(value * 1000) / 1000;
}
