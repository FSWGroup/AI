import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { fmtDateTime } from '@/lib/format';
import {
  Badge, Callout, Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard,
  Table, TD, TH, THead, TRow,
} from '@/components/ui';
import { accessExceptions } from '@/lib/access';
import { ReprovisionButton, NoteExceptionButton } from '../profiles/profile-ui';

export const metadata: Metadata = { title: 'Access exceptions' };
export const dynamic = 'force-dynamic';

const KIND_LABEL = {
  STILL_HAS_ACCESS_AFTER_LEAVING: 'Still has access after leaving',
  MISSING_ENTITLEMENT: 'Missing an expected entitlement',
  ACCESS_WITHOUT_PROFILE: 'Access no profile accounts for',
} as const;

export default async function AccessExceptionsPage() {
  const ctx = await requireCtx();
  assertPermission(ctx, 'apps.admin');

  const [exceptions, recentEvents] = await Promise.all([
    accessExceptions(),
    db.accessEvent.findMany({
      orderBy: { at: 'desc' },
      take: 30,
      include: { worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } } },
    }),
  ]);

  const leavers = exceptions.filter((e) => e.kind === 'STILL_HAS_ACCESS_AFTER_LEAVING');
  const missing = exceptions.filter((e) => e.kind === 'MISSING_ENTITLEMENT');
  const unaccounted = exceptions.filter((e) => e.kind === 'ACCESS_WITHOUT_PROFILE');
  const oldest = leavers[0]?.daysOutstanding ?? null;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'App Access', href: '/apps' }, { label: 'Exceptions' }]}
        title="Access exceptions"
        description="Where the record and reality disagree."
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Leavers with live access"
          value={leavers.length}
          hint={oldest !== null ? `oldest ${oldest} days` : undefined}
          tone={leavers.length > 0 ? 'danger' : 'ok'}
        />
        <StatCard label="Missing entitlements" value={missing.length} tone={missing.length > 0 ? 'warn' : 'default'} />
        <StatCard label="Access outside a profile" value={unaccounted.length} />
        <StatCard label="Evidence records" value={recentEvents.length >= 30 ? '30+' : recentEvents.length} />
      </div>

      {leavers.length > 0 ? (
        <Callout tone="danger">
          {leavers.length} account{leavers.length === 1 ? '' : 's'} belonging to people who have left {leavers.length === 1 ? 'is' : 'are'} still
          active. This is the finding an auditor opens with, and the one nobody discovers on their own.
        </Callout>
      ) : null}

      <Card className="mt-4 mb-4">
        <CardHeader title={`Exceptions (${exceptions.length})`} description="Leavers first, oldest first." />
        <CardBody>
          {exceptions.length === 0 ? (
            <EmptyState
              title="Nothing outstanding"
              description="Every leaver's access is revoked and every profile entitlement is granted."
            />
          ) : (
            <Table>
              <THead>
                <TH>Kind</TH>
                <TH>Person</TH>
                <TH>Application</TH>
                <TH>Detail</TH>
                <TH />
              </THead>
              <tbody>
                {exceptions.map((e, i) => (
                  <TRow key={`${e.workerId}-${e.appId ?? i}-${e.kind}`}>
                    <TD>
                      <Badge tone={e.kind === 'STILL_HAS_ACCESS_AFTER_LEAVING' ? 'red' : e.kind === 'MISSING_ENTITLEMENT' ? 'amber' : 'gray'}>
                        {KIND_LABEL[e.kind]}
                      </Badge>
                    </TD>
                    <TD>
                      <Link href={`/people/${e.workerId}`} className="text-ink-900 hover:text-brand-600">{e.workerName}</Link>
                    </TD>
                    <TD>{e.appName}</TD>
                    <TD className="max-w-md text-[12.5px] text-ink-600">{e.detail}</TD>
                    <TD>
                      <div className="flex items-center gap-1">
                        {e.kind === 'MISSING_ENTITLEMENT' ? <ReprovisionButton workerId={e.workerId} /> : null}
                        <NoteExceptionButton workerId={e.workerId} appId={e.appId} appName={e.appName} />
                      </div>
                    </TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Evidence log"
          description="Append-only. This is what answers “prove that access was removed when they left”."
        />
        <CardBody>
          {recentEvents.length === 0 ? (
            <EmptyState title="No access events yet" />
          ) : (
            <Table>
              <THead>
                <TH>When</TH>
                <TH>Person</TH>
                <TH>Application</TH>
                <TH>Action</TH>
                <TH>Detail</TH>
              </THead>
              <tbody>
                {recentEvents.map((event) => (
                  <TRow key={event.id}>
                    <TD>{fmtDateTime(event.at)}</TD>
                    <TD>{`${event.worker.preferredName || event.worker.legalFirstName} ${event.worker.lastName}`}</TD>
                    <TD>{event.appName}</TD>
                    <TD>
                      <Badge tone={event.action.startsWith('REVOKE') ? 'red' : event.action === 'EXCEPTION_NOTED' ? 'amber' : 'blue'}>
                        {event.action.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                    </TD>
                    <TD className="max-w-md text-[12.5px] text-ink-600">{event.detail ?? '—'}</TD>
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
