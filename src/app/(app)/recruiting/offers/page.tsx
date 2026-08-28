import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { fmtDate, fmtMoney } from '@/lib/format';
import { Card, EmptyState, PageHeader, StatusBadge, Table, THead, TH, TRow, TD } from '@/components/ui';
import { OfferActions } from './offer-actions';

export const metadata: Metadata = { title: 'Offers' };

export default async function OffersPage() {
  const ctx = await requireCtx();
  assertPermission(ctx, 'recruiting.write');

  const offers = await db.offer.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      application: { include: { candidate: true } },
      requisition: { select: { title: true } },
    },
  });

  return (
    <div>
      <PageHeader
        title="Offers"
        description="Offers route through approval, get sent to the candidate, and accepted offers convert straight into onboarding."
      />
      <Card>
        {offers.length === 0 ? (
          <EmptyState title="No offers yet" description="Create an offer from a candidate card in a job pipeline." />
        ) : (
          <Table>
            <THead>
              <TH>Candidate</TH><TH>Role</TH><TH>Compensation</TH><TH>Start</TH><TH>Expires</TH><TH>Status</TH><TH></TH>
            </THead>
            <tbody>
              {offers.map((o) => (
                <TRow key={o.id}>
                  <TD>
                    <Link href={`/recruiting/candidates/${o.application.candidateId}`} className="font-medium text-ink-900 hover:text-brand-600">
                      {o.application.candidate.firstName} {o.application.candidate.lastName}
                    </Link>
                  </TD>
                  <TD>{o.title}</TD>
                  <TD className="tabular-nums">
                    {fmtMoney(Number(o.amount), o.currency)} / {o.rateType.toLowerCase()}
                    {o.bonusTargetPct ? ` + ${o.bonusTargetPct}% bonus` : ''}
                  </TD>
                  <TD>{fmtDate(o.startDate)}</TD>
                  <TD>{fmtDate(o.expiresAt)}</TD>
                  <TD><StatusBadge status={o.status} /></TD>
                  <TD>
                    <OfferActions offerId={o.id} status={o.status} hiredWorkerId={o.hiredWorkerId} />
                  </TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
