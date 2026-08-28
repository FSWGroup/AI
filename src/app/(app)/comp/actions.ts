'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission, AuthzError } from '@/lib/authz';
import { createApprovalRequest } from '@/lib/approvals';
import { audit } from '@/lib/audit';
import { fullName } from '@/lib/format';
import type { ActionResult } from '@/app/(auth)/actions';

export async function requestCompChangeAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('comp.write');
    const workerId = String(formData.get('workerId') ?? '');
    const amount = Number(formData.get('amount'));
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter a valid amount.' };
    const worker = await db.worker.findUniqueOrThrow({ where: { id: workerId } });

    await createApprovalRequest({
      kind: 'COMP_CHANGE',
      title: `Compensation change: ${fullName(worker)} → ${amount} ${formData.get('currency')} / ${String(formData.get('rateType')).toLowerCase()}`,
      subjectType: 'Worker',
      subjectId: workerId,
      payload: {
        amount,
        currency: String(formData.get('currency') ?? 'USD'),
        rateType: String(formData.get('rateType') ?? 'ANNUAL'),
        reason: String(formData.get('reason') ?? 'ADJUSTMENT'),
        effectiveFrom: String(formData.get('effectiveFrom') ?? ''),
      },
      requestedById: ctx.userId,
      steps: [{ approverRole: 'EXECUTIVE' }],
    });
    await audit(ctx, 'compensation.change_requested', { targetType: 'Worker', targetId: workerId, metadata: { amount } });
    return { success: 'Submitted for executive approval.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not submit the request.' };
  }
}

export async function saveBandAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('comp.bands');
    const jobFamily = String(formData.get('jobFamily') ?? '').trim();
    const jobLevel = String(formData.get('jobLevel') ?? '').trim();
    const geography = String(formData.get('geography') ?? 'US');
    const min = Number(formData.get('minAmount'));
    const mid = Number(formData.get('midAmount'));
    const max = Number(formData.get('maxAmount'));
    if (!jobFamily || !jobLevel) return { error: 'Job family and level are required.' };
    if (!(min > 0 && mid >= min && max >= mid)) return { error: 'Band must satisfy min ≤ mid ≤ max.' };
    await db.salaryBand.upsert({
      where: { jobFamily_jobLevel_geography: { jobFamily, jobLevel, geography } },
      create: { jobFamily, jobLevel, geography, currency: String(formData.get('currency') ?? 'USD'), minAmount: min, midAmount: mid, maxAmount: max },
      update: { currency: String(formData.get('currency') ?? 'USD'), minAmount: min, midAmount: mid, maxAmount: max },
    });
    await audit(ctx, 'compensation.band_saved', { metadata: { jobFamily, jobLevel, geography } });
    revalidatePath('/comp/bands');
    return { success: 'Band saved.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the band.' };
  }
}

export async function deleteBandAction(formData: FormData): Promise<void> {
  const ctx = await requirePermission('comp.bands');
  const id = String(formData.get('bandId') ?? '');
  await db.salaryBand.delete({ where: { id } });
  await audit(ctx, 'compensation.band_deleted', { targetType: 'SalaryBand', targetId: id });
  revalidatePath('/comp/bands');
}
