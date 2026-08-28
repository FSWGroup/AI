import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission, can } from '@/lib/authz';
import { fmtMoney, fullName } from '@/lib/format';
import { Badge, Card, EmptyState, PageHeader, Table, THead, TH, TRow, TD } from '@/components/ui';
import { SearchBox } from '@/components/ui/client';
import { CompChangeRequestButton } from './comp-request';

export const metadata: Metadata = { title: 'Compensation' };

export default async function CompPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'comp.read');
  const { q } = await searchParams;

  const workers = await db.worker.findMany({
    where: {
      status: { in: ['ACTIVE', 'ONBOARDING', 'ON_LEAVE'] },
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { legalFirstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { lastName: 'asc' },
    include: {
      compensations: { where: { effectiveTo: null }, take: 1 },
      employments: { where: { effectiveTo: null }, take: 1, include: { department: true } },
    },
  });
  const bands = await db.salaryBand.findMany();

  return (
    <div>
      <PageHeader
        title="Compensation"
        description="Current pay with salary-band positioning. Full history lives on each profile."
      />
      <Card>
        <div className="border-b border-ink-100 px-4 py-3">
          <SearchBox placeholder="Search people…" />
        </div>
        {workers.length === 0 ? (
          <EmptyState title="No workers found" />
        ) : (
          <Table>
            <THead>
              <TH>Worker</TH><TH>Department</TH><TH>Current pay</TH><TH>Band</TH><TH>Compa-ratio</TH><TH></TH>
            </THead>
            <tbody>
              {workers.map((w) => {
                const comp = w.compensations[0];
                const emp = w.employments[0];
                const band = emp?.jobFamily && emp?.jobLevel
                  ? bands.find((b) => b.jobFamily === emp.jobFamily && b.jobLevel === emp.jobLevel && b.geography === w.country)
                  : undefined;
                const compa =
                  band && comp && comp.rateType === 'ANNUAL'
                    ? (Number(comp.amount) / Number(band.midAmount)) * 100
                    : null;
                return (
                  <TRow key={w.id}>
                    <TD>
                      <Link href={`/people/${w.id}?tab=comp`} className="font-medium text-ink-900 hover:text-brand-600">
                        {fullName(w)}
                      </Link>
                      <span className="block text-[12px] text-ink-400">{emp?.title ?? ''}</span>
                    </TD>
                    <TD>{emp?.department?.name ?? '—'}</TD>
                    <TD className="tabular-nums">
                      {comp ? `${fmtMoney(Number(comp.amount), comp.currency)} / ${comp.rateType.toLowerCase()}` : '—'}
                    </TD>
                    <TD className="tabular-nums">
                      {band ? `${fmtMoney(Number(band.minAmount))} – ${fmtMoney(Number(band.maxAmount))}` : '—'}
                    </TD>
                    <TD>
                      {compa !== null ? (
                        <Badge tone={compa < 85 ? 'amber' : compa > 115 ? 'red' : 'green'}>{compa.toFixed(0)}%</Badge>
                      ) : ('—')}
                    </TD>
                    <TD>
                      {can(ctx, 'comp.write') && comp ? (
                        <CompChangeRequestButton
                          workerId={w.id}
                          workerName={fullName(w)}
                          currency={comp.currency}
                          rateType={comp.rateType}
                        />
                      ) : null}
                    </TD>
                  </TRow>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
