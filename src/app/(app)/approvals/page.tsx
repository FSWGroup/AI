import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx } from '@/lib/authz';
import { fmtDateTime, humanize } from '@/lib/format';
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatusBadge } from '@/components/ui';
import { DecideButtons } from './decide-buttons';

export const metadata: Metadata = { title: 'Approvals' };

export default async function ApprovalsPage() {
  const ctx = await requireCtx();

  const pendingAll = await db.approvalRequest.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    include: { steps: { orderBy: { order: 'asc' } } },
    take: 100,
  });

  // A request is actionable when its FIRST pending step is assigned to me.
  const actionable = pendingAll.filter((r) => {
    const current = r.steps.find((s) => s.status === 'PENDING');
    if (!current) return false;
    if (current.approverUserId) return current.approverUserId === ctx.userId;
    if (current.approverRole) return ctx.roleKeys.includes(current.approverRole);
    return false;
  });

  const mine = await db.approvalRequest.findMany({
    where: { requestedById: ctx.userId },
    orderBy: { createdAt: 'desc' },
    include: { steps: { orderBy: { order: 'asc' } } },
    take: 25,
  });

  return (
    <div>
      <PageHeader title="Approvals" description="Requests waiting on you, and requests you've submitted." />
      <div className="space-y-4">
        <Card>
          <CardHeader title={`Waiting on you (${actionable.length})`} />
          {actionable.length === 0 ? (
            <EmptyState title="Nothing waiting on you" description="Offer, compensation and other approvals assigned to you land here." />
          ) : (
            <ul className="divide-y divide-ink-100">
              {actionable.map((r) => {
                const current = r.steps.find((s) => s.status === 'PENDING')!;
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge tone="blue">{humanize(r.kind)}</Badge>
                        <span className="text-sm font-medium text-ink-900">{r.title}</span>
                      </div>
                      <div className="mt-0.5 text-[12px] text-ink-400">
                        Step {current.order} of {r.steps.length} · requested {fmtDateTime(r.createdAt)}
                      </div>
                    </div>
                    <DecideButtons requestId={r.id} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Your requests" />
          {mine.length === 0 ? (
            <EmptyState title="You haven't submitted any approval requests" />
          ) : (
            <ul className="divide-y divide-ink-100">
              {mine.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone="gray">{humanize(r.kind)}</Badge>
                      <span className="text-sm text-ink-800">{r.title}</span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-400">
                      {r.steps.filter((s) => s.status === 'APPROVED').length}/{r.steps.length} steps approved · {fmtDateTime(r.createdAt)}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
