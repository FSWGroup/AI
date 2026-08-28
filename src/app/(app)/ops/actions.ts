'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission, AuthzError } from '@/lib/authz';
import { startLifecycle } from '@/lib/lifecycle';
import { audit } from '@/lib/audit';
import type { ActionResult } from '@/app/(auth)/actions';
import type { LifecycleKind, TaskCategory } from '@/generated/prisma/enums';

export async function startLifecycleAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('onboarding.admin');
    const workerId = String(formData.get('workerId') ?? '');
    const kind = String(formData.get('kind') ?? 'ONBOARDING') as LifecycleKind;
    const templateId = String(formData.get('templateId') ?? '') || null;
    const worker = await db.worker.findUnique({ where: { id: workerId } });
    if (!worker) return { error: 'Pick a worker.' };
    const startDate = formData.get('startDate')
      ? new Date(String(formData.get('startDate')))
      : (worker.hireDate ?? new Date());
    await startLifecycle({ workerId, kind, templateId, startDate, createdById: ctx.userId });
    await audit(ctx, `lifecycle.${kind.toLowerCase()}_started`, { targetType: 'Worker', targetId: workerId });
    revalidatePath('/ops/onboarding');
    revalidatePath('/ops/offboarding');
    return { success: `${kind === 'ONBOARDING' ? 'Onboarding' : 'Offboarding'} started.` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'Could not start the checklist.' };
  }
}

export async function cancelLifecycleAction(formData: FormData): Promise<void> {
  const ctx = await requirePermission('onboarding.admin');
  const id = String(formData.get('instanceId') ?? '');
  await db.lifecycleInstance.update({ where: { id }, data: { status: 'CANCELED' } });
  await db.task.updateMany({
    where: { lifecycleId: id, status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] } },
    data: { status: 'CANCELED' },
  });
  await audit(ctx, 'lifecycle.canceled', { targetType: 'LifecycleInstance', targetId: id });
  revalidatePath('/ops/onboarding');
  revalidatePath('/ops/offboarding');
}

// ---------------------------------------------------------------------------
// Template management
// ---------------------------------------------------------------------------

export async function saveTemplateAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('onboarding.admin');
    const id = String(formData.get('templateId') ?? '');
    const kind = String(formData.get('kind') ?? 'ONBOARDING') as LifecycleKind;
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { error: 'Template name is required.' };
    const conditions: Record<string, string[]> = {};
    const countries = formData.getAll('countries').map(String).filter(Boolean);
    const workerTypes = formData.getAll('workerTypes').map(String).filter(Boolean);
    if (countries.length) conditions.countries = countries;
    if (workerTypes.length) conditions.workerTypes = workerTypes;

    const data = {
      kind,
      name,
      description: String(formData.get('description') ?? '') || null,
      isDefault: formData.get('isDefault') === 'on',
      conditions,
    };
    const tpl = id
      ? await db.lifecycleTemplate.update({ where: { id }, data })
      : await db.lifecycleTemplate.create({ data });
    await audit(ctx, 'lifecycle.template_saved', { targetType: 'LifecycleTemplate', targetId: tpl.id });
    revalidatePath('/ops/templates');
    return { success: 'Template saved.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the template.' };
  }
}

export async function saveTemplateItemAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('onboarding.admin');
    const templateId = String(formData.get('templateId') ?? '');
    const itemId = String(formData.get('itemId') ?? '');
    const title = String(formData.get('title') ?? '').trim();
    if (!title) return { error: 'Task title is required.' };
    const data = {
      title,
      description: String(formData.get('description') ?? '') || null,
      category: String(formData.get('category') ?? 'ONBOARDING') as TaskCategory,
      ownerKind: String(formData.get('ownerKind') ?? 'HR'),
      dueOffsetDays: Number(formData.get('dueOffsetDays') ?? 0) || 0,
      order: Number(formData.get('order') ?? 0) || 0,
    };
    if (itemId) {
      await db.lifecycleTemplateItem.update({ where: { id: itemId }, data });
    } else {
      await db.lifecycleTemplateItem.create({ data: { ...data, templateId } });
    }
    await audit(ctx, 'lifecycle.template_item_saved', { targetType: 'LifecycleTemplate', targetId: templateId });
    revalidatePath(`/ops/templates/${templateId}`);
    return { success: 'Checklist item saved.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the item.' };
  }
}

export async function deleteTemplateItemAction(formData: FormData): Promise<void> {
  const ctx = await requirePermission('onboarding.admin');
  const itemId = String(formData.get('itemId') ?? '');
  const item = await db.lifecycleTemplateItem.delete({ where: { id: itemId } });
  await audit(ctx, 'lifecycle.template_item_deleted', { targetType: 'LifecycleTemplate', targetId: item.templateId });
  revalidatePath(`/ops/templates/${item.templateId}`);
}
