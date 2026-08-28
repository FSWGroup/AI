import 'server-only';
import { db } from '@/lib/db';
import { notifyUser, notifyRole } from '@/lib/notify';
import type { TaskCategory } from '@/generated/prisma/enums';

export async function createTask(opts: {
  title: string;
  description?: string;
  category?: TaskCategory;
  workerId?: string | null;
  ownerUserId?: string | null;
  ownerRoleKey?: string | null;
  dueDate?: Date | null;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  dependsOnId?: string | null;
  lifecycleId?: string | null;
  sourceType?: string;
  sourceId?: string;
  createdById?: string | null;
  notify?: boolean;
}) {
  const task = await db.task.create({
    data: {
      title: opts.title,
      description: opts.description ?? null,
      category: opts.category ?? 'GENERAL',
      workerId: opts.workerId ?? null,
      ownerUserId: opts.ownerUserId ?? null,
      ownerRoleKey: opts.ownerRoleKey ?? null,
      dueDate: opts.dueDate ?? null,
      priority: opts.priority ?? 'NORMAL',
      dependsOnId: opts.dependsOnId ?? null,
      lifecycleId: opts.lifecycleId ?? null,
      sourceType: opts.sourceType ?? 'MANUAL',
      sourceId: opts.sourceId ?? null,
      createdById: opts.createdById ?? null,
    },
  });
  if (opts.notify !== false) {
    const payload = {
      kind: 'TASK' as const,
      title: `New task: ${opts.title}`,
      body: opts.description ?? undefined,
      href: `/tasks?task=${task.id}`,
      email: opts.priority === 'HIGH' || opts.priority === 'CRITICAL',
    };
    if (opts.ownerUserId) await notifyUser(opts.ownerUserId, payload);
    else if (opts.ownerRoleKey) await notifyRole(opts.ownerRoleKey, payload);
  }
  return task;
}

/** Resolve a template ownerKind to a concrete assignee for a worker. */
export async function resolveTaskOwner(
  ownerKind: string,
  workerId: string,
  ownerUserId?: string | null,
): Promise<{ ownerUserId?: string | null; ownerRoleKey?: string | null }> {
  switch (ownerKind) {
    case 'EMPLOYEE': {
      const worker = await db.worker.findUnique({ where: { id: workerId }, select: { userId: true } });
      return worker?.userId ? { ownerUserId: worker.userId } : { ownerRoleKey: 'HR_ADMIN' };
    }
    case 'MANAGER': {
      const employment = await db.employmentRecord.findFirst({
        where: { workerId, effectiveTo: null },
        select: { manager: { select: { userId: true } } },
      });
      return employment?.manager?.userId
        ? { ownerUserId: employment.manager.userId }
        : { ownerRoleKey: 'HR_ADMIN' };
    }
    case 'HR':
      return { ownerRoleKey: 'HR_ADMIN' };
    case 'IT':
      return { ownerRoleKey: 'IT_ADMIN' };
    case 'FINANCE':
      return { ownerRoleKey: 'FINANCE' };
    case 'CUSTOM_USER':
      return ownerUserId ? { ownerUserId } : { ownerRoleKey: 'HR_ADMIN' };
    default:
      return { ownerRoleKey: 'HR_ADMIN' };
  }
}
