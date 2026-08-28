import type { PrismaClient } from '../src/generated/prisma/client';

/**
 * Seed-time compliance materialization. The application uses
 * src/lib/compliance.ts (server-only); this trimmed copy lets the seed script
 * create demo compliance items without importing Next.js server modules.
 */
interface Applies {
  countries?: string[];
  workerTypes?: string[];
  workStates?: string[];
}

export async function syncComplianceItemsSeed(db: PrismaClient): Promise<number> {
  const rules = await db.complianceRule.findMany({ where: { status: 'ACTIVE' } });
  const workers = await db.worker.findMany({
    where: { deletedAt: null, status: { notIn: ['TERMINATED'] } },
    include: { employments: { where: { effectiveTo: null }, take: 1 } },
  });
  let created = 0;

  for (const rule of rules) {
    const applies = (rule.appliesTo ?? {}) as Applies;
    const deadline = (rule.deadlineRule ?? {}) as { anchor?: string; offsetDays?: number };

    for (const worker of workers) {
      const employment = worker.employments[0];
      if (applies.countries?.length && !applies.countries.includes(worker.country)) continue;
      if (applies.workerTypes?.length && !applies.workerTypes.includes(worker.workerType)) continue;
      if (applies.workStates?.length && (!employment?.workState || !applies.workStates.includes(employment.workState))) continue;

      const existing = await db.complianceItem.findFirst({ where: { ruleId: rule.id, workerId: worker.id } });
      if (existing) continue;

      let dueDate: Date | null = null;
      if (deadline.anchor === 'HIRE_DATE' && worker.hireDate) {
        dueDate = new Date(worker.hireDate);
        dueDate.setUTCDate(dueDate.getUTCDate() + (deadline.offsetDays ?? 0));
      }
      const name = `${worker.preferredName || worker.legalFirstName} ${worker.lastName}`;
      await db.complianceItem.create({
        data: {
          ruleId: rule.id,
          workerId: worker.id,
          title: `${rule.name} — ${name}`,
          dueDate,
          // Demo realism: most historical obligations are already satisfied.
          status: worker.status === 'ONBOARDING' || worker.status === 'PRE_START' ? 'OPEN' : 'COMPLETED',
          completedAt: worker.status === 'ONBOARDING' || worker.status === 'PRE_START' ? null : new Date(),
        },
      });
      created++;
    }
  }
  return created;
}
