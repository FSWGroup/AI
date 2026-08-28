import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, can } from '@/lib/authz';
import { fmtDate, fmtMoney, fullName } from '@/lib/format';
import {
  Badge, Callout, Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard,
  Table, TD, TH, THead, TRow,
} from '@/components/ui';
import { ReferSomeoneButton, BonusDecision } from '../funnel-ui';

export const metadata: Metadata = { title: 'Referrals' };
export const dynamic = 'force-dynamic';

const STATUS_TONE = { SUBMITTED: 'gray', LINKED: 'blue', HIRED: 'green', CLOSED: 'gray' } as const;
const BONUS_TONE = { NONE: 'gray', PENDING: 'amber', APPROVED: 'blue', PAID: 'green', FORFEITED: 'gray' } as const;

export default async function ReferralsPage() {
  const ctx = await requireCtx();
  // Everyone may refer someone and see their own referrals; the whole list
  // needs recruiting.read.
  const isRecruiter = can(ctx, 'recruiting.read');
  const canDecide = can(ctx, 'recruiting.write');

  const referrals = await db.referral.findMany({
    where: isRecruiter ? {} : { referrerWorkerId: ctx.workerId ?? '__none__' },
    include: {
      referrer: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
      candidate: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  const openJobs = await db.jobRequisition.findMany({
    where: { status: 'OPEN' },
    select: { id: true, title: true },
    orderBy: { title: 'asc' },
  });

  const hired = referrals.filter((r) => r.status === 'HIRED');
  const pendingBonus = referrals.filter((r) => r.bonusStatus === 'PENDING');

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Recruiting', href: '/recruiting/jobs' }, { label: 'Referrals' }]}
        title="Referrals"
        description={
          isRecruiter
            ? 'Every referral, and where each one got to.'
            : 'People you have referred, and how they are doing.'
        }
        actions={<ReferSomeoneButton jobs={openJobs} />}
      />

      {isRecruiter ? (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Referrals" value={referrals.length} />
          <StatCard label="Matched to an application" value={referrals.filter((r) => r.candidateId).length} />
          <StatCard label="Hired" value={hired.length} tone="ok" />
          <StatCard label="Bonuses awaiting a decision" value={pendingBonus.length} tone={pendingBonus.length > 0 ? 'warn' : 'default'} />
        </div>
      ) : null}

      <Callout tone="info">
        A referral is matched to an application by email address, exactly — never by name, because a bonus is a payment
        and two candidates sharing a name would mean paying the wrong person. Bonuses are <em>recorded</em> here and
        paid by payroll; nothing in FSW People moves money.
      </Callout>

      <Card className="mt-4">
        <CardHeader title={`Referrals (${referrals.length})`} />
        <CardBody>
          {referrals.length === 0 ? (
            <EmptyState
              title="No referrals yet"
              description="Know someone who would be good here? Referrals usually close faster and stay longer than any other channel."
              action={<ReferSomeoneButton jobs={openJobs} />}
            />
          ) : (
            <Table>
              <THead>
                <TH>Candidate</TH>
                {isRecruiter ? <TH>Referred by</TH> : null}
                <TH>Status</TH>
                <TH>Bonus</TH>
                <TH>Submitted</TH>
                {canDecide ? <TH /> : null}
              </THead>
              <tbody>
                {referrals.map((r) => (
                  <TRow key={r.id}>
                    <TD>
                      {r.candidate ? (
                        <Link href={`/recruiting/candidates/${r.candidate.id}`} className="text-ink-900 hover:text-brand-600">
                          {r.candidate.firstName} {r.candidate.lastName}
                        </Link>
                      ) : (
                        <span className="text-ink-700">{r.candidateName}</span>
                      )}
                      {r.relationship ? (
                        <span className="block text-[12px] text-ink-400">{r.relationship.replace('_', ' ').toLowerCase()}</span>
                      ) : null}
                    </TD>
                    {isRecruiter ? <TD>{fullName(r.referrer)}</TD> : null}
                    <TD>
                      <Badge tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE] ?? 'gray'}>
                        {r.status === 'SUBMITTED' ? 'awaiting their application' : r.status.toLowerCase()}
                      </Badge>
                    </TD>
                    <TD>
                      <Badge tone={BONUS_TONE[r.bonusStatus as keyof typeof BONUS_TONE] ?? 'gray'}>
                        {r.bonusStatus.toLowerCase()}
                      </Badge>
                      {r.bonusAmount ? (
                        <span className="ml-1 text-[12px] text-ink-600">{fmtMoney(Number(r.bonusAmount), r.bonusCurrency)}</span>
                      ) : null}
                      {r.bonusEligibleAt && r.bonusStatus === 'PENDING' ? (
                        <span className="block text-[12px] text-ink-400">eligible {fmtDate(r.bonusEligibleAt)}</span>
                      ) : null}
                    </TD>
                    <TD>{fmtDate(r.createdAt)}</TD>
                    {canDecide ? (
                      <TD>
                        {r.status === 'HIRED' ? (
                          <BonusDecision
                            referralId={r.id}
                            eligible={!r.bonusEligibleAt || r.bonusEligibleAt <= new Date()}
                          />
                        ) : null}
                      </TD>
                    ) : null}
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
