import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, can } from '@/lib/authz';
import { fmtDate, fmtMoney, humanize } from '@/lib/format';
import { fullName } from '@/lib/format';
import { Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge, Table, THead, TH, TRow, TD } from '@/components/ui';
import { EnrollForm, PlanForm } from './benefit-forms';

export const metadata: Metadata = { title: 'Benefits' };

export default async function BenefitsPage() {
  const ctx = await requireCtx();
  const isAdmin = can(ctx, 'benefits.admin');

  const plans = await db.benefitPlan.findMany({ where: { active: true }, orderBy: { kind: 'asc' } });
  const myEnrollments = ctx.workerId
    ? await db.benefitEnrollment.findMany({
        where: { workerId: ctx.workerId },
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
      })
    : [];

  const allEnrollments = isAdmin
    ? await db.benefitEnrollment.findMany({
        where: { status: 'ENROLLED' },
        include: {
          plan: true,
          worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
    : [];
  const totalEmployerCost = allEnrollments.reduce((sum, e) => sum + Number(e.employerContributionMonthly ?? 0), 0);

  const enrolledPlanIds = new Set(myEnrollments.filter((e) => e.status === 'ENROLLED').map((e) => e.planId));

  return (
    <div>
      <PageHeader
        title="Benefits"
        description={ctx.workerId ? 'Your elections, and the plans available to you.' : 'Benefit plans.'}
      />
      <div className="space-y-4">
        {ctx.workerId ? (
          <Card>
            <CardHeader title="My benefits" />
            {myEnrollments.length === 0 ? (
              <EmptyState title="No elections yet" description="Enroll in an available plan below, or waive coverage." />
            ) : (
              <Table>
                <THead><TH>Plan</TH><TH>Coverage</TH><TH>My cost / mo</TH><TH>FSW pays / mo</TH><TH>Effective</TH><TH>Status</TH></THead>
                <tbody>
                  {myEnrollments.map((e) => (
                    <TRow key={e.id}>
                      <TD className="font-medium">{e.plan.name}<span className="block text-[12px] font-normal text-ink-400">{humanize(e.plan.kind)} · {e.plan.provider ?? ''}</span></TD>
                      <TD>{humanize(e.coverageLevel)}</TD>
                      <TD className="tabular-nums">{fmtMoney(Number(e.employeeContributionMonthly ?? 0))}</TD>
                      <TD className="tabular-nums">{fmtMoney(Number(e.employerContributionMonthly ?? 0))}</TD>
                      <TD>{fmtDate(e.effectiveFrom)}</TD>
                      <TD><StatusBadge status={e.status} /></TD>
                    </TRow>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        ) : null}

        {ctx.workerId && plans.some((p) => !enrolledPlanIds.has(p.id)) ? (
          <Card>
            <CardHeader title="Available plans" description="Elections outside open enrollment normally require a qualifying life event — HR reviews each election." />
            <CardBody className="space-y-4">
              {plans
                .filter((p) => !enrolledPlanIds.has(p.id))
                .map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-ink-100 px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-ink-900">{p.name}</div>
                      <div className="text-[12px] text-ink-400">
                        {humanize(p.kind)} · {p.provider ?? '—'} · you pay {fmtMoney(Number(p.employeeCostMonthly ?? 0))}/mo, FSW pays{' '}
                        {fmtMoney(Number(p.employerCostMonthly ?? 0))}/mo
                        {p.waitingPeriodDays ? ` · ${p.waitingPeriodDays}-day waiting period` : ''}
                      </div>
                    </div>
                    <EnrollForm planId={p.id} />
                  </div>
                ))}
            </CardBody>
          </Card>
        ) : null}

        {isAdmin ? (
          <>
            <Card>
              <CardHeader
                title="Enrollment overview (HR)"
                description={`Total employer cost: ${fmtMoney(totalEmployerCost)}/month across ${allEnrollments.length} enrollments.`}
              />
              {allEnrollments.length === 0 ? (
                <EmptyState title="No enrollments" />
              ) : (
                <Table>
                  <THead><TH>Worker</TH><TH>Plan</TH><TH>Coverage</TH><TH>Employee / mo</TH><TH>Employer / mo</TH><TH>Effective</TH></THead>
                  <tbody>
                    {allEnrollments.map((e) => (
                      <TRow key={e.id}>
                        <TD className="font-medium">{fullName(e.worker)}</TD>
                        <TD>{e.plan.name}</TD>
                        <TD>{humanize(e.coverageLevel)}</TD>
                        <TD className="tabular-nums">{fmtMoney(Number(e.employeeContributionMonthly ?? 0))}</TD>
                        <TD className="tabular-nums">{fmtMoney(Number(e.employerContributionMonthly ?? 0))}</TD>
                        <TD>{fmtDate(e.effectiveFrom)}</TD>
                      </TRow>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
            <Card>
              <CardHeader title="Add a benefit plan" />
              <CardBody>
                <PlanForm />
              </CardBody>
            </Card>
          </>
        ) : null}
      </div>
    </div>
  );
}
