import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { fmtDateTime, addDays, startOfUTCDay } from '@/lib/format';
import {
  Badge, Callout, Card, EmptyState, PageHeader, Pagination, Table, THead, TH, TRow, TD,
} from '@/components/ui';
import { SearchBox, FilterSelect } from '@/components/ui/client';
import type { Prisma } from '@/generated/prisma/client';

export const metadata: Metadata = { title: 'Audit log' };

const HIGH_RISK = ['pii.reveal', 'export.run', 'document.downloaded', 'compensation.change', 'worker.terminated', 'retention.destruction_approved', 'auth.login_failed'];

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'audit.read');
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const pageSize = 50;

  const where: Prisma.AuditEventWhereInput = {
    ...(params.q
      ? {
          OR: [
            { action: { contains: params.q, mode: 'insensitive' } },
            { actorEmail: { contains: params.q, mode: 'insensitive' } },
            { targetId: { contains: params.q } },
          ],
        }
      : {}),
    ...(params.category === 'high-risk' ? { action: { in: HIGH_RISK } } : {}),
    ...(params.days ? { createdAt: { gte: addDays(startOfUTCDay(), -Number(params.days)) } } : {}),
  };

  const [total, events] = await Promise.all([
    db.auditEvent.count({ where }),
    db.auditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const hrefFor = (p: number) => {
    const sp = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    sp.set('page', String(p));
    return `/admin/audit?${sp.toString()}`;
  };

  return (
    <div>
      <PageHeader title="Audit log" description={`${total} recorded events`} />
      <Callout tone="info">
        Audit events are append-only — a database trigger rejects any UPDATE or DELETE, so this history cannot be
        quietly rewritten, even by a database administrator using the application&apos;s credentials.
      </Callout>
      <Card className="mt-4">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-4 py-3">
          <SearchBox placeholder="Search action, actor, target…" />
          <FilterSelect param="category" allLabel="All events" ariaLabel="Filter by category"
            options={[{ value: 'high-risk', label: 'High-risk only' }]} />
          <FilterSelect param="days" allLabel="All time" ariaLabel="Filter by period"
            options={[{ value: '1', label: 'Last 24 hours' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }]} />
        </div>
        {events.length === 0 ? (
          <EmptyState title="No matching events" />
        ) : (
          <Table>
            <THead><TH>When</TH><TH>Actor</TH><TH>Action</TH><TH>Target</TH><TH>Detail</TH><TH>IP</TH></THead>
            <tbody>
              {events.map((e) => (
                <TRow key={e.id}>
                  <TD className="whitespace-nowrap">{fmtDateTime(e.createdAt)}</TD>
                  <TD>{e.actorEmail ?? <span className="text-ink-400">system / anonymous</span>}</TD>
                  <TD>
                    <span className="flex items-center gap-1.5">
                      <code className="text-[12.5px]">{e.action}</code>
                      {HIGH_RISK.includes(e.action) ? <Badge tone="red">high risk</Badge> : null}
                    </span>
                  </TD>
                  <TD className="text-[12.5px] text-ink-500">
                    {e.targetType ? `${e.targetType}` : '—'}
                    {e.targetId ? <span className="block text-[11px] text-ink-300">{e.targetId}</span> : null}
                  </TD>
                  <TD className="max-w-sm truncate text-[12px] text-ink-500">
                    {e.metadata ? JSON.stringify(e.metadata) : e.after ? JSON.stringify(e.after) : '—'}
                  </TD>
                  <TD className="text-[12px] text-ink-400">{e.ip ?? '—'}</TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageCount={Math.max(1, Math.ceil(total / pageSize))} hrefFor={hrefFor} />
      </Card>
    </div>
  );
}
