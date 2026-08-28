import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, can, assertPermission, scopedWorkerFilter, directReportIds } from '@/lib/authz';
import { directoryQuery } from '@/lib/people';
import { fullName, humanize } from '@/lib/format';
import {
  Avatar, ButtonLink, Card, EmptyState, PageHeader, Pagination, StatusBadge, Table, THead, TH, TRow, TD,
} from '@/components/ui';
import { SearchBox, FilterSelect } from '@/components/ui/client';
import type { Prisma } from '@/generated/prisma/client';

export const metadata: Metadata = { title: 'Directory' };

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'people.read');
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const isHr = can(ctx, 'people.read_all');

  let extraWhere: Prisma.WorkerWhereInput | undefined = scopedWorkerFilter(ctx, 'people.read') as Prisma.WorkerWhereInput;
  if (params.team === 'mine' && ctx.workerId) {
    const ids = await directReportIds(ctx.workerId);
    extraWhere = { ...extraWhere, id: { in: ids } };
  }

  const [{ workers, total, pageCount }, departments, entities] = await Promise.all([
    directoryQuery({
      q: params.q,
      country: params.country,
      workerType: params.type,
      status: isHr ? params.status : undefined,
      departmentId: params.dept,
      legalEntityId: params.entity,
      includeTerminated: isHr && params.status === 'TERMINATED',
      page,
      extraWhere,
    }),
    db.department.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    db.legalEntity.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
  ]);

  const hrefFor = (p: number) => {
    const sp = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    sp.set('page', String(p));
    return `/people?${sp.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="Directory"
        description={`${total} people across FSW Group`}
        actions={
          <>
            <ButtonLink variant="secondary" href="/people/org-chart">
              Org chart
            </ButtonLink>
            {can(ctx, 'people.write') ? <ButtonLink href="/people/new">Add worker</ButtonLink> : null}
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-4 py-3">
          <SearchBox placeholder="Search name, title, email…" />
          <FilterSelect param="dept" allLabel="All departments" ariaLabel="Filter by department"
            options={departments.map((d) => ({ value: d.id, label: d.name }))} />
          <FilterSelect param="entity" allLabel="All companies" ariaLabel="Filter by company"
            options={entities.map((e) => ({ value: e.id, label: e.name }))} />
          <FilterSelect param="country" allLabel="All countries" ariaLabel="Filter by country"
            options={[{ value: 'US', label: 'United States' }, { value: 'PH', label: 'Philippines' }]} />
          <FilterSelect param="type" allLabel="All worker types" ariaLabel="Filter by worker type"
            options={[
              { value: 'EMPLOYEE', label: 'Employees' },
              { value: 'CONTRACTOR', label: 'Contractors' },
              { value: 'EOR', label: 'EOR' },
              { value: 'AGENCY', label: 'Agency' },
            ]} />
          {isHr ? (
            <FilterSelect param="status" allLabel="Active statuses" ariaLabel="Filter by status"
              options={['PRE_START', 'ONBOARDING', 'ACTIVE', 'ON_LEAVE', 'OFFBOARDING', 'TERMINATED'].map((s) => ({
                value: s, label: humanize(s),
              }))} />
          ) : null}
        </div>

        {workers.length === 0 ? (
          <EmptyState title="No people match" description="Try clearing a filter or changing the search." />
        ) : (
          <Table>
            <THead>
              <TH>Name</TH>
              <TH>Title</TH>
              <TH>Department</TH>
              <TH>Company</TH>
              <TH>Location</TH>
              <TH>Manager</TH>
              {isHr ? <TH>Type</TH> : null}
              {isHr ? <TH>Status</TH> : null}
            </THead>
            <tbody>
              {workers.map((w) => {
                const emp = w.employments[0];
                return (
                  <TRow key={w.id}>
                    <TD>
                      <Link href={`/people/${w.id}`} className="flex items-center gap-3 font-medium text-ink-900 hover:text-brand-600">
                        <Avatar name={fullName(w)} photoUrl={w.photoUrl} size={30} />
                        <span>
                          {fullName(w)}
                          {w.isDemo ? <span className="ml-1.5 align-middle text-[10px] tracking-wide text-ink-300 uppercase">demo</span> : null}
                          <span className="block text-[12px] font-normal text-ink-400">{w.workEmail ?? '—'}</span>
                        </span>
                      </Link>
                    </TD>
                    <TD>{emp?.title ?? '—'}</TD>
                    <TD>{emp?.department?.name ?? '—'}</TD>
                    <TD>{emp?.legalEntity?.name ?? '—'}</TD>
                    <TD>
                      {emp?.location?.name ?? '—'}
                      <span className="block text-[12px] text-ink-400">{w.country === 'PH' ? 'Philippines' : w.country === 'US' ? 'United States' : w.country}</span>
                    </TD>
                    <TD>
                      {emp?.manager ? (
                        <Link href={`/people/${emp.manager.id}`} className="text-ink-600 hover:text-brand-600">
                          {fullName(emp.manager)}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TD>
                    {isHr ? <TD>{humanize(w.workerType)}</TD> : null}
                    {isHr ? <TD><StatusBadge status={w.status} /></TD> : null}
                  </TRow>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageCount={pageCount} hrefFor={hrefFor} />
      </Card>
    </div>
  );
}
