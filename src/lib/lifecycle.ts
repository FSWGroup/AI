import 'server-only';
import { db } from '@/lib/db';
import { createTask, resolveTaskOwner } from '@/lib/tasks';
import { recordTimeline } from '@/lib/timeline';
import { audienceMatches, workerFacts, type Audience } from '@/lib/audience';
import { addDays } from '@/lib/format';
import type { LifecycleKind, TaskCategory } from '@/generated/prisma/enums';

/**
 * Lifecycle engine: turns onboarding/offboarding templates into concrete,
 * owned, due-dated task checklists for a worker. Template + item conditions
 * (country, worker type, department, work state, work mode) select which
 * tasks a given population receives.
 */

export async function pickTemplate(kind: LifecycleKind, workerId: string): Promise<string | null> {
  const facts = await workerFacts(workerId);
  if (!facts) return null;
  const templates = await db.lifecycleTemplate.findMany({ where: { kind, active: true } });
  // Most specific matching template wins (most condition keys), defaults last.
  const matching = templates
    .filter((t) => audienceMatches(t.conditions as Audience, facts))
    .sort((a, b) => {
      const specificity = (t: (typeof templates)[number]) =>
        Object.values((t.conditions ?? {}) as Audience).filter((v) => (Array.isArray(v) ? v.length > 0 : v !== undefined)).length +
        (t.isDefault ? 0 : 0.5);
      return specificity(b) - specificity(a);
    });
  return matching[0]?.id ?? null;
}

export async function startLifecycle(opts: {
  workerId: string;
  kind: LifecycleKind;
  templateId?: string | null;
  startDate: Date;
  reason?: string | null;
  voluntary?: boolean | null;
  createdById?: string | null;
}) {
  const existing = await db.lifecycleInstance.findFirst({
    where: { workerId: opts.workerId, kind: opts.kind, status: 'IN_PROGRESS' },
  });
  if (existing) return existing;

  const templateId = opts.templateId ?? (await pickTemplate(opts.kind, opts.workerId));
  const facts = await workerFacts(opts.workerId);

  const instance = await db.lifecycleInstance.create({
    data: {
      workerId: opts.workerId,
      templateId,
      kind: opts.kind,
      startDate: opts.startDate,
      reason: opts.reason ?? null,
      voluntary: opts.voluntary ?? null,
      createdById: opts.createdById ?? null,
    },
  });

  if (templateId && facts) {
    const items = await db.lifecycleTemplateItem.findMany({
      where: { templateId },
      orderBy: { order: 'asc' },
    });
    const byOrder = new Map<number, string>(); // template order -> created task id
    for (const item of items) {
      if (!audienceMatches(item.conditions as Audience, facts)) continue;
      const owner = await resolveTaskOwner(item.ownerKind, opts.workerId, item.ownerUserId);
      const task = await createTask({
        title: item.title,
        description: item.description ?? undefined,
        category: item.category as TaskCategory,
        workerId: opts.workerId,
        ...owner,
        dueDate: addDays(opts.startDate, item.dueOffsetDays),
        priority: opts.kind === 'OFFBOARDING' && item.category === 'IT_ACCESS' ? 'CRITICAL' : 'NORMAL',
        dependsOnId: item.dependsOnOrder !== null ? (byOrder.get(item.dependsOnOrder) ?? null) : null,
        lifecycleId: instance.id,
        sourceType: 'TEMPLATE',
        sourceId: templateId,
        createdById: opts.createdById ?? null,
        notify: true,
      });
      byOrder.set(item.order, task.id);
    }
  }

  await recordTimeline({
    workerId: opts.workerId,
    kind: opts.kind,
    title: opts.kind === 'ONBOARDING' ? 'Onboarding started' : 'Offboarding started',
    detail: opts.reason ?? undefined,
    visibility: 'MANAGER',
    actorUserId: opts.createdById ?? null,
  });

  return instance;
}

/** Refreshes instance completion status from its tasks. */
export async function refreshLifecycleStatus(instanceId: string) {
  const openCount = await db.task.count({
    where: { lifecycleId: instanceId, status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] } },
  });
  if (openCount === 0) {
    const instance = await db.lifecycleInstance.update({
      where: { id: instanceId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    if (instance.kind === 'ONBOARDING') {
      await db.worker.updateMany({
        where: { id: instance.workerId, status: 'ONBOARDING' },
        data: { status: 'ACTIVE' },
      });
    }
  }
}
