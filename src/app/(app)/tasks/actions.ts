'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireCtxAction, can, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { refreshLifecycleStatus } from '@/lib/lifecycle';
import { createTask } from '@/lib/tasks';
import type { ActionResult } from '@/app/(auth)/actions';
import type { Ctx } from '@/lib/authz';

async function loadOwnedTask(ctx: Ctx, taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) throw new AuthzError('Task not found.');
  const isOwner =
    task.ownerUserId === ctx.userId || (task.ownerRoleKey ? ctx.roleKeys.includes(task.ownerRoleKey) : false);
  const isAdmin = can(ctx, 'onboarding.admin');
  if (!isOwner && !isAdmin && task.createdById !== ctx.userId) {
    throw new AuthzError('This task is not assigned to you.');
  }
  return task;
}

export async function setTaskStatusAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    const taskId = String(formData.get('taskId') ?? '');
    const status = String(formData.get('status') ?? '');
    if (!['OPEN', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELED'].includes(status)) {
      return { error: 'Invalid status.' };
    }
    const task = await loadOwnedTask(ctx, taskId);

    if (status === 'COMPLETED' && task.dependsOnId) {
      const dep = await db.task.findUnique({ where: { id: task.dependsOnId } });
      if (dep && dep.status !== 'COMPLETED' && dep.status !== 'CANCELED') {
        return { error: `Blocked by “${dep.title}” — complete that first.` };
      }
    }

    await db.task.update({
      where: { id: taskId },
      data: {
        status: status as never,
        ...(status === 'COMPLETED'
          ? { completedAt: new Date(), completedById: ctx.userId }
          : { completedAt: null, completedById: null }),
      },
    });
    await audit(ctx, `task.${status.toLowerCase()}`, { targetType: 'Task', targetId: taskId, metadata: { title: task.title } });
    if (task.lifecycleId && status === 'COMPLETED') await refreshLifecycleStatus(task.lifecycleId);
    revalidatePath('/tasks');
    return { success: status === 'COMPLETED' ? 'Task completed.' : 'Task updated.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'Could not update the task.' };
  }
}

export async function addTaskCommentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    const taskId = String(formData.get('taskId') ?? '');
    const body = String(formData.get('body') ?? '').trim();
    if (!body) return { error: 'Write a comment first.' };
    await loadOwnedTask(ctx, taskId);
    await db.taskComment.create({ data: { taskId, authorUserId: ctx.userId, body: body.slice(0, 2000) } });
    revalidatePath('/tasks');
    return { success: 'Comment added.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not add the comment.' };
  }
}

export async function createManualTaskAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    const title = String(formData.get('title') ?? '').trim();
    if (!title) return { error: 'Title is required.' };
    const assignee = String(formData.get('assignee') ?? 'me');
    const workerId = String(formData.get('workerId') ?? '') || null;

    // Non-admins can only create tasks for themselves.
    if (assignee !== 'me' && !can(ctx, 'onboarding.admin')) throw new AuthzError();

    await createTask({
      title,
      description: String(formData.get('description') ?? '') || undefined,
      category: (String(formData.get('category') ?? 'GENERAL') as never) ?? 'GENERAL',
      workerId,
      ownerUserId: assignee === 'me' ? ctx.userId : assignee.startsWith('user:') ? assignee.slice(5) : null,
      ownerRoleKey: assignee.startsWith('role:') ? assignee.slice(5) : null,
      dueDate: formData.get('dueDate') ? new Date(String(formData.get('dueDate'))) : null,
      priority: (String(formData.get('priority') ?? 'NORMAL') as never) ?? 'NORMAL',
      createdById: ctx.userId,
      sourceType: 'MANUAL',
      notify: assignee !== 'me',
    });
    revalidatePath('/tasks');
    return { success: 'Task created.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not create the task.' };
  }
}
