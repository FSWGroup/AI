import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission, can } from '@/lib/authz';
import { fmtDate, fmtDateTime, fullName, humanize } from '@/lib/format';
import { Callout, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge } from '@/components/ui';
import { NewCaseForm, CaseUpdateForm, CaseNoteForm } from './case-forms';

export const metadata: Metadata = { title: 'HR cases' };

export default async function HrCasesPage({
  searchParams,
}: {
  searchParams: Promise<{ case?: string }>;
}) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'cases.read');
  const params = await searchParams;

  const cases = await db.hrCase.findMany({
    orderBy: [{ status: 'asc' }, { openedAt: 'desc' }],
    include: { worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } } },
    take: 100,
  });

  const openCase = params.case
    ? await db.hrCase.findUnique({
        where: { id: params.case },
        include: {
          worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
          notes: { orderBy: { createdAt: 'asc' } },
        },
      })
    : null;
  const noteAuthors = openCase
    ? await db.user.findMany({
        where: { id: { in: [...new Set(openCase.notes.map((n) => n.authorUserId))] } },
        select: { id: true, email: true, worker: { select: { legalFirstName: true, preferredName: true, lastName: true } } },
      })
    : [];

  const workers = can(ctx, 'cases.write')
    ? await db.worker.findMany({
        where: { deletedAt: null },
        select: { id: true, legalFirstName: true, preferredName: true, lastName: true },
        orderBy: { lastName: 'asc' },
      })
    : [];

  return (
    <div>
      <PageHeader title="HR cases" description="Confidential employee-relations case management." />
      <Callout tone="warn">
        This area is restricted to authorized HR users. Case records never appear on ordinary worker profiles, and
        every action here is audited.
      </Callout>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title={`Cases (${cases.length})`} />
            {cases.length === 0 ? (
              <EmptyState title="No cases" description="Coaching notes, warnings, PIPs, investigations and complaints are managed here." />
            ) : (
              <ul className="divide-y divide-ink-100">
                {cases.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/people/cases?case=${c.id}`}
                      className={`flex items-center justify-between gap-3 px-5 py-3 hover:bg-brand-50/40 ${openCase?.id === c.id ? 'bg-brand-50/60' : ''}`}
                    >
                      <div>
                        <div className="text-sm font-medium text-ink-900">{c.title}</div>
                        <div className="text-[12px] text-ink-400">
                          {fullName(c.worker)} · {humanize(c.caseType)} · opened {fmtDate(c.openedAt)}
                          {c.followUpDate ? ` · follow-up ${fmtDate(c.followUpDate)}` : ''}
                        </div>
                      </div>
                      <StatusBadge status={c.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {openCase ? (
            <Card>
              <CardHeader
                title={openCase.title}
                description={`${fullName(openCase.worker)} · ${humanize(openCase.caseType)}`}
                actions={<StatusBadge status={openCase.status} />}
              />
              <CardBody className="space-y-4">
                {openCase.description ? (
                  <p className="text-sm whitespace-pre-wrap text-ink-700">{openCase.description}</p>
                ) : null}
                <div>
                  <h3 className="mb-2 text-[13px] font-semibold text-ink-700">Case notes</h3>
                  <ul className="space-y-2">
                    {openCase.notes.map((n) => {
                      const author = noteAuthors.find((a) => a.id === n.authorUserId);
                      return (
                        <li key={n.id} className="rounded-md bg-ink-50 px-3 py-2">
                          <div className="text-[12px] font-medium text-ink-500">
                            {author?.worker ? fullName(author.worker) : (author?.email ?? 'HR')} · {fmtDateTime(n.createdAt)}
                          </div>
                          <p className="mt-0.5 text-sm whitespace-pre-wrap text-ink-800">{n.body}</p>
                        </li>
                      );
                    })}
                    {openCase.notes.length === 0 ? <li className="text-[13px] text-ink-400">No notes yet.</li> : null}
                  </ul>
                  {can(ctx, 'cases.write') ? <CaseNoteForm caseId={openCase.id} /> : null}
                </div>
                {can(ctx, 'cases.write') ? (
                  <div className="border-t border-ink-100 pt-4">
                    <h3 className="mb-2 text-[13px] font-semibold text-ink-700">Update case</h3>
                    <CaseUpdateForm
                      caseId={openCase.id}
                      status={openCase.status}
                      resolution={openCase.resolution}
                      followUpDate={openCase.followUpDate ? openCase.followUpDate.toISOString().slice(0, 10) : ''}
                    />
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
        </div>

        {can(ctx, 'cases.write') ? (
          <Card className="h-fit">
            <CardHeader title="Open a case" />
            <CardBody>
              <NewCaseForm workers={workers.map((w) => ({ value: w.id, label: fullName(w) }))} />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
