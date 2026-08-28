import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission, can } from '@/lib/authz';
import { fmtMoney, fullName, daysBetween, addDays, startOfUTCDay, isoDate } from '@/lib/format';
import { Badge, Card, CardBody, CardHeader, PageHeader, StatCard, Table, THead, TH, TRow, TD } from '@/components/ui';

export const metadata: Metadata = { title: 'Executive dashboard' };

/** Simple inline bar chart — no chart library, no client JS. */
function TrendBars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex h-32 items-end gap-1.5" role="img" aria-label="Monthly headcount trend">
      {data.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-[11px] text-ink-500 tabular-nums">{d.value}</span>
          <div
            className="w-full rounded-t bg-brand-600/85"
            style={{ height: `${Math.max(4, (d.value / max) * 88)}px` }}
            title={`${d.label}: ${d.value}`}
          />
          <span className="text-[10px] text-ink-400">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export default async function ExecutiveDashboardPage() {
  const ctx = await requireCtx();
  assertPermission(ctx, 'exec.dashboard');
  const today = startOfUTCDay();
  const yearAgo = addDays(today, -365);

  const [workers, terminations, entities, openReqs, offers, compensations, ptoTx, reviewsTotal, reviewsDone, onboardings, contractorPayments] =
    await Promise.all([
      db.worker.findMany({
        where: { deletedAt: null },
        select: { id: true, hireDate: true, terminationDate: true, status: true, workerType: true, country: true,
          legalFirstName: true, preferredName: true, lastName: true,
          employments: { where: { effectiveTo: null }, take: 1, select: { legalEntityId: true, departmentId: true, title: true } } },
      }),
      db.worker.findMany({
        where: { terminationDate: { gte: yearAgo } },
        select: { id: true, terminationDate: true, hireDate: true, voluntaryTermination: true },
      }),
      db.legalEntity.findMany({ where: { active: true } }),
      db.jobRequisition.findMany({ where: { status: 'OPEN' }, select: { id: true, title: true, openedAt: true, targetDate: true } }),
      db.offer.findMany({ where: { status: { in: ['ACCEPTED', 'DECLINED'] } }, select: { status: true, sentAt: true, respondedAt: true } }),
      db.compensation.findMany({ where: { effectiveTo: null }, select: { amount: true, currency: true, rateType: true, workerId: true } }),
      db.ptoTransaction.aggregate({ _sum: { hours: true }, where: { kind: 'USAGE' } }),
      db.performanceReview.count(),
      db.performanceReview.count({ where: { status: { in: ['SUBMITTED', 'SHARED'] } } }),
      db.lifecycleInstance.findMany({ where: { kind: 'ONBOARDING' }, include: { tasks: { select: { status: true } } } }),
      db.contractorPayment.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: yearAgo } } }),
    ]);

  const active = workers.filter((w) => ['ACTIVE', 'ONBOARDING', 'ON_LEAVE'].includes(w.status));
  const headcount = active.length;
  const avgTenureDays =
    active.filter((w) => w.hireDate).reduce((sum, w) => sum + daysBetween(w.hireDate!, today), 0) /
    Math.max(1, active.filter((w) => w.hireDate).length);

  // 12-month headcount trend (active at each month end)
  const trend: { label: string; value: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i + 1, 0));
    const count = workers.filter(
      (w) => w.hireDate && w.hireDate <= monthEnd && (!w.terminationDate || w.terminationDate > monthEnd),
    ).length;
    trend.push({ label: monthEnd.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }), value: count });
  }

  const voluntary = terminations.filter((t) => t.voluntaryTermination).length;
  const turnoverRate = headcount > 0 ? (terminations.length / headcount) * 100 : 0;
  // Regrettable ≈ voluntary departures with 1+ years of tenure
  const regrettable = terminations.filter(
    (t) => t.voluntaryTermination && t.hireDate && t.terminationDate && daysBetween(t.hireDate, t.terminationDate) > 365,
  ).length;

  const annualizedLaborCost = compensations.reduce((sum, c) => {
    if (c.currency !== 'USD') return sum; // multi-currency roll-up needs FX rates — see limitations
    const amount = Number(c.amount);
    const annual = c.rateType === 'ANNUAL' ? amount : c.rateType === 'MONTHLY' ? amount * 12 : c.rateType === 'HOURLY' ? amount * 2080 : amount * 260;
    return sum + annual;
  }, 0);

  const acceptedOffers = offers.filter((o) => o.status === 'ACCEPTED');
  const offerAcceptance = offers.length ? (acceptedOffers.length / offers.length) * 100 : 0;
  const timeToFill = openReqs.length
    ? openReqs.filter((r) => r.openedAt).reduce((s, r) => s + daysBetween(r.openedAt!, today), 0) /
      Math.max(1, openReqs.filter((r) => r.openedAt).length)
    : 0;

  const onboardingCompletion = onboardings.length
    ? (onboardings.reduce((sum, i) => {
        const done = i.tasks.filter((t) => t.status === 'COMPLETED').length;
        return sum + (i.tasks.length ? done / i.tasks.length : 1);
      }, 0) /
        onboardings.length) *
      100
    : 0;

  const byEntity = entities.map((e) => ({
    name: e.name,
    count: active.filter((w) => w.employments[0]?.legalEntityId === e.id).length,
  }));

  const international = active.filter((w) => w.country !== 'US').length;
  const contractors = active.filter((w) => w.workerType !== 'EMPLOYEE').length;

  const upcomingHires = workers.filter((w) => w.status === 'PRE_START');

  return (
    <div>
      <PageHeader
        title="Executive dashboard"
        description="Workforce, cost, retention and hiring at a glance. Drill into any figure you have access to."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total headcount" value={headcount} href="/reports?report=headcount" />
        <StatCard label="Employees" value={headcount - contractors} />
        <StatCard label="Contractors" value={contractors} href="/people/contractors" />
        <StatCard label="International" value={international} href="/reports?report=international" />
        <StatCard label="Avg tenure" value={`${(avgTenureDays / 365).toFixed(1)} yr`} />
        <StatCard label="Open roles" value={openReqs.length} href="/recruiting/jobs" />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Annualized labor (USD)"
          value={fmtMoney(annualizedLaborCost)}
          hint="USD-denominated pay only"
          href={can(ctx, 'comp.read') ? '/reports?report=compensation' : undefined}
        />
        <StatCard label="12-mo turnover" value={`${turnoverRate.toFixed(0)}%`} tone={turnoverRate > 20 ? 'warn' : 'ok'} href="/reports?report=turnover" />
        <StatCard label="Regrettable" value={regrettable} hint="voluntary, 1+ yr tenure" />
        <StatCard label="Offer acceptance" value={offers.length ? `${offerAcceptance.toFixed(0)}%` : '—'} />
        <StatCard label="Avg days open" value={timeToFill ? timeToFill.toFixed(0) : '—'} hint="current open roles" />
        <StatCard label="Onboarding complete" value={`${onboardingCompletion.toFixed(0)}%`} href="/reports?report=onboarding-status" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Headcount trend" description="Active workers at each month end, last 12 months." />
          <CardBody>
            <TrendBars data={trend} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Headcount by company" />
          <CardBody>
            <ul className="space-y-2.5">
              {byEntity.map((e) => (
                <li key={e.name}>
                  <div className="mb-1 flex items-center justify-between text-[13px]">
                    <span className="text-ink-700">{e.name}</span>
                    <span className="font-medium text-ink-900 tabular-nums">{e.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-ink-100">
                    <div className="h-full rounded-full bg-brand-600" style={{ width: `${(e.count / Math.max(1, headcount)) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Performance & engagement" />
          <CardBody>
            <ul className="space-y-2 text-[13px]">
              <li className="flex justify-between"><span className="text-ink-600">Review completion</span><span className="font-medium tabular-nums">{reviewsTotal ? ((reviewsDone / reviewsTotal) * 100).toFixed(0) : 0}%</span></li>
              <li className="flex justify-between"><span className="text-ink-600">PTO hours used (all time)</span><span className="font-medium tabular-nums">{Math.abs(Number(ptoTx._sum.hours ?? 0)).toFixed(0)}h</span></li>
              <li className="flex justify-between"><span className="text-ink-600">Voluntary departures (12mo)</span><span className="font-medium tabular-nums">{voluntary}</span></li>
              <li className="flex justify-between"><span className="text-ink-600">Contractor spend (12mo)</span><span className="font-medium tabular-nums">{fmtMoney(Number(contractorPayments._sum.amount ?? 0))}</span></li>
            </ul>
            <p className="mt-3 border-t border-ink-100 pt-2 text-[12px] text-ink-400">
              Labor cost as a percentage of revenue becomes available once financial data is connected through the
              Integration Center.
            </p>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={`Upcoming hires (${upcomingHires.length})`} />
          {upcomingHires.length === 0 ? (
            <CardBody><p className="text-[13px] text-ink-500">No hires scheduled.</p></CardBody>
          ) : (
            <Table>
              <THead><TH>Name</TH><TH>Title</TH><TH>Start date</TH><TH>Type</TH></THead>
              <tbody>
                {upcomingHires.map((w) => (
                  <TRow key={w.id}>
                    <TD>
                      <Link href={`/people/${w.id}`} className="font-medium text-ink-900 hover:text-brand-600">
                        {fullName(w)}
                      </Link>
                    </TD>
                    <TD>{w.employments[0]?.title ?? '—'}</TD>
                    <TD>{isoDate(w.hireDate)}</TD>
                    <TD><Badge tone={w.workerType === 'EMPLOYEE' ? 'blue' : 'amber'}>{w.workerType.toLowerCase()}</Badge></TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
