import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { fmtDate, humanize } from '@/lib/format';
import { Card, EmptyState, PageHeader, StatusBadge, Table, THead, TH, TRow, TD } from '@/components/ui';
import { SearchBox } from '@/components/ui/client';

export const metadata: Metadata = { title: 'Candidates' };

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'recruiting.read');
  const { q } = await searchParams;

  const candidates = await db.candidate.findMany({
    where: q
      ? {
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        }
      : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { applications: { include: { requisition: true, stage: true } } },
  });

  return (
    <div>
      <PageHeader
        title="Candidates"
        description="Add candidates from a specific job's pipeline page."
      />
      <Card>
        <div className="border-b border-ink-100 px-4 py-3">
          <SearchBox placeholder="Search candidates…" />
        </div>
        {candidates.length === 0 ? (
          <EmptyState title="No candidates" description="Open a job and use Add candidate." />
        ) : (
          <Table>
            <THead><TH>Candidate</TH><TH>Job</TH><TH>Stage</TH><TH>Source</TH><TH>Added</TH><TH>Status</TH></THead>
            <tbody>
              {candidates.map((c) =>
                (c.applications.length ? c.applications : [null]).map((app) => (
                  <TRow key={`${c.id}-${app?.id ?? 'none'}`}>
                    <TD>
                      <Link href={`/recruiting/candidates/${c.id}`} className="font-medium text-ink-900 hover:text-brand-600">
                        {c.firstName} {c.lastName}
                      </Link>
                      <span className="block text-[12px] text-ink-400">{c.email ?? '—'}</span>
                    </TD>
                    <TD>
                      {app ? (
                        <Link href={`/recruiting/jobs/${app.requisitionId}`} className="text-ink-700 hover:text-brand-600">
                          {app.requisition.title}
                        </Link>
                      ) : ('—')}
                    </TD>
                    <TD>{app?.stage.name ?? '—'}</TD>
                    <TD>{humanize(c.source)}</TD>
                    <TD>{fmtDate(c.createdAt)}</TD>
                    <TD>{app ? <StatusBadge status={app.status} /> : '—'}</TD>
                  </TRow>
                )),
              )}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
