import type { PrismaClient } from '../src/generated/prisma/client';

/**
 * Seed-time lifecycle starter. The application uses src/lib/lifecycle.ts
 * (which is server-only); this trimmed version exists so the seed script can
 * generate a realistic in-progress onboarding without importing Next.js
 * server modules.
 */
export async function startLifecycleSeed(
  db: PrismaClient,
  workerId: string,
  templateId: string,
  startDate: Date,
) {
  const worker = await db.worker.findUniqueOrThrow({
    where: { id: workerId },
    include: {
      user: true,
      employments: { where: { effectiveTo: null }, take: 1, include: { manager: { include: { user: true } } } },
    },
  });
  const instance = await db.lifecycleInstance.create({
    data: { workerId, templateId, kind: 'ONBOARDING', startDate },
  });
  const items = await db.lifecycleTemplateItem.findMany({ where: { templateId }, orderBy: { order: 'asc' } });
  const byOrder = new Map<number, string>();
  for (const item of items) {
    const owner =
      item.ownerKind === 'EMPLOYEE'
        ? { ownerUserId: worker.user?.id ?? null, ownerRoleKey: worker.user ? null : 'HR_ADMIN' }
        : item.ownerKind === 'MANAGER'
          ? {
              ownerUserId: worker.employments[0]?.manager?.user?.id ?? null,
              ownerRoleKey: worker.employments[0]?.manager?.user ? null : 'HR_ADMIN',
            }
          : item.ownerKind === 'IT'
            ? { ownerUserId: null, ownerRoleKey: 'IT_ADMIN' }
            : item.ownerKind === 'FINANCE'
              ? { ownerUserId: null, ownerRoleKey: 'FINANCE' }
              : { ownerUserId: null, ownerRoleKey: 'HR_ADMIN' };
    const due = new Date(startDate);
    due.setUTCDate(due.getUTCDate() + item.dueOffsetDays);
    const task = await db.task.create({
      data: {
        title: item.title,
        description: item.description,
        category: item.category,
        workerId,
        ...owner,
        dueDate: due,
        dependsOnId: item.dependsOnOrder !== null ? (byOrder.get(item.dependsOnOrder) ?? null) : null,
        lifecycleId: instance.id,
        sourceType: 'TEMPLATE',
        sourceId: templateId,
        // The first few HR tasks are completed for demo realism
        ...(item.order <= 2 ? { status: 'COMPLETED' as const, completedAt: new Date() } : {}),
      },
    });
    byOrder.set(item.order, task.id);
  }
  return instance;
}
