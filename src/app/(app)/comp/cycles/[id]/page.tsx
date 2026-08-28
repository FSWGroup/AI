import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission, can, directReportIds } from '@/lib/authz';
import { fmtDate, fmtMoney, fullName } from '@/lib/format';
import {
  Badge, Callout, Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard, StatusBadge,
  Table, TD, TH, THead, TRow,
} from '@/components/ui';
import { budgetRollUp, annualise } from '@/lib/comp-cycle';
import { compaRatios } from '@/lib/analytics/workforce';
import {
  PopulateButton, SubmitAllButton, CycleStatusButtons, ApplyCycleButton,
  BudgetForm, ProposalEditor, DecideButtons,
} from '../cycle-ui';

export const metadata: Metadata = { title: 'Compensation cycle' };
export const dynamic = 'force-dynamic';

export default async function CompCyclePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'comp.cycle');
  const { id } = await params;

  const cycle = await db.compCycle.findUnique({
    where: { id },
    include: {
      budgets: true,
      proposals: {
        include: {
          worker: {
            select: {
              id: true, legalFirstName: true, preferredName: true, lastName: true,
              employments: { where: { effectiveTo: null }, take: 1, select: { title: true, managerId: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!cycle) notFound();

  const isAdmin = can(ctx, 'comp.write');
  // A manager without comp.write sees only their own reports' proposals —
  // enforced here, not by hiding rows in the browser.
  const myReports = ctx.workerId ? await directReportIds(ctx.workerId) : [];
  const visible = isAdmin
    ? cycle.proposals
    : cycle.proposals.filter((p) => myReports.includes(p.workerId));

  const [rollUp, compa] = await Promise.all([
    isAdmin ? budgetRollUp(cycle.id) : Promise.resolve([]),
    compaRatios(),
  ]);
  const compaBy = new Map(compa.map((c) => [c.workerId, c]));

  const managerIds = [...new Set(rollUp.map((r) => r.managerId))];
  const managers = managerIds.length
    ? await db.worker.findMany({
        where: { id: { in: managerIds } },
        select: { id: true, legalFirstName: true, preferredName: true, lastName: true },
      })
    : [];
  const managerName = (mid: string) => {
    const m = managers.find((x) => x.id === mid);
    return m ? fullName(m) : 'Unassigned';
  };

  const approved = visible.filter((p) => p.status === 'APPROVED');
  const submitted = visible.filter((p) => p.status === 'SUBMITTED');
  const totalIncrease = visible.reduce((sum, p) => {
    if (p.proposedAmount === null) return sum;
    return sum + (annualise(Number(p.proposedAmount), p.rateType) - annualise(Number(p.currentAmount), p.rateType));
  }, 0);
  const editable = cycle.status === 'PLANNING' || cycle.status === 'DRAFT';
  const overBudget = rollUp.filter((r) => r.overBudget);

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Cycles', href: '/comp/cycles' }, { label: cycle.name }]}
        title={cycle.name}
        description={`Effective ${fmtDate(cycle.effectiveDate)}${cycle.budgetPct ? ` · ${Number(cycle.budgetPct)}% pool` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={cycle.status} />
            {isAdmin && editable ? <PopulateButton cycleId={cycle.id} /> : null}
            {editable ? <SubmitAllButton cycleId={cycle.id} /> : null}
            {isAdmin ? <CycleStatusButtons cycleId={cycle.id} status={cycle.status} /> : null}
            {isAdmin && cycle.status === 'APPROVED' ? (
              <ApplyCycleButton cycleId={cycle.id} approvedCount={approved.length} />
            ) : null}
          </div>
        }
      />

      {cycle.guidance ? <Callout tone="info">{cycle.guidance}</Callout> : null}
      {cycle.status === 'APPLIED' ? (
        <Callout tone="info">
          Applied on {fmtDate(cycle.appliedAt)}. Each increase is a new effective-dated compensation row; the previous
          rows were closed, not overwritten.
        </Callout>
      ) : null}
      {overBudget.length > 0 ? (
        <Callout tone="warn">
          {overBudget.length} manager{overBudget.length === 1 ? ' is' : 's are'} over budget. Proposals can still be
          submitted — the roll-up is there to make the overage visible before it is approved, not to block it.
        </Callout>
      ) : null}

      <div className="my-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="In the cycle" value={visible.length} />
        <StatCard label="Awaiting decision" value={submitted.length} tone={submitted.length > 0 ? 'warn' : 'default'} />
        <StatCard label="Approved" value={approved.length} tone="ok" />
        <StatCard label="Annualised increase" value={fmtMoney(totalIncrease, cycle.currency)} />
      </div>

      {isAdmin && rollUp.length > 0 ? (
        <Card className="mb-4">
          <CardHeader
            title="Budget roll-up"
            description="Drafts count against the budget as well as submitted proposals, so a manager sees the effect while typing."
          />
          <CardBody>
            <Table>
              <THead>
                <TH>Manager</TH>
                <TH>Budget</TH>
                <TH>Proposed</TH>
                <TH>Remaining</TH>
                <TH>Proposals</TH>
                <TH />
              </THead>
              <tbody>
                {rollUp.map((row) => (
                  <TRow key={row.managerId}>
                    <TD>{managerName(row.managerId)}</TD>
                    <TD className="tabular-nums">{fmtMoney(row.budget, cycle.currency)}</TD>
                    <TD className="tabular-nums">{fmtMoney(row.proposed, cycle.currency)}</TD>
                    <TD className="tabular-nums">
                      <span className={row.overBudget ? 'font-medium text-danger-500' : undefined}>
                        {fmtMoney(row.remaining, cycle.currency)}
                      </span>
                    </TD>
                    <TD className="tabular-nums">
                      {row.submittedCount}/{row.proposalCount} submitted
                    </TD>
                    <TD>{editable ? <BudgetForm cycleId={cycle.id} managerId={row.managerId} amount={row.budget} /> : null}</TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={isAdmin ? `Proposals (${visible.length})` : `My team (${visible.length})`}
          description="Compa-ratio is against the band midpoint for the role. Below-minimum is flagged first."
        />
        <CardBody>
          {visible.length === 0 ? (
            <EmptyState
              title="Nobody in this cycle yet"
              description={isAdmin ? 'Use “Add eligible people” to build the population.' : 'None of your reports are in this cycle.'}
            />
          ) : (
            <Table>
              <THead>
                <TH>Person</TH>
                <TH>Current</TH>
                <TH>Proposed</TH>
                <TH>Increase</TH>
                <TH>Compa</TH>
                <TH>Status</TH>
                <TH />
              </THead>
              <tbody>
                {visible.map((p) => {
                  const c = compaBy.get(p.workerId);
                  const belowMin = c?.position === 'BELOW_MIN';
                  return (
                    <TRow key={p.id}>
                      <TD>
                        <Link href={`/people/${p.workerId}`} className="text-ink-900 hover:text-brand-600">
                          {fullName(p.worker)}
                        </Link>
                        <span className="block text-[12px] text-ink-500">{p.worker.employments[0]?.title ?? '—'}</span>
                      </TD>
                      <TD className="tabular-nums">{fmtMoney(Number(p.currentAmount), p.currency)}</TD>
                      <TD className="tabular-nums">
                        {p.proposedAmount === null ? <span className="text-ink-400">—</span> : fmtMoney(Number(p.proposedAmount), p.currency)}
                      </TD>
                      <TD className="tabular-nums">
                        {p.increasePct === null ? '—' : `${Number(p.increasePct).toFixed(1)}%`}
                      </TD>
                      <TD className="tabular-nums">
                        {c ? c.compaRatio.toFixed(2) : '—'}
                        {belowMin ? <Badge tone="red">below min</Badge> : null}
                      </TD>
                      <TD><StatusBadge status={p.status} /></TD>
                      <TD>
                        <div className="flex items-center gap-1">
                          <ProposalEditor
                            editable={editable && p.status !== 'APPLIED'}
                            proposal={{
                              id: p.id,
                              workerName: fullName(p.worker),
                              title: p.worker.employments[0]?.title ?? null,
                              currentAmount: Number(p.currentAmount),
                              proposedAmount: p.proposedAmount === null ? null : Number(p.proposedAmount),
                              increasePct: p.increasePct === null ? null : Number(p.increasePct),
                              rateType: p.rateType,
                              currency: p.currency,
                              reason: p.reason,
                              justification: p.justification,
                              status: p.status,
                              compaRatio: c?.compaRatio ?? null,
                              bandMin: c?.bandMin ?? null,
                            }}
                          />
                          {isAdmin && p.status === 'SUBMITTED' ? <DecideButtons proposalId={p.id} /> : null}
                        </div>
                      </TD>
                    </TRow>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
