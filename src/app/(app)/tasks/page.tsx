import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, can, allReportIds } from '@/lib/authz';
import { fmtDate, fmtDateTime, fullName, humanize, startOfUTCDay } from '@/lib/format';
import {
  Badge, Card, EmptyState, PageHeader, StatusBadge, Table, THead, TH, TRow, TD, cx,
} from '@/components/ui';
import { FilterSelect } from '@/components/ui/client';
import { TaskDetailDrawer, NewTaskButton } from './task-ui';
import type { Prisma } from '@/generated/prisma/client';

export const metadata: Metadata = { title: 'Tasks' };

const VIEWS = [
  { key: 'mine', label: 'My tasks' },
  { key: 'team', label: 'Team' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
];

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireCtx();
  const params = await searchParams;
  const isAdmin = can(ctx, 'onboarding.admin');
  const view = params.view ?? 'mine';
  const today = startOfUTCDay();

  const mineFilter: Prisma.TaskWhereInput = {
    OR: [{ ownerUserId: ctx.userId }, ...(ctx.roleKeys.length ? [{ ownerRoleKey: { in: ctx.roleKeys } }] : [])],
  };

  let where: Prisma.TaskWhereInput;
  switch (view) {
    case 'team': {
      const reportIds = ctx.workerId ? await allReportIds(ctx.workerId) : [];
      const reportUsers = await db.worker.findMany({
        where: { id: { in: reportIds }, userId: { not: null } },
        select: { userId: true },
      });
      where = {
        status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] },
        OR: [
          { workerId: { in: reportIds } },
          { ownerUserId: { in: reportUsers.map((r) => r.userId!) } },
        ],
      };
      break;
    }
    case 'overdue':
      where = {
        status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] },
        dueDate: { lt: today },
        ...(isAdmin ? {} : mineFilter),
      };
      break;
    case 'completed':
      where = { status: 'COMPLETED', ...(isAdmin ? {} : mineFilter) };
      break;
    case 'all':
      where = isAdmin ? {} : { ...mineFilter };
      break;
    default:
      where = { status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] }, ...mineFilter };
  }
  if (params.category) where = { AND: [where, { category: params.category as never }] };

  const tasks = await db.task.findMany({
    where,
    orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: 100,
    include: {
      worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
      dependsOn: { select: { title: true, status: true } },
    },
  });

  // Detail drawer data
  const openTaskId = params.task;
  const openTask = openTaskId
    ? await db.task.findUnique({
        where: { id: openTaskId },
        include: {
          worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
          dependsOn: { select: { id: true, title: true, status: true } },
          comments: { orderBy: { createdAt: 'asc' } },
        },
      })
    : null;
  const commentAuthors = openTask
    ? await db.user.findMany({
        where: { id: { in: [...new Set(openTask.comments.map((c) => c.authorUserId))] } },
        select: { id: true, email: true, worker: { select: { legalFirstName: true, preferredName: true, lastName: true } } },
      })
    : [];

  const hrefFor = (v: string) => {
    const sp = new URLSearchParams();
    sp.set('view', v);
    if (params.category) sp.set('category', params.category);
    return `/tasks?${sp.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Every HR process — onboarding, offboarding, compliance, IT — feeds this one queue."
        actions={<NewTaskButton isAdmin={isAdmin} />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav aria-label="Task views" className="flex rounded-md border border-ink-200 bg-white p-0.5">
          {VIEWS.filter((v) => v.key !== 'team' || ctx.workerId).map((v) => (
            <Link
              key={v.key}
              href={hrefFor(v.key)}
              aria-current={view === v.key ? 'page' : undefined}
              className={cx(
                'rounded px-3 py-1.5 text-[13px] font-medium',
                view === v.key ? 'bg-ink-900 text-white' : 'text-ink-500 hover:text-ink-900',
              )}
            >
              {v.label}
            </Link>
          ))}
        </nav>
        <FilterSelect
          param="category"
          allLabel="All categories"
          ariaLabel="Filter by category"
          options={['ONBOARDING', 'OFFBOARDING', 'COMPLIANCE', 'IT_ACCESS', 'EQUIPMENT', 'TRAINING', 'DOCUMENT', 'RECRUITING', 'HR', 'GENERAL'].map((c) => ({ value: c, label: humanize(c) }))}
        />
      </div>

      <Card>
        {tasks.length === 0 ? (
          <EmptyState title="No tasks here" description="Nice — nothing outstanding in this view." />
        ) : (
          <Table>
            <THead>
              <TH>Task</TH><TH>About</TH><TH>Category</TH><TH>Due</TH><TH>Priority</TH><TH>Status</TH>
            </THead>
            <tbody>
              {tasks.map((t) => (
                <TRow key={t.id} className={t.dueDate && t.dueDate < today && t.status !== 'COMPLETED' ? 'bg-danger-100/30' : ''}>
                  <TD>
                    <Link href={`/tasks?view=${view}&task=${t.id}`} className="font-medium text-ink-900 hover:text-brand-600">
                      {t.title}
                    </Link>
                    {t.dependsOn && t.dependsOn.status !== 'COMPLETED' ? (
                      <span className="block text-[12px] text-warn-500">waiting on: {t.dependsOn.title}</span>
                    ) : null}
                  </TD>
                  <TD>
                    {t.worker ? (
                      <Link href={`/people/${t.worker.id}`} className="text-ink-600 hover:text-brand-600">
                        {fullName(t.worker)}
                      </Link>
                    ) : ('—')}
                  </TD>
                  <TD>{humanize(t.category)}</TD>
                  <TD>
                    {t.dueDate ? (
                      <span className="flex items-center gap-1.5">
                        {fmtDate(t.dueDate)}
                        {t.dueDate < today && t.status !== 'COMPLETED' ? <Badge tone="red">overdue</Badge> : null}
                      </span>
                    ) : ('—')}
                  </TD>
                  <TD><StatusBadge status={t.priority} /></TD>
                  <TD><StatusBadge status={t.status} /></TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {openTask ? (
        <TaskDetailDrawer
          task={{
            id: openTask.id,
            title: openTask.title,
            description: openTask.description,
            category: openTask.category,
            status: openTask.status,
            priority: openTask.priority,
            dueDate: openTask.dueDate ? fmtDate(openTask.dueDate) : null,
            workerName: openTask.worker ? fullName(openTask.worker) : null,
            workerId: openTask.worker?.id ?? null,
            dependsOn: openTask.dependsOn ? { title: openTask.dependsOn.title, status: openTask.dependsOn.status } : null,
            comments: openTask.comments.map((c) => {
              const author = commentAuthors.find((a) => a.id === c.authorUserId);
              return {
                id: c.id,
                body: c.body,
                author: author?.worker ? fullName(author.worker) : (author?.email ?? 'Unknown'),
                at: fmtDateTime(c.createdAt),
              };
            }),
          }}
          backHref={hrefFor(view)}
        />
      ) : null}
    </div>
  );
}
