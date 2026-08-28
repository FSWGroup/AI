import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission, can } from '@/lib/authz';
import { fmtDate, fmtMoney, fullName, humanize } from '@/lib/format';
import { Card, EmptyState, PageHeader, StatusBadge, Table, THead, TH, TRow, TD } from '@/components/ui';
import { FilterSelect, SearchBox } from '@/components/ui/client';
import { NewJobButton } from './job-forms';

export const metadata: Metadata = { title: 'Jobs' };

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'recruiting.read');
  const params = await searchParams;

  const jobs = await db.jobRequisition.findMany({
    where: {
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.q ? { title: { contains: params.q, mode: 'insensitive' } } : {}),
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: {
      _count: { select: { applications: { where: { status: 'ACTIVE' } } } },
    },
  });

  const [departments, entities, managers] = can(ctx, 'recruiting.write')
    ? await Promise.all([
        db.department.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
        db.legalEntity.findMany({ where: { active: true } }),
        db.worker.findMany({
          where: { status: 'ACTIVE', deletedAt: null },
          select: { id: true, legalFirstName: true, preferredName: true, lastName: true },
          orderBy: { lastName: 'asc' },
        }),
      ])
    : [[], [], []];

  const deptNames = new Map((await db.department.findMany()).map((d) => [d.id, d.name]));

  return (
    <div>
      <PageHeader
        title="Jobs"
        description={`${jobs.filter((j) => j.status === 'OPEN').length} open positions`}
        actions={
          can(ctx, 'recruiting.write') ? (
            <NewJobButton
              departments={departments.map((d) => ({ value: d.id, label: d.name }))}
              entities={entities.map((e) => ({ value: e.id, label: e.name }))}
              managers={managers.map((m) => ({ value: m.id, label: fullName(m) }))}
            />
          ) : undefined
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-4 py-3">
          <SearchBox placeholder="Search jobs…" />
          <FilterSelect param="status" allLabel="All statuses" ariaLabel="Filter by status"
            options={['DRAFT', 'PENDING_APPROVAL', 'OPEN', 'ON_HOLD', 'FILLED', 'CLOSED'].map((s) => ({ value: s, label: humanize(s) }))} />
        </div>
        {jobs.length === 0 ? (
          <EmptyState title="No jobs yet" description="Create a requisition to start recruiting." />
        ) : (
          <Table>
            <THead>
              <TH>Job</TH><TH>Department</TH><TH>Location</TH><TH>Range</TH><TH>Candidates</TH><TH>Target</TH><TH>Status</TH>
            </THead>
            <tbody>
              {jobs.map((j) => (
                <TRow key={j.id}>
                  <TD>
                    <Link href={`/recruiting/jobs/${j.id}`} className="font-medium text-ink-900 hover:text-brand-600">
                      {j.title}
                    </Link>
                    <span className="block text-[12px] text-ink-400">
                      {humanize(j.workerType)} · {j.headcount} opening{j.headcount > 1 ? 's' : ''}
                      {j.isReplacement ? ' · replacement' : ' · new headcount'}
                    </span>
                  </TD>
                  <TD>{j.departmentId ? (deptNames.get(j.departmentId) ?? '—') : '—'}</TD>
                  <TD>{j.locationText ?? '—'}</TD>
                  <TD className="tabular-nums">
                    {j.salaryMin || j.salaryMax
                      ? `${j.salaryMin ? fmtMoney(Number(j.salaryMin)) : '—'} – ${j.salaryMax ? fmtMoney(Number(j.salaryMax)) : '—'}`
                      : '—'}
                  </TD>
                  <TD>{j._count.applications}</TD>
                  <TD>{fmtDate(j.targetDate)}</TD>
                  <TD><StatusBadge status={j.status} /></TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
