import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { env } from '@/lib/env';
import { fmtDateTime } from '@/lib/format';
import { Callout, Card, CardBody, EmptyState, PageHeader, StatusBadge, Table, THead, TH, TRow, TD } from '@/components/ui';

export const metadata: Metadata = { title: 'Email outbox' };

export default async function EmailOutboxPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'settings.admin');
  const params = await searchParams;

  const messages = await db.emailMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  const selected = params.message ? messages.find((m) => m.id === params.message) : undefined;

  return (
    <div>
      <PageHeader
        title="Email outbox"
        description={`Driver: ${env.EMAIL_DRIVER} · every transactional message is persisted before delivery.`}
      />
      {env.EMAIL_DRIVER === 'outbox' ? (
        <Callout tone="info">
          No email provider is configured, so messages are stored here instead of being sent. The whole system stays
          testable — set <code>EMAIL_DRIVER=smtp</code> with SMTP credentials to deliver for real.
        </Callout>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          {messages.length === 0 ? (
            <EmptyState title="No messages yet" description="Activation, task, approval and policy emails will appear here." />
          ) : (
            <Table>
              <THead><TH>To</TH><TH>Subject</TH><TH>Template</TH><TH>Created</TH><TH>Status</TH></THead>
              <tbody>
                {messages.map((m) => (
                  <TRow key={m.id}>
                    <TD>{m.toEmail}</TD>
                    <TD>
                      <a href={`/admin/email-outbox?message=${m.id}`} className="font-medium text-ink-900 hover:text-brand-600">
                        {m.subject}
                      </a>
                    </TD>
                    <TD className="text-[12px] text-ink-400">{m.templateKey ?? '—'}</TD>
                    <TD className="whitespace-nowrap">{fmtDateTime(m.createdAt)}</TD>
                    <TD><StatusBadge status={m.status} /></TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card className="h-fit">
          <CardBody>
            {selected ? (
              <>
                <div className="mb-3 border-b border-ink-100 pb-3 text-[13px]">
                  <div className="font-medium text-ink-900">{selected.subject}</div>
                  <div className="text-ink-400">To: {selected.toEmail}</div>
                  {selected.error ? <div className="mt-1 text-danger-500">{selected.error}</div> : null}
                </div>
                <div className="fsw-scroll max-h-[60vh] overflow-auto text-[13px] whitespace-pre-wrap text-ink-700">
                  {selected.text}
                </div>
              </>
            ) : (
              <p className="text-[13px] text-ink-500">Select a message to preview its contents.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
