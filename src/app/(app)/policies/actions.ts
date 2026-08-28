'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireCtxAction, requirePermission, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { recordTimeline } from '@/lib/timeline';
import { requestMeta } from '@/lib/auth/session';
import { audienceWorkerIds, type Audience } from '@/lib/audience';
import { notifyUser } from '@/lib/notify';
import type { ActionResult } from '@/app/(auth)/actions';

/** Create a policy (or a new version of one) and publish to its audience. */
export async function publishPolicyAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('policies.admin');
    const policyId = String(formData.get('policyId') ?? '');
    const title = String(formData.get('title') ?? '').trim();
    const bodyHtml = String(formData.get('body') ?? '').trim();
    if (!policyId && !title) return { error: 'Policy title is required.' };
    if (!bodyHtml) return { error: 'Policy text is required.' };

    const policy = policyId
      ? await db.policy.findUniqueOrThrow({ where: { id: policyId }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } })
      : await db.policy.create({
          data: { title, category: String(formData.get('category') ?? '') || null },
          include: { versions: true },
        });

    const audience: Audience = {};
    const workerTypes = formData.getAll('workerTypes').map(String).filter(Boolean);
    const countries = formData.getAll('countries').map(String).filter(Boolean);
    if (workerTypes.length) audience.workerTypes = workerTypes;
    if (countries.length) audience.countries = countries;

    const version = await db.policyVersion.create({
      data: {
        policyId: policy.id,
        version: (policy.versions[0]?.version ?? 0) + 1,
        bodyHtml: bodyHtml.replace(/</g, '&lt;').replace(/\n/g, '<br/>'),
        requiresAck: formData.get('requiresAck') !== 'off',
        ackDeadlineDays: formData.get('ackDeadlineDays') ? Number(formData.get('ackDeadlineDays')) : 14,
        audience: audience as object,
        effectiveAt: formData.get('effectiveAt') ? new Date(String(formData.get('effectiveAt'))) : new Date(),
        publishedAt: new Date(),
        createdById: ctx.userId,
      },
    });

    // Assign acknowledgment rows to the audience. Previous-version acks stay intact.
    const workerIds = await audienceWorkerIds(audience);
    for (const workerId of workerIds) {
      await db.policyAcknowledgment.upsert({
        where: { policyVersionId_workerId: { policyVersionId: version.id, workerId } },
        create: { policyVersionId: version.id, workerId },
        update: {},
      });
      const worker = await db.worker.findUnique({ where: { id: workerId }, select: { userId: true } });
      if (worker?.userId) {
        await notifyUser(worker.userId, {
          kind: 'COMPLIANCE',
          title: `Policy to acknowledge: ${policy.title}`,
          href: `/policies/${policy.id}`,
        });
      }
    }
    await audit(ctx, 'policy.published', {
      targetType: 'Policy',
      targetId: policy.id,
      metadata: { version: version.version, audienceCount: workerIds.length },
    });
    revalidatePath('/policies');
    return { success: `Version ${version.version} published to ${workerIds.length} people.` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'Could not publish the policy.' };
  }
}

export async function acknowledgePolicyAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    if (!ctx.workerId) return { error: 'Your account is not linked to a worker profile.' };
    const versionId = String(formData.get('versionId') ?? '');
    const ack = await db.policyAcknowledgment.findUnique({
      where: { policyVersionId_workerId: { policyVersionId: versionId, workerId: ctx.workerId } },
      include: { policyVersion: { include: { policy: true } } },
    });
    if (!ack) return { error: 'This policy version is not assigned to you.' };
    if (ack.acknowledgedAt) return { error: 'Already acknowledged.' };
    const meta = await requestMeta();
    await db.policyAcknowledgment.update({
      where: { id: ack.id },
      data: { acknowledgedAt: new Date(), ip: meta.ip, viewedAt: ack.viewedAt ?? new Date() },
    });
    await audit(ctx, 'policy.acknowledged', {
      targetType: 'PolicyVersion',
      targetId: versionId,
      metadata: { policy: ack.policyVersion.policy.title },
    });
    await recordTimeline({
      workerId: ctx.workerId,
      kind: 'POLICY_ACK',
      title: `Acknowledged: ${ack.policyVersion.policy.title} (v${ack.policyVersion.version})`,
      visibility: 'HR',
      actorUserId: ctx.userId,
    });
    revalidatePath('/policies');
    return { success: 'Acknowledged — thank you.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not record the acknowledgment.' };
  }
}

export async function markPolicyViewedAction(versionId: string): Promise<void> {
  const ctx = await requireCtxAction();
  if (!ctx.workerId) return;
  await db.policyAcknowledgment.updateMany({
    where: { policyVersionId: versionId, workerId: ctx.workerId, viewedAt: null },
    data: { viewedAt: new Date() },
  });
}
