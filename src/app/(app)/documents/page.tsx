import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, can } from '@/lib/authz';
import { fmtDate, fullName, humanize, addDays, startOfUTCDay } from '@/lib/format';
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Table, THead, TH, TRow, TD } from '@/components/ui';
import { SearchBox, FilterSelect } from '@/components/ui/client';
import type { Prisma } from '@/generated/prisma/client';

export const metadata: Metadata = { title: 'Documents' };

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireCtx();
  const params = await searchParams;
  const isHr = can(ctx, 'docs.read_all');
  const today = startOfUTCDay();

  // Non-HR users see their own documents plus company-wide internal docs.
  const scope: Prisma.DocumentWhereInput = isHr
    ? {}
    : {
        OR: [
          ...(ctx.workerId ? [{ workerId: ctx.workerId }] : []),
          { workerId: null, classification: { in: ['PUBLIC_INTERNAL', 'INTERNAL'] } },
        ],
      };

  const documents = await db.document.findMany({
    where: {
      deletedAt: null,
      ...scope,
      ...(params.q ? { title: { contains: params.q, mode: 'insensitive' } } : {}),
      ...(params.category ? { category: params.category as never } : {}),
      ...(params.expiring ? { expiresAt: { gte: today, lte: addDays(today, 60) } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
      versions: { orderBy: { version: 'desc' }, take: 1, include: { signatures: { take: 1 } } },
    },
  });

  return (
    <div>
      <PageHeader
        title="Documents"
        description="The HR document vault. Downloads use short-lived signed links; every access is audited."
        actions={can(ctx, 'docs.write') ? <ButtonLink href="/documents/new">Upload document</ButtonLink> : undefined}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-4 py-3">
          <SearchBox placeholder="Search documents…" />
          <FilterSelect
            param="category"
            allLabel="All categories"
            ariaLabel="Filter by category"
            options={['OFFER', 'EMPLOYMENT_AGREEMENT', 'CONTRACTOR_AGREEMENT', 'TAX_FORM', 'I9', 'HANDBOOK', 'POLICY', 'REVIEW', 'DISCIPLINARY', 'CERTIFICATION', 'TRAINING', 'COMPENSATION', 'BENEFITS', 'ID_DOCUMENT', 'OTHER'].map((c) => ({ value: c, label: humanize(c) }))}
          />
          <FilterSelect param="expiring" allLabel="Any expiry" ariaLabel="Expiring filter" options={[{ value: '1', label: 'Expiring in 60 days' }]} />
        </div>
        {documents.length === 0 ? (
          <EmptyState title="No documents" description={isHr ? 'Upload agreements, forms and records to the vault.' : 'Documents shared with you will appear here.'} />
        ) : (
          <Table>
            <THead><TH>Title</TH><TH>Category</TH><TH>Worker</TH><TH>Classification</TH><TH>Signature</TH><TH>Expires</TH></THead>
            <tbody>
              {documents.map((doc) => {
                const v = doc.versions[0];
                return (
                  <TRow key={doc.id}>
                    <TD>
                      <Link href={`/documents/${doc.id}`} className="font-medium text-ink-900 hover:text-brand-600">
                        {doc.title}
                      </Link>
                      <span className="block text-[12px] text-ink-400">v{v?.version ?? 1} · {fmtDate(doc.createdAt)}</span>
                    </TD>
                    <TD>{humanize(doc.category)}</TD>
                    <TD>
                      {doc.worker ? (
                        <Link href={`/people/${doc.worker.id}?tab=documents`} className="text-ink-700 hover:text-brand-600">
                          {fullName(doc.worker)}
                        </Link>
                      ) : (<span className="text-ink-400">Company-wide</span>)}
                    </TD>
                    <TD><Badge tone={doc.classification === 'HIGHLY_RESTRICTED' ? 'red' : doc.classification === 'CONFIDENTIAL' ? 'amber' : 'gray'}>{humanize(doc.classification).toLowerCase()}</Badge></TD>
                    <TD>
                      {v?.signatures.length ? (
                        <Badge tone="green">Signed</Badge>
                      ) : doc.requiresSignature ? (
                        <Badge tone="amber">Needed</Badge>
                      ) : ('—')}
                    </TD>
                    <TD>
                      {doc.expiresAt ? (
                        <span className="flex items-center gap-1.5">
                          {fmtDate(doc.expiresAt)}
                          {doc.expiresAt <= addDays(today, 30) ? <Badge tone="red">soon</Badge> : null}
                        </span>
                      ) : ('—')}
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
