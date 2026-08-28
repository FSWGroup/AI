import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireCtx } from '@/lib/authz';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { AcknowledgeForm } from './ack-form';
import { markPolicyViewedAction } from '../actions';

export const metadata: Metadata = { title: 'Policy' };

export default async function PolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;

  const policy = await db.policy.findUnique({
    where: { id },
    include: {
      versions: {
        where: { publishedAt: { not: null } },
        orderBy: { version: 'desc' },
        include: { acks: ctx.workerId ? { where: { workerId: ctx.workerId } } : false },
      },
    },
  });
  if (!policy || policy.versions.length === 0) notFound();
  const current = policy.versions[0];
  const myAck = ctx.workerId ? current.acks?.[0] : undefined;

  if (myAck && !myAck.viewedAt) await markPolicyViewedAction(current.id);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        breadcrumbs={[{ label: 'Policies', href: '/policies' }, { label: policy.title }]}
        title={policy.title}
        description={`Version ${current.version} · effective ${fmtDate(current.effectiveAt)}`}
        actions={
          myAck?.acknowledgedAt ? <Badge tone="green">Acknowledged {fmtDateTime(myAck.acknowledgedAt)}</Badge> : undefined
        }
      />
      <Card>
        <CardBody>
          <div
            className="prose prose-sm max-w-none text-sm leading-relaxed text-ink-800"
            dangerouslySetInnerHTML={{ __html: current.bodyHtml ?? '' }}
          />
        </CardBody>
      </Card>
      {myAck && !myAck.acknowledgedAt && current.requiresAck ? (
        <Card className="mt-4">
          <CardHeader title="Acknowledgment required" description="Confirm you have read and understood this policy." />
          <CardBody>
            <AcknowledgeForm versionId={current.id} />
          </CardBody>
        </Card>
      ) : null}
      {policy.versions.length > 1 ? (
        <p className="mt-4 text-[12px] text-ink-400">
          {policy.versions.length - 1} previous version{policy.versions.length > 2 ? 's are' : ' is'} preserved with
          acknowledgment history.
        </p>
      ) : null}
    </div>
  );
}
