'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireCtxAction, AuthzError } from '@/lib/authz';
import { decideApproval } from '@/lib/approvals';
import { changeCompensation } from '@/lib/people';
import type { ActionResult } from '@/app/(auth)/actions';

export async function decideApprovalAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    const requestId = String(formData.get('requestId') ?? '');
    const decision = String(formData.get('decision') ?? '');
    if (decision !== 'APPROVED' && decision !== 'REJECTED') return { error: 'Invalid decision.' };
    const note = String(formData.get('note') ?? '') || undefined;

    const { finalStatus } = await decideApproval(ctx, requestId, decision, note);

    // Fully-approved requests execute their effect.
    if (finalStatus === 'APPROVED') {
      const request = await db.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
      const payload = request.payload as Record<string, unknown>;
      if (request.kind === 'COMP_CHANGE' && request.subjectId && payload.amount) {
        await changeCompensation(ctx, request.subjectId, {
          amount: Number(payload.amount),
          currency: String(payload.currency ?? 'USD'),
          rateType: String(payload.rateType ?? 'ANNUAL'),
          reason: String(payload.reason ?? 'ADJUSTMENT'),
          note: `Approved via request ${requestId}`,
          effectiveFrom: payload.effectiveFrom ? new Date(String(payload.effectiveFrom)) : new Date(),
        });
      }
      if (request.kind === 'OFFER' && request.subjectId) {
        await db.offer.updateMany({
          where: { id: request.subjectId, status: 'PENDING_APPROVAL' },
          data: { status: 'DRAFT' }, // approved → back to draft, ready to send
        });
        revalidatePath('/recruiting/offers');
      }
    }
    revalidatePath('/approvals');
    return { success: decision === 'APPROVED' ? 'Approved.' : 'Rejected.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'Could not record the decision.' };
  }
}
