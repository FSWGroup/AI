import 'server-only';
import { db } from '@/lib/db';
import { notifyUser, notifyRole } from '@/lib/notify';
import { audit } from '@/lib/audit';
import type { Ctx } from '@/lib/authz';
import { AuthzError } from '@/lib/authz';

/**
 * Reusable sequential approval engine (§37). Steps are decided in order;
 * a rejection at any step rejects the request. Decisions are immutable —
 * once a step is decided it can never be re-decided, and every decision is
 * audited.
 */

export async function createApprovalRequest(opts: {
  kind: string;
  title: string;
  subjectType?: string;
  subjectId?: string;
  payload?: Record<string, unknown>;
  requestedById: string;
  steps: { approverUserId?: string; approverRole?: string }[];
}) {
  if (opts.steps.length === 0) throw new Error('Approval request needs at least one step');
  const request = await db.approvalRequest.create({
    data: {
      kind: opts.kind,
      title: opts.title,
      subjectType: opts.subjectType ?? null,
      subjectId: opts.subjectId ?? null,
      payload: JSON.parse(JSON.stringify(opts.payload ?? {})),
      requestedById: opts.requestedById,
      steps: {
        create: opts.steps.map((s, i) => ({
          order: i + 1,
          approverUserId: s.approverUserId ?? null,
          approverRole: s.approverRole ?? null,
        })),
      },
    },
    include: { steps: { orderBy: { order: 'asc' } } },
  });
  await notifyStep(request.id, 1, opts.title);
  return request;
}

async function notifyStep(requestId: string, order: number, title: string) {
  const step = await db.approvalStep.findUnique({
    where: { requestId_order: { requestId, order } },
  });
  if (!step) return;
  const payload = {
    kind: 'APPROVAL' as const,
    title: `Approval needed: ${title}`,
    href: `/approvals`,
    email: true,
  };
  if (step.approverUserId) await notifyUser(step.approverUserId, payload);
  else if (step.approverRole) await notifyRole(step.approverRole, payload);
}

/** Can this user decide the currently-pending step? */
export function stepActionableBy(
  step: { approverUserId: string | null; approverRole: string | null; status: string },
  ctx: Ctx,
): boolean {
  if (step.status !== 'PENDING') return false;
  if (step.approverUserId) return step.approverUserId === ctx.userId;
  if (step.approverRole) return ctx.roleKeys.includes(step.approverRole);
  return false;
}

export async function decideApproval(
  ctx: Ctx,
  requestId: string,
  decision: 'APPROVED' | 'REJECTED',
  note?: string,
): Promise<{ finalStatus: string }> {
  return db.$transaction(async (tx) => {
    const request = await tx.approvalRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    if (request.status !== 'PENDING') throw new AuthzError('This request has already been decided.');
    const current = request.steps.find((s) => s.status === 'PENDING');
    if (!current) throw new AuthzError('No pending step on this request.');
    if (!stepActionableBy(current, ctx)) {
      throw new AuthzError('This approval step is not assigned to you.');
    }
    await tx.approvalStep.update({
      where: { id: current.id },
      data: { status: decision, note: note ?? null, decidedById: ctx.userId, decidedAt: new Date() },
    });

    let finalStatus = request.status;
    if (decision === 'REJECTED') {
      finalStatus = 'REJECTED';
      await tx.approvalRequest.update({
        where: { id: requestId },
        data: { status: 'REJECTED', decidedAt: new Date() },
      });
    } else {
      const next = request.steps.find((s) => s.order > current.order && s.status === 'PENDING');
      if (!next) {
        finalStatus = 'APPROVED';
        await tx.approvalRequest.update({
          where: { id: requestId },
          data: { status: 'APPROVED', decidedAt: new Date() },
        });
      } else {
        await notifyStep(requestId, next.order, request.title);
      }
    }
    await notifyUser(request.requestedById, {
      kind: 'APPROVAL',
      title:
        finalStatus === 'PENDING'
          ? `Step approved: ${request.title}`
          : `${finalStatus === 'APPROVED' ? 'Approved' : 'Rejected'}: ${request.title}`,
      href: '/approvals',
    });
    await audit(ctx, `approval.${decision.toLowerCase()}`, {
      targetType: 'ApprovalRequest',
      targetId: requestId,
      metadata: { step: current.order, note: note ?? null },
    });
    return { finalStatus };
  });
}
