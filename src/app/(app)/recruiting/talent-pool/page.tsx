import type { Metadata } from 'next';
import Link from 'next/link';
import { requireCtx, assertPermission, can } from '@/lib/authz';
import { fmtDate } from '@/lib/format';
import {
  Badge, Callout, Card, CardBody, CardHeader, EmptyState, PageHeader,
  Table, TD, TH, THead, TRow,
} from '@/components/ui';
import { talentPoolMatches, talentPoolDueForReview } from '@/lib/recruiting/funnel';
import { RemoveFromPoolButton } from '../funnel-ui';

export const metadata: Metadata = { title: 'Talent pool' };
export const dynamic = 'force-dynamic';

export default async function TalentPoolPage() {
  const ctx = await requireCtx();
  assertPermission(ctx, 'recruiting.read');
  const canWrite = can(ctx, 'recruiting.write');

  const [active, dueForReview] = await Promise.all([talentPoolMatches({ limit: 200 }), talentPoolDueForReview()]);

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Recruiting', href: '/recruiting/jobs' }, { label: 'Talent pool' }]}
        title="Talent pool"
        description="People who interviewed well and lost to someone stronger. Worth a call before advertising again."
      />

      <Callout tone="info">
        Everyone here was explicitly kept by a recruiter, and every entry carries a review date. Once that date passes
        the person stops appearing as a match and shows up below for a keep-or-remove decision — we do not hold onto
        candidate details indefinitely by default.
      </Callout>

      {dueForReview.length > 0 ? (
        <Card className="mt-4">
          <CardHeader
            title={`Due for review (${dueForReview.length})`}
            description="Their review date has passed. Decide to keep them for another period or remove them."
          />
          <CardBody>
            <Table>
              <THead>
                <TH>Candidate</TH>
                <TH>Review was due</TH>
                {canWrite ? <TH /> : null}
              </THead>
              <tbody>
                {dueForReview.map((entry) => (
                  <TRow key={entry.id}>
                    <TD>
                      <Link href={`/recruiting/candidates/${entry.candidateId}`} className="text-ink-900 hover:text-brand-600">
                        {entry.candidate.firstName} {entry.candidate.lastName}
                      </Link>
                    </TD>
                    <TD>{fmtDate(entry.reviewBy)}</TD>
                    {canWrite ? <TD><RemoveFromPoolButton entryId={entry.id} /></TD> : null}
                  </TRow>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      ) : null}

      <Card className="mt-4">
        <CardHeader title={`In the pool (${active.length})`} />
        <CardBody>
          {active.length === 0 ? (
            <EmptyState
              title="Nobody in the pool yet"
              description="Add a strong candidate from their profile when they lose out on a role — they are the cheapest pipeline you have."
            />
          ) : (
            <Table>
              <THead>
                <TH>Candidate</TH>
                <TH>Job family</TH>
                <TH>Why kept</TH>
                <TH>Status</TH>
                <TH>Review by</TH>
                {canWrite ? <TH /> : null}
              </THead>
              <tbody>
                {active.map((entry) => (
                  <TRow key={entry.id}>
                    <TD>
                      <Link href={`/recruiting/candidates/${entry.candidateId}`} className="text-ink-900 hover:text-brand-600">
                        {entry.candidate.firstName} {entry.candidate.lastName}
                      </Link>
                    </TD>
                    <TD>{entry.jobFamily ?? '—'}</TD>
                    <TD className="max-w-md">
                      {entry.reason ?? '—'}
                      {entry.strengthNote ? (
                        <span className="block text-[12px] text-ink-500">{entry.strengthNote}</span>
                      ) : null}
                    </TD>
                    <TD>
                      <Badge tone={entry.status === 'CONTACTED' ? 'blue' : 'gray'}>{entry.status.toLowerCase()}</Badge>
                    </TD>
                    <TD>{fmtDate(entry.reviewBy)}</TD>
                    {canWrite ? <TD><RemoveFromPoolButton entryId={entry.id} /></TD> : null}
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
