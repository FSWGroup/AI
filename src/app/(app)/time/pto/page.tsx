import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, can, directReportIds } from '@/lib/authz';
import { ptoBalance } from '@/lib/pto';
import { fmtDate, fmtHours, fullName } from '@/lib/format';
import {
  Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge, Table, THead, TH, TRow, TD, cx,
} from '@/components/ui';
import { PtoRequestForm, PtoDecideForm, CancelPtoButton, AdjustBalanceForm } from './pto-forms';

export const metadata: Metadata = { title: 'Time off' };

export default async function PtoPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requireCtx();
  const { tab: rawTab } = await searchParams;
  const isApprover = can(ctx, 'pto.approve') || can(ctx, 'pto.admin');
  const isAdmin = can(ctx, 'pto.admin');
  const tab = rawTab ?? 'mine';

  // --- My data -------------------------------------------------------------
  const assignments = ctx.workerId
    ? await db.ptoPolicyAssignment.findMany({
        where: { workerId: ctx.workerId, endDate: null },
        include: { policy: true },
      })
    : [];
  const balances = await Promise.all(
    assignments.map(async (a) => ({
      policy: a.policy,
      balance: ctx.workerId ? await ptoBalance(ctx.workerId, a.policyId) : 0,
    })),
  );
  const myRequests = ctx.workerId
    ? await db.ptoRequest.findMany({
        where: { workerId: ctx.workerId },
        orderBy: { startDate: 'desc' },
        take: 20,
        include: { policy: true },
      })
    : [];

  // --- Approvals -----------------------------------------------------------
  let pending: Awaited<ReturnType<typeof queryPending>> = [];
  async function queryPending(ids: string[] | null) {
    return db.ptoRequest.findMany({
      where: { status: 'PENDING', ...(ids ? { workerId: { in: ids } } : {}) },
      orderBy: { startDate: 'asc' },
      include: {
        policy: true,
        worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
      },
    });
  }
  if (tab === 'approvals' && isApprover) {
    if (isAdmin) pending = await queryPending(null);
    else if (ctx.workerId) pending = await queryPending(await directReportIds(ctx.workerId));
  }

  // --- Admin: everyone's balances -------------------------------------------
  const allWorkers =
    tab === 'admin' && isAdmin
      ? await db.worker.findMany({
          where: { status: { in: ['ACTIVE', 'ONBOARDING', 'ON_LEAVE'] }, deletedAt: null },
          include: { ptoAssignments: { where: { endDate: null }, include: { policy: true } } },
          orderBy: { lastName: 'asc' },
        })
      : [];
  const adminBalances =
    tab === 'admin' && isAdmin
      ? await Promise.all(
          allWorkers.flatMap((w) =>
            w.ptoAssignments.map(async (a) => ({
              workerId: w.id,
              policyId: a.policyId,
              balance: await ptoBalance(w.id, a.policyId),
            })),
          ),
        )
      : [];

  const tabs = [
    { key: 'mine', label: 'My time off', show: true },
    { key: 'approvals', label: 'Approvals', show: isApprover },
    { key: 'admin', label: 'Balances (HR)', show: isAdmin },
  ].filter((t) => t.show);

  return (
    <div>
      <PageHeader title="Time off" description="Balances, requests and approvals." />

      <nav aria-label="Time off views" className="mb-4 flex rounded-md border border-ink-200 bg-white p-0.5 w-fit">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/time/pto?tab=${t.key}`}
            aria-current={tab === t.key ? 'page' : undefined}
            className={cx(
              'rounded px-3 py-1.5 text-[13px] font-medium',
              tab === t.key ? 'bg-ink-900 text-white' : 'text-ink-500 hover:text-ink-900',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'mine' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {balances.map(({ policy, balance }) => (
              <Card key={policy.id}>
                <CardBody>
                  <div className="text-[12px] font-medium text-ink-500 uppercase">{policy.name}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{fmtHours(balance)}</div>
                  <div className="text-[12px] text-ink-400">≈ {(balance / 8).toFixed(1)} days available</div>
                </CardBody>
              </Card>
            ))}
            {balances.length === 0 ? (
              <Card className="col-span-full">
                <CardBody>
                  <p className="text-[13px] text-ink-500">
                    No leave policies are assigned to you yet — HR can assign one from Settings → PTO.
                  </p>
                </CardBody>
              </Card>
            ) : null}
          </div>

          {balances.length > 0 ? (
            <Card>
              <CardHeader title="Request time off" description="Hours are calculated from working days, minus company holidays." />
              <CardBody>
                <PtoRequestForm policies={balances.map(({ policy, balance }) => ({ value: policy.id, label: `${policy.name} (${balance.toFixed(1)}h)` }))} />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="My requests" />
            {myRequests.length === 0 ? (
              <EmptyState title="No requests yet" />
            ) : (
              <Table>
                <THead><TH>Policy</TH><TH>Dates</TH><TH>Hours</TH><TH>Status</TH><TH>Note</TH><TH></TH></THead>
                <tbody>
                  {myRequests.map((r) => (
                    <TRow key={r.id}>
                      <TD>{r.policy.name}</TD>
                      <TD>{fmtDate(r.startDate)} – {fmtDate(r.endDate)}</TD>
                      <TD className="tabular-nums">{fmtHours(Number(r.hours))}</TD>
                      <TD><StatusBadge status={r.status} /></TD>
                      <TD className="max-w-48 truncate">{r.decisionNote ?? r.note ?? '—'}</TD>
                      <TD>
                        {(r.status === 'PENDING' || (r.status === 'APPROVED' && r.startDate > new Date())) && (
                          <CancelPtoButton requestId={r.id} />
                        )}
                      </TD>
                    </TRow>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'approvals' && isApprover ? (
        <Card>
          <CardHeader title={`Pending requests (${pending.length})`} description="Approving books the hours against the worker's balance." />
          {pending.length === 0 ? (
            <EmptyState title="No pending requests" description="Requests from your team will appear here." />
          ) : (
            <ul className="divide-y divide-ink-100">
              {pending.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                  <div>
                    <Link href={`/people/${r.worker.id}`} className="text-sm font-medium text-ink-900 hover:text-brand-600">
                      {fullName(r.worker)}
                    </Link>
                    <div className="text-[13px] text-ink-500">
                      {r.policy.name} · {fmtDate(r.startDate)} – {fmtDate(r.endDate)} · {fmtHours(Number(r.hours))}
                      {r.note ? ` · “${r.note}”` : ''}
                    </div>
                  </div>
                  <PtoDecideForm requestId={r.id} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === 'admin' && isAdmin ? (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Balances" description="Live balances derived from the transaction ledger." />
            <Table>
              <THead><TH>Worker</TH><TH>Policy</TH><TH>Balance</TH></THead>
              <tbody>
                {allWorkers.flatMap((w) =>
                  w.ptoAssignments.map((a) => {
                    const bal = adminBalances.find((b) => b.workerId === w.id && b.policyId === a.policyId);
                    return (
                      <TRow key={`${w.id}-${a.policyId}`}>
                        <TD>
                          <Link href={`/people/${w.id}?tab=time-off`} className="font-medium text-ink-900 hover:text-brand-600">
                            {fullName(w)}
                          </Link>
                        </TD>
                        <TD>{a.policy.name}</TD>
                        <TD className="tabular-nums">{fmtHours(bal?.balance ?? 0)}</TD>
                      </TRow>
                    );
                  }),
                )}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Manual adjustment" description="Requires a reason; every adjustment is audited." />
            <CardBody>
              <AdjustBalanceForm
                workers={allWorkers.map((w) => ({ value: w.id, label: fullName(w) }))}
                policies={(await db.ptoPolicy.findMany({ where: { active: true } })).map((p) => ({ value: p.id, label: p.name }))}
              />
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
