import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, assertPermission, can } from '@/lib/authz';
import { findReport } from '@/lib/reports';
import { fmtDate, isoDate } from '@/lib/format';
import {
  Badge, ButtonLink, Callout, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge, Table, THead, TH, TRow, TD,
} from '@/components/ui';
import { NewPeriodForm, PeriodStatusForm } from './payroll-forms';

export const metadata: Metadata = { title: 'Payroll hub' };

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'payroll.read');
  const params = await searchParams;
  const isAdmin = can(ctx, 'payroll.admin');

  const periods = await db.payrollPeriod.findMany({ orderBy: { periodStart: 'desc' }, take: 24 });
  const selected = params.period
    ? periods.find((p) => p.id === params.period)
    : periods.find((p) => p.status !== 'CLOSED') ?? periods[0];

  const changeReport =
    selected &&
    (await findReport('payroll-changes')!.run(ctx, {
      start: isoDate(selected.periodStart),
      end: isoDate(selected.periodEnd),
    }));

  return (
    <div>
      <PageHeader
        title="Payroll hub"
        description="A payroll-ready view of what changed — FSW People prepares the data; your payroll provider runs pay and files taxes."
      />
      <Callout tone="info">
        FSW People does not calculate or file payroll taxes. Use the change report and CSV export to feed Gusto, ADP,
        Paychex, QuickBooks Payroll or another provider (adapters live in Admin → Integrations).
      </Callout>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {selected ? (
            <Card>
              <CardHeader
                title={`Changes: ${fmtDate(selected.periodStart)} – ${fmtDate(selected.periodEnd)}`}
                description={`Pay date ${fmtDate(selected.payDate)} · ${changeReport?.rows.length ?? 0} change rows`}
                actions={
                  <div className="flex items-center gap-2">
                    <StatusBadge status={selected.status} />
                    {can(ctx, 'reports.export') ? (
                      <ButtonLink
                        variant="secondary"
                        size="sm"
                        href={`/api/exports?report=payroll-changes&start=${isoDate(selected.periodStart)}&end=${isoDate(selected.periodEnd)}`}
                      >
                        Export CSV
                      </ButtonLink>
                    ) : null}
                  </div>
                }
              />
              {!changeReport || changeReport.rows.length === 0 ? (
                <EmptyState title="No payroll-relevant changes in this period" />
              ) : (
                <Table>
                  <THead>
                    {changeReport.headers.map((h) => (
                      <TH key={h}>{h}</TH>
                    ))}
                  </THead>
                  <tbody>
                    {changeReport.rows.map((row, i) => (
                      <TRow key={i}>
                        {row.map((cell, j) => (
                          <TD key={j} className={j === 0 ? 'font-medium' : ''}>
                            {j === 0 ? <Badge tone="blue">{String(cell).replace(/_/g, ' ').toLowerCase()}</Badge> : (cell ?? '—')}
                          </TD>
                        ))}
                      </TRow>
                    ))}
                  </tbody>
                </Table>
              )}
              {isAdmin ? (
                <CardBody className="border-t border-ink-100">
                  <PeriodStatusForm periodId={selected.id} status={selected.status} />
                </CardBody>
              ) : null}
            </Card>
          ) : (
            <Card><EmptyState title="No payroll periods" description="Create one to generate a change report." /></Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Periods" />
            <ul className="divide-y divide-ink-100">
              {periods.map((p) => (
                <li key={p.id}>
                  <a
                    href={`/payroll?period=${p.id}`}
                    className={`flex items-center justify-between px-5 py-2.5 text-sm hover:bg-brand-50/40 ${selected?.id === p.id ? 'bg-brand-50/60' : ''}`}
                  >
                    <span>{fmtDate(p.periodStart)} – {fmtDate(p.periodEnd)}</span>
                    <StatusBadge status={p.status} />
                  </a>
                </li>
              ))}
            </ul>
          </Card>
          {isAdmin ? (
            <Card>
              <CardHeader title="New period" />
              <CardBody>
                <NewPeriodForm />
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
