'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { runMaintenance } from '@/lib/jobs';
import { WORKFLOW_TEMPLATES } from './templates';
import type { WorkflowAction } from '@/lib/workflows';
import type { Audience } from '@/lib/audience';
import type { ActionResult } from '@/app/(auth)/actions';

/**
 * Admin-friendly workflow builder. The UI composes one trigger, optional
 * population conditions, and one or more actions; everything is stored as
 * JSON so new action types need no migration.
 */
export async function saveWorkflowAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('workflows.admin');
    const id = String(formData.get('workflowId') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { error: 'Workflow name is required.' };
    const trigger = String(formData.get('trigger') ?? '');
    if (!trigger) return { error: 'Pick a trigger.' };

    const conditions: Audience = {};
    const countries = formData.getAll('countries').map(String).filter(Boolean);
    const workerTypes = formData.getAll('workerTypes').map(String).filter(Boolean);
    const departmentIds = formData.getAll('departmentIds').map(String).filter(Boolean);
    if (countries.length) conditions.countries = countries;
    if (workerTypes.length) conditions.workerTypes = workerTypes;
    if (departmentIds.length) conditions.departmentIds = departmentIds;

    // Actions are submitted as parallel arrays (one row per action).
    const types = formData.getAll('actionType').map(String);
    const actions: WorkflowAction[] = [];
    types.forEach((type, i) => {
      if (!type) return;
      const at = (name: string) => String(formData.getAll(name)[i] ?? '');
      switch (type) {
        case 'CREATE_TASK':
          actions.push({
            type,
            title: at('actionTitle') || 'Workflow task',
            description: at('actionBody') || undefined,
            owner: at('actionOwner') || undefined,
            ownerRoleKey: at('actionOwner')?.startsWith('role:') ? at('actionOwner').slice(5) : 'HR_ADMIN',
            category: at('actionCategory') || 'GENERAL',
            dueOffsetDays: Number(at('actionDue') || 3),
            priority: at('actionPriority') || 'NORMAL',
          });
          break;
        case 'SEND_EMAIL':
          actions.push({ type, recipient: at('actionOwner') || 'WORKER', subject: at('actionTitle'), body: at('actionBody') });
          break;
        case 'NOTIFY_USER':
          actions.push({ type, userTarget: at('actionOwner') || 'MANAGER', title: at('actionTitle'), body: at('actionBody') });
          break;
        case 'NOTIFY_ROLE':
          actions.push({ type, roleKey: at('actionOwner')?.replace('role:', '') || 'HR_ADMIN', title: at('actionTitle'), body: at('actionBody') });
          break;
        case 'ASSIGN_TRAINING':
          actions.push({ type, courseId: at('actionRefId') });
          break;
        case 'ASSIGN_POLICY':
          actions.push({ type, policyId: at('actionRefId') });
          break;
        case 'REQUEST_DOCUMENT':
          actions.push({ type, title: at('actionTitle') || 'Provide a document', dueOffsetDays: Number(at('actionDue') || 7) });
          break;
        default:
          actions.push({ type: type as WorkflowAction['type'] });
      }
    });
    if (actions.length === 0) return { error: 'Add at least one action.' };

    const data = {
      name,
      description: String(formData.get('description') ?? '') || null,
      trigger,
      conditions: conditions as object,
      actions: actions as unknown as object,
      enabled: formData.get('enabled') !== 'off',
    };
    const wf = id
      ? await db.workflowDefinition.update({ where: { id }, data })
      : await db.workflowDefinition.create({ data: { ...data, createdById: ctx.userId } });
    await audit(ctx, id ? 'workflow.updated' : 'workflow.created', {
      targetType: 'WorkflowDefinition',
      targetId: wf.id,
      after: { name, trigger, actionCount: actions.length },
    });
    revalidatePath('/admin/workflows');
    return { success: 'Workflow saved.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'Could not save the workflow.' };
  }
}

export async function toggleWorkflowAction(formData: FormData): Promise<void> {
  const ctx = await requirePermission('workflows.admin');
  const id = String(formData.get('workflowId') ?? '');
  const wf = await db.workflowDefinition.findUniqueOrThrow({ where: { id } });
  await db.workflowDefinition.update({ where: { id }, data: { enabled: !wf.enabled } });
  await audit(ctx, 'workflow.toggled', { targetType: 'WorkflowDefinition', targetId: id, after: { enabled: !wf.enabled } });
  revalidatePath('/admin/workflows');
}

export async function deleteWorkflowAction(formData: FormData): Promise<void> {
  const ctx = await requirePermission('workflows.admin');
  const id = String(formData.get('workflowId') ?? '');
  await db.workflowDefinition.delete({ where: { id } });
  await audit(ctx, 'workflow.deleted', { targetType: 'WorkflowDefinition', targetId: id });
  revalidatePath('/admin/workflows');
}

/** Manually run the daily sweep (birthdays, expirations, accruals, reminders). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState passes prev state
export async function runMaintenanceAction(_prev: ActionResult): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('workflows.admin');
    const counters = await runMaintenance();
    await audit(ctx, 'system.maintenance_run', { metadata: counters });
    revalidatePath('/admin/workflows');
    const summary = Object.entries(counters)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    return { success: summary ? `Sweep complete — ${summary}.` : 'Sweep complete — nothing was due.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'The maintenance sweep failed. Check the server logs.' };
  }
}

/** Install a ready-made workflow from the template library. */
export async function installTemplateAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('workflows.admin');
    const key = String(formData.get('templateKey') ?? '');
    const template = WORKFLOW_TEMPLATES.find((t) => t.key === key);
    if (!template) return { error: 'Unknown template.' };
    const wf = await db.workflowDefinition.create({
      data: {
        name: template.name,
        description: template.description,
        trigger: template.trigger,
        conditions: (template.conditions ?? {}) as object,
        actions: template.actions as unknown as object,
        createdById: ctx.userId,
      },
    });
    await audit(ctx, 'workflow.template_installed', { targetType: 'WorkflowDefinition', targetId: wf.id, metadata: { key } });
    revalidatePath('/admin/workflows');
    return { success: `Installed “${template.name}”.` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not install the template.' };
  }
}
