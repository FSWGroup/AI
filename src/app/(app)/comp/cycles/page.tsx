import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission, can } from '@/lib/authz';
import { fmtDate, fmtMoney } from '@/lib/format';
import { Card, CardBody, EmptyState, PageHeader, StatusBadge, Table, TD, TH, THead, TRow } from '@/components/ui';
import { NewCycleButton } from './cycle-ui';

export const metadata: Metadata = { title: 'Compensation cycles' };
export const dynamic = 'force-dynamic';

export default async function CompCyclesPage() {
  const ctx = await requireCtx();
  assertPermission(ctx, 'comp.cycle');

  const cycles = await db.compCycle.findMany({
    orderBy: { effectiveDate: 'desc' },
    include: { _count: { select: { proposals: true } } },
  });

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Compensation', href: '/comp' }, { label: 'Cycles' }]}
        title="Compensation cycles"
        description="Merit planning with the budget rolled up live, landing as effective-dated pay history."
        actions={can(ctx, 'comp.write') ? <NewCycleButton /> : undefined}
      />
      <Card>
        <CardBody>
          {cycles.length === 0 ? (
            <EmptyState
              title="No cycles yet"
              description="A cycle allocates a budget down the org, collects proposals, and writes the approved ones in one go."
              action={can(ctx, 'comp.write') ? <NewCycleButton /> : undefined}
            />
          ) : (
            <Table>
              <THead>
                <TH>Cycle</TH>
                <TH>Status</TH>
                <TH>Effective</TH>
                <TH>Budget</TH>
                <TH>People</TH>
              </THead>
              <tbody>
                {cycles.map((c) => (
                  <TRow key={c.id}>
                    <TD>
                      <Link href={`/comp/cycles/${c.id}`} className="font-medium text-ink-900 hover:text-brand-600">
                        {c.name}
                      </Link>
                    </TD>
                    <TD><StatusBadge status={c.status} /></TD>
                    <TD>{fmtDate(c.effectiveDate)}</TD>
                    <TD>
                      {c.budgetAmount ? fmtMoney(Number(c.budgetAmount), c.currency) : ''}
                      {c.budgetAmount && c.budgetPct ? ' · ' : ''}
                      {c.budgetPct ? `${Number(c.budgetPct)}%` : ''}
                      {!c.budgetAmount && !c.budgetPct ? '—' : ''}
                    </TD>
                    <TD className="tabular-nums">{c._count.proposals}</TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
