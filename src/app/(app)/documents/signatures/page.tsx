import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission, can } from '@/lib/authz';
import { fmtDate, fmtDateTime, fullName } from '@/lib/format';
import {
  Badge, Callout, Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard,
  Table, TD, TH, THead, TRow,
} from '@/components/ui';
import { esignConfigured } from '@/lib/esign';
import { isOverdue } from '@/lib/esign/types';
import { signatureSummary } from '@/lib/signatures';
import {
  StatusBadgeForSignature, RemindButton, CancelSignatureButton,
  RetryStoreButton, CertificateButton,
} from '../signature-ui';

export const metadata: Metadata = { title: 'Signature status' };
export const dynamic = 'force-dynamic';

export default async function SignatureStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'docs.read_all');
  const canWrite = can(ctx, 'docs.write');
  const { status } = await searchParams;

  const now = new Date();
  const [summary, requests] = await Promise.all([
    signatureSummary(now),
    db.signatureRequest.findMany({
      where: status ? { status } : {},
      include: {
        worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
        documentVersion: { include: { document: { select: { id: true, title: true, category: true } } } },
        events: { orderBy: { at: 'desc' }, take: 1 },
      },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    }),
  ]);

  const needsAttention = requests.filter((r) => r.status === 'FAILED' || r.status === 'SIGNED');
  const filters = [
    { key: '', label: 'All' },
    { key: 'SENT', label: 'Awaiting' },
    { key: 'VIEWED', label: 'Opened' },
    { key: 'STORED', label: 'Signed & filed' },
    { key: 'DECLINED', label: 'Declined' },
    { key: 'FAILED', label: 'Needs attention' },
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Documents', href: '/documents' }, { label: 'Signature status' }]}
        title="Signature status"
        description="Every document out for certified signature, and where each one has got to."
      />

      {!esignConfigured() ? (
        <Callout tone="info">
          No signing provider is configured, so nothing new can be sent. Existing requests and their history are still
          shown. An administrator connects one under Admin › Integrations.
        </Callout>
      ) : null}

      <div className="my-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Outstanding" value={summary.outstanding} />
        <StatCard label="Overdue" value={summary.overdue} tone={summary.overdue > 0 ? 'danger' : 'default'} />
        <StatCard label="Signed &amp; filed" value={summary.signed} tone="ok" />
        <StatCard label="Declined" value={summary.declined} tone={summary.declined > 0 ? 'warn' : 'default'} />
        <StatCard label="Needs attention" value={summary.failed} tone={summary.failed > 0 ? 'danger' : 'default'} />
      </div>

      {needsAttention.length > 0 ? (
        <Callout tone="warn">
          {needsAttention.length} request{needsAttention.length === 1 ? '' : 's'} reached the provider&rsquo;s
          &ldquo;signed&rdquo; state but the signed file and certificate are not yet in our own storage. Until they are,
          the evidence lives only at the provider. Retry below — the maintenance sweep also retries these automatically.
        </Callout>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <Link
            key={f.key}
            href={f.key ? `/documents/signatures?status=${f.key}` : '/documents/signatures'}
            className={`rounded-full border px-2.5 py-1 text-[12px] ${
              (status ?? '') === f.key
                ? 'border-brand-400 bg-brand-50 text-brand-700'
                : 'border-ink-200 text-ink-600 hover:border-brand-400'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader
          title={`Requests (${requests.length})`}
          description="Status is read from FSW People's own records — never by querying the provider live, which would be slow and blank whenever they had a bad day."
        />
        <CardBody>
          {requests.length === 0 ? (
            <EmptyState
              title="Nothing out for signature"
              description="Send a document from its detail page to see it tracked here."
            />
          ) : (
            <Table>
              <THead>
                <TH>Document</TH>
                <TH>Signer</TH>
                <TH>Status</TH>
                <TH>Due</TH>
                <TH>Last activity</TH>
                <TH />
              </THead>
              <tbody>
                {requests.map((r) => {
                  const overdue = isOverdue(r.status, r.dueAt, now);
                  return (
                    <TRow key={r.id}>
                      <TD>
                        <Link
                          href={`/documents/${r.documentVersion.documentId}`}
                          className="text-ink-900 hover:text-brand-600"
                        >
                          {r.documentVersion.document.title}
                        </Link>
                        <span className="block text-[12px] text-ink-400">
                          {r.documentVersion.document.category.replace(/_/g, ' ').toLowerCase()}
                        </span>
                      </TD>
                      <TD>
                        <Link href={`/people/${r.workerId}`} className="text-ink-900 hover:text-brand-600">
                          {fullName(r.worker)}
                        </Link>
                        <span className="block text-[12px] text-ink-400">{r.signerEmail}</span>
                        {r.signerName !== fullName(r.worker) ? (
                          // The name captured when the request was sent. If it
                          // differs now, the evidence is what was sent, not
                          // what the directory says today.
                          <span className="block text-[12px] text-ink-500">requested as {r.signerName}</span>
                        ) : null}
                      </TD>
                      <TD>
                        <StatusBadgeForSignature status={r.status} />
                        {r.lastError ? (
                          <span className="block max-w-xs truncate text-[12px] text-danger-500">{r.lastError}</span>
                        ) : null}
                      </TD>
                      <TD>
                        {r.dueAt ? (
                          overdue ? <Badge tone="red">{fmtDate(r.dueAt)}</Badge> : fmtDate(r.dueAt)
                        ) : (
                          '—'
                        )}
                      </TD>
                      <TD className="text-[12px] text-ink-600">
                        {r.events[0] ? (
                          <>
                            {r.events[0].kind.toLowerCase()}
                            <span className="block text-ink-400">{fmtDateTime(r.events[0].at)}</span>
                          </>
                        ) : (
                          fmtDateTime(r.createdAt)
                        )}
                      </TD>
                      <TD>
                        <div className="flex flex-wrap items-center gap-1">
                          {r.certificateFileKey ? <CertificateButton requestId={r.id} /> : null}
                          {canWrite && ['SENT', 'VIEWED'].includes(r.status) ? (
                            <>
                              <RemindButton requestId={r.id} />
                              <CancelSignatureButton requestId={r.id} />
                            </>
                          ) : null}
                          {canWrite && ['SIGNED', 'FAILED'].includes(r.status) ? (
                            <RetryStoreButton requestId={r.id} />
                          ) : null}
                        </div>
                      </TD>
                    </TRow>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <p className="mt-4 text-[12px] text-ink-500">
        A signed document becomes a new version of the original, so it appears in that document&rsquo;s own history and
        downloads through the same audited link as everything else. The provider&rsquo;s audit certificate is stored
        alongside it — so if FSW ever leaves this provider, the proof of who signed what comes too.
      </p>
    </div>
  );
}
