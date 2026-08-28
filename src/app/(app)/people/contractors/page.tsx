import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { fullName, fmtDate, fmtMoney, humanize, daysBetween } from '@/lib/format';
import {
  Badge, ButtonLink, Card, EmptyState, PageHeader, StatusBadge, Table, THead, TH, TRow, TD,
} from '@/components/ui';
import { SearchBox, FilterSelect } from '@/components/ui/client';

export const metadata: Metadata = { title: 'Contractors' };

export default async function ContractorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'people.read_all');
  const params = await searchParams;

  const contractors = await db.worker.findMany({
    where: {
      workerType: { in: ['CONTRACTOR', 'AGENCY', 'EOR'] },
      deletedAt: null,
      ...(params.country ? { country: params.country } : {}),
      ...(params.q
        ? {
            OR: [
              { legalFirstName: { contains: params.q, mode: 'insensitive' } },
              { lastName: { contains: params.q, mode: 'insensitive' } },
              { contractorProfile: { businessName: { contains: params.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
      status: { notIn: ['TERMINATED'] },
    },
    orderBy: { lastName: 'asc' },
    include: {
      contractorProfile: true,
      compensations: { where: { effectiveTo: null }, take: 1 },
      employments: { where: { effectiveTo: null }, take: 1, include: { department: true } },
    },
  });

  const today = new Date();

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'People', href: '/people' }, { label: 'Contractors' }]}
        title="Contractors"
        description="US and international contractor engagements — agreements, tax forms and payments."
        actions={<ButtonLink href="/people/new">Add contractor</ButtonLink>}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-4 py-3">
          <SearchBox placeholder="Search contractors…" />
          <FilterSelect param="country" allLabel="All countries" ariaLabel="Filter by country"
            options={[{ value: 'US', label: 'United States' }, { value: 'PH', label: 'Philippines' }]} />
        </div>
        {contractors.length === 0 ? (
          <EmptyState title="No contractors" description="Add a contractor from the People section." />
        ) : (
          <Table>
            <THead>
              <TH>Contractor</TH><TH>Engagement</TH><TH>Department</TH><TH>Rate</TH><TH>Contract</TH><TH>Tax form</TH><TH>Status</TH>
            </THead>
            <tbody>
              {contractors.map((w) => {
                const p = w.contractorProfile;
                const comp = w.compensations[0];
                const daysLeft = p?.contractEnd ? daysBetween(today, p.contractEnd) : null;
                return (
                  <TRow key={w.id}>
                    <TD>
                      <Link href={`/people/${w.id}?tab=contractor`} className="font-medium text-ink-900 hover:text-brand-600">
                        {fullName(w)}
                      </Link>
                      <span className="block text-[12px] text-ink-400">
                        {p?.isBusiness ? (p.businessName ?? 'Business') : 'Individual'} · {w.country === 'PH' ? 'Philippines' : w.country}
                      </span>
                    </TD>
                    <TD>{humanize(w.engagementModel ?? 'DIRECT')}</TD>
                    <TD>{w.employments[0]?.department?.name ?? '—'}</TD>
                    <TD className="tabular-nums">
                      {comp ? `${fmtMoney(Number(comp.amount), comp.currency)} / ${comp.rateType.toLowerCase()}` : '—'}
                    </TD>
                    <TD>
                      {p?.contractEnd ? (
                        <span className="flex items-center gap-2">
                          {fmtDate(p.contractEnd)}
                          {daysLeft !== null && daysLeft <= 60 && daysLeft >= 0 ? <Badge tone="amber">{daysLeft}d left</Badge> : null}
                          {daysLeft !== null && daysLeft < 0 ? <Badge tone="red">Expired</Badge> : null}
                        </span>
                      ) : ('—')}
                    </TD>
                    <TD>
                      {w.country === 'US'
                        ? <Badge tone={p?.w9Status === 'RECEIVED' ? 'green' : 'amber'}>W-9 {humanize(p?.w9Status ?? 'MISSING').toLowerCase()}</Badge>
                        : <Badge tone={p?.w8Status === 'RECEIVED' ? 'green' : 'amber'}>W-8 {humanize(p?.w8Status ?? 'MISSING').toLowerCase()}</Badge>}
                    </TD>
                    <TD><StatusBadge status={w.status} /></TD>
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
