'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { syncComplianceItems } from '@/lib/compliance';
import type { ActionResult } from '@/app/(auth)/actions';
import type { Audience } from '@/lib/audience';

export async function saveComplianceRuleAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('compliance.admin');
    const id = String(formData.get('ruleId') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    const description = String(formData.get('description') ?? '').trim();
    if (!name || !description) return { error: 'Name and description are required.' };

    const appliesTo: Audience = {};
    const countries = formData.getAll('countries').map(String).filter(Boolean);
    const workerTypes = formData.getAll('workerTypes').map(String).filter(Boolean);
    const workStates = String(formData.get('workStates') ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (countries.length) appliesTo.countries = countries;
    if (workerTypes.length) appliesTo.workerTypes = workerTypes;
    if (workStates.length) appliesTo.workStates = workStates;

    const data = {
      name,
      category: String(formData.get('category') ?? 'ONBOARDING_FORMS'),
      jurisdiction: String(formData.get('jurisdiction') ?? 'US-FED'),
      source: String(formData.get('source') ?? '') || null,
      sourceUrl: String(formData.get('sourceUrl') ?? '') || null,
      description,
      appliesTo: appliesTo as object,
      deadlineRule: {
        anchor: String(formData.get('anchor') ?? 'HIRE_DATE'),
        offsetDays: Number(formData.get('offsetDays') ?? 0) || 0,
      } as object,
      severity: String(formData.get('severity') ?? 'MEDIUM'),
      ownerRoleKey: String(formData.get('ownerRoleKey') ?? 'HR_ADMIN'),
      status: String(formData.get('status') ?? 'ACTIVE'),
      lastReviewedAt: formData.get('lastReviewedAt') ? new Date(String(formData.get('lastReviewedAt'))) : new Date(),
      nextReviewAt: formData.get('nextReviewAt') ? new Date(String(formData.get('nextReviewAt'))) : null,
    };
    const rule = id
      ? await db.complianceRule.update({ where: { id }, data })
      : await db.complianceRule.create({ data });
    await audit(ctx, id ? 'compliance.rule_updated' : 'compliance.rule_created', {
      targetType: 'ComplianceRule',
      targetId: rule.id,
      after: { name, jurisdiction: data.jurisdiction, severity: data.severity },
    });
    revalidatePath('/admin/compliance');
    return { success: 'Rule saved. Run the sync to materialize items for matching workers.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'Could not save the rule.' };
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState passes prev state
export async function syncComplianceAction(_prev: ActionResult): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('compliance.admin');
    const created = await syncComplianceItems();
    await audit(ctx, 'compliance.synced', { metadata: { created } });
    revalidatePath('/admin/compliance');
    return { success: created ? `Created ${created} compliance item${created === 1 ? '' : 's'}.` : 'Everything already tracked — no new items.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'The compliance sync failed.' };
  }
}

export async function setComplianceItemStatusAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('compliance.admin');
    const itemId = String(formData.get('itemId') ?? '');
    const status = String(formData.get('status') ?? '');
    if (!['OPEN', 'IN_PROGRESS', 'COMPLETED', 'WAIVED'].includes(status)) return { error: 'Invalid status.' };
    await db.complianceItem.update({
      where: { id: itemId },
      data: { status, completedAt: status === 'COMPLETED' ? new Date() : null },
    });
    await audit(ctx, 'compliance.item_status', { targetType: 'ComplianceItem', targetId: itemId, after: { status } });
    revalidatePath('/admin/compliance');
    return { success: 'Updated.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not update the item.' };
  }
}

export async function saveRetentionPolicyAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('retention.admin');
    const recordType = String(formData.get('recordType') ?? '').trim();
    const years = Number(formData.get('retainYears'));
    if (!recordType || !Number.isFinite(years) || years <= 0) return { error: 'Record type and a positive retention period are required.' };
    const policy = await db.retentionPolicy.create({
      data: {
        recordType,
        jurisdiction: String(formData.get('jurisdiction') ?? 'US-FED'),
        anchor: String(formData.get('anchor') ?? 'TERMINATION'),
        retainYears: years,
        note: String(formData.get('note') ?? '') || null,
        sourceUrl: String(formData.get('sourceUrl') ?? '') || null,
      },
    });
    await audit(ctx, 'retention.policy_created', { targetType: 'RetentionPolicy', targetId: policy.id });
    revalidatePath('/admin/compliance');
    return { success: 'Retention policy saved.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the retention policy.' };
  }
}

/**
 * Approve destruction of records eligible under a retention policy.
 * Deliberately conservative: this anonymizes the worker's restricted personal
 * data and deletes encrypted identifiers, but preserves the employment record
 * skeleton so historical reporting stays honest (§47, §53).
 */
export async function approveDestructionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('retention.admin');
    const workerId = String(formData.get('workerId') ?? '');
    const reason = String(formData.get('reason') ?? '').trim();
    if (!reason) return { error: 'A documented reason is required to approve destruction.' };
    const worker = await db.worker.findUniqueOrThrow({ where: { id: workerId } });
    if (worker.status !== 'TERMINATED') return { error: 'Only terminated workers are eligible for destruction.' };

    await db.$transaction(async (tx) => {
      await tx.workerIdentifier.deleteMany({ where: { workerId } });
      await tx.bankAccount.deleteMany({ where: { workerId } });
      await tx.emergencyContact.deleteMany({ where: { workerId } });
      await tx.worker.update({
        where: { id: workerId },
        data: {
          personalEmail: null,
          phone: null,
          dateOfBirth: null,
          homeStreet: null,
          homeCity: null,
          homeState: null,
          homePostal: null,
          citizenship: null,
          photoUrl: null,
        },
      });
    });
    await audit(ctx, 'retention.destruction_approved', {
      targetType: 'Worker',
      targetId: workerId,
      metadata: { reason, scope: 'restricted personal data, identifiers, bank, emergency contacts' },
    });
    revalidatePath('/admin/compliance');
    return { success: 'Restricted personal data destroyed. Employment history is preserved for reporting.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'Could not complete the destruction.' };
  }
}
