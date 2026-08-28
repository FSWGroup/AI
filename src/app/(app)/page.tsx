import Link from 'next/link';
import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, can, directReportIds } from '@/lib/authz';
import { addDays, fmtDate, fullName, startOfUTCDay } from '@/lib/format';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  StatCard,
  StatusBadge,
  Avatar,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Home' };

export default async function HomePage() {
  const ctx = await requireCtx();
  const today = startOfUTCDay();
  const isHr = can(ctx, 'people.read_all') && can(ctx, 'onboarding.admin');

  const worker = ctx.workerId
    ? await db.worker.findUnique({
        where: { id: ctx.workerId },
        select: { preferredName: true, legalFirstName: true, lastName: true },
      })
    : null;

  const firstName = worker ? worker.preferredName || worker.legalFirstName : ctx.email.split('@')[0];

  // --- Everyone: my open tasks -------------------------------------------
  const myTasks = await db.task.findMany({
    where: {
      status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] },
      OR: [{ ownerUserId: ctx.userId }, ...(ctx.roleKeys.length ? [{ ownerRoleKey: { in: ctx.roleKeys } }] : [])],
    },
    orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    take: 6,
    include: { worker: { select: { legalFirstName: true, preferredName: true, lastName: true } } },
  });

  // --- Everyone: who's out today, announcements, upcoming holidays -------
  const [outToday, announcements, nextHolidays] = await Promise.all([
    db.ptoRequest.findMany({
      where: { status: 'APPROVED', startDate: { lte: today }, endDate: { gte: today } },
      include: { worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true, photoUrl: true } } },
      take: 8,
    }),
    db.announcement.findMany({
      where: { publishAt: { lte: new Date() }, OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] },
      orderBy: [{ pinned: 'desc' }, { publishAt: 'desc' }],
      take: 3,
    }),
    db.holiday.findMany({
      where: { date: { gte: today, lte: addDays(today, 45) } },
      orderBy: { date: 'asc' },
      include: { calendar: { select: { name: true, country: true } } },
      take: 4,
    }),
  ]);

  // --- Manager block ------------------------------------------------------
  const reportIds = ctx.workerId ? await directReportIds(ctx.workerId) : [];
  const isManager = reportIds.length > 0;
  const [pendingPto, reviewsDue] = isManager
    ? await Promise.all([
        db.ptoRequest.count({ where: { status: 'PENDING', workerId: { in: reportIds } } }),
        db.performanceReview.count({
          where: { authorId: ctx.workerId!, status: { in: ['NOT_STARTED', 'IN_PROGRESS'] } },
        }),
      ])
    : [0, 0];

  // --- HR block -----------------------------------------------------------
  let hrStats: { label: string; value: number; href: string; tone?: 'warn' | 'danger' }[] = [];
  if (isHr) {
    const activeWhere = { status: { in: ['ACTIVE', 'ONBOARDING', 'ON_LEAVE'] as never[] }, deletedAt: null };
    const [headcount, usCount, phCount, contractors, onboarding, offboarding, ptoPending, docsExpiring, trainingOverdue, openReqs, complianceOpen, upcomingHires] =
      await Promise.all([
        db.worker.count({ where: activeWhere }),
        db.worker.count({ where: { ...activeWhere, country: 'US' } }),
        db.worker.count({ where: { ...activeWhere, country: 'PH' } }),
        db.worker.count({ where: { ...activeWhere, workerType: { in: ['CONTRACTOR', 'AGENCY', 'EOR'] } } }),
        db.lifecycleInstance.count({ where: { kind: 'ONBOARDING', status: 'IN_PROGRESS' } }),
        db.lifecycleInstance.count({ where: { kind: 'OFFBOARDING', status: 'IN_PROGRESS' } }),
        db.ptoRequest.count({ where: { status: 'PENDING' } }),
        db.document.count({ where: { expiresAt: { gte: today, lte: addDays(today, 30) }, deletedAt: null } }),
        db.trainingAssignment.count({ where: { status: 'OVERDUE' } }),
        db.jobRequisition.count({ where: { status: 'OPEN' } }),
        db.complianceItem.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS', 'OVERDUE'] } } }),
        db.worker.count({ where: { status: 'PRE_START', hireDate: { gte: today }, deletedAt: null } }),
      ]);
    hrStats = [
      { label: 'Active headcount', value: headcount, href: '/reports/headcount' },
      { label: 'U.S. workforce', value: usCount, href: '/people?country=US' },
      { label: 'Philippines', value: phCount, href: '/people?country=PH' },
      { label: 'Contractors', value: contractors, href: '/people/contractors' },
      { label: 'Upcoming hires', value: upcomingHires, href: '/people?status=PRE_START' },
      { label: 'Onboarding', value: onboarding, href: '/ops/onboarding' },
      { label: 'Offboarding', value: offboarding, href: '/ops/offboarding' },
      { label: 'PTO requests', value: ptoPending, href: '/time/pto', tone: ptoPending > 0 ? 'warn' : undefined },
      { label: 'Docs expiring 30d', value: docsExpiring, href: '/documents?expiring=1', tone: docsExpiring > 0 ? 'warn' : undefined },
      { label: 'Training overdue', value: trainingOverdue, href: '/training', tone: trainingOverdue > 0 ? 'danger' : undefined },
      { label: 'Open positions', value: openReqs, href: '/recruiting/jobs' },
      { label: 'Compliance open', value: complianceOpen, href: '/admin/compliance', tone: complianceOpen > 0 ? 'warn' : undefined },
    ];
  }

  // Birthdays & anniversaries this week (visible to all)
  const soonWorkers = await db.worker.findMany({
    where: { status: { in: ['ACTIVE', 'ONBOARDING', 'ON_LEAVE'] }, deletedAt: null, showBirthday: true },
    select: { id: true, legalFirstName: true, preferredName: true, lastName: true, dateOfBirth: true, hireDate: true },
  });
  const inNext7 = (d: Date | null) => {
    if (!d) return false;
    for (let i = 0; i < 7; i++) {
      const t = addDays(today, i);
      if (d.getUTCMonth() === t.getUTCMonth() && d.getUTCDate() === t.getUTCDate()) return true;
    }
    return false;
  };
  const birthdays = soonWorkers.filter((w) => inNext7(w.dateOfBirth)).slice(0, 5);
  const anniversaries = soonWorkers
    .filter((w) => w.hireDate && inNext7(w.hireDate) && w.hireDate < today)
    .slice(0, 5);

  return (
    <div>
      <PageHeader
        title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${firstName}`}
        description={isHr ? 'Here is what needs attention across FSW Group today.' : 'Here is what needs your attention today.'}
      />

      {isHr && hrStats.length > 0 ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {hrStats.map((s) => (
            <StatCard key={s.label} label={s.label} value={s.value} href={s.href} tone={s.tone} />
          ))}
        </div>
      ) : null}

      {isManager ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="My team" value={reportIds.length} href="/people?team=mine" />
          <StatCard label="PTO to approve" value={pendingPto} href="/time/pto?tab=approvals" tone={pendingPto > 0 ? 'warn' : undefined} />
          <StatCard label="Reviews to write" value={reviewsDue} href="/talent/reviews" tone={reviewsDue > 0 ? 'warn' : undefined} />
          <StatCard label="Team calendar" value="View" href="/time/calendar" />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="My tasks"
              actions={
                <ButtonLink variant="secondary" size="sm" href="/tasks">
                  All tasks
                </ButtonLink>
              }
            />
            {myTasks.length === 0 ? (
              <EmptyState title="You're all caught up" description="Tasks assigned to you will appear here." />
            ) : (
              <ul className="divide-y divide-ink-100">
                {myTasks.map((t) => (
                  <li key={t.id}>
                    <Link href={`/tasks?task=${t.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-brand-50/40">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-ink-900">{t.title}</div>
                        <div className="mt-0.5 text-[12px] text-ink-500">
                          {t.worker ? `${fullName(t.worker)} · ` : ''}
                          {t.dueDate ? `Due ${fmtDate(t.dueDate)}` : 'No due date'}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {t.dueDate && t.dueDate < today ? <Badge tone="red">Overdue</Badge> : null}
                        <StatusBadge status={t.status} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {announcements.length > 0 ? (
            <Card>
              <CardHeader
                title="Announcements"
                actions={
                  <ButtonLink variant="secondary" size="sm" href="/announcements">
                    View all
                  </ButtonLink>
                }
              />
              <ul className="divide-y divide-ink-100">
                {announcements.map((a) => (
                  <li key={a.id} className="px-5 py-3">
                    <Link href={`/announcements`} className="flex items-center gap-2 text-sm font-medium text-ink-900 hover:text-brand-600">
                      {a.pinned ? <Badge tone="navy">Pinned</Badge> : null}
                      {a.title}
                    </Link>
                    <div className="mt-0.5 text-[12px] text-ink-400">{fmtDate(a.publishAt)}</div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Who's out today" />
            {outToday.length === 0 ? (
              <CardBody>
                <p className="text-[13px] text-ink-500">Everyone is in today.</p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-ink-100">
                {outToday.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-5 py-2.5">
                    <Avatar name={fullName(r.worker)} photoUrl={r.worker.photoUrl} size={28} />
                    <div className="min-w-0">
                      <div className="truncate text-sm text-ink-800">{fullName(r.worker)}</div>
                      <div className="text-[12px] text-ink-400">Back {fmtDate(addDays(r.endDate, 1))}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Company holidays" />
            {nextHolidays.length === 0 ? (
              <CardBody>
                <p className="text-[13px] text-ink-500">No holidays in the next 45 days.</p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-ink-100">
                {nextHolidays.map((h) => (
                  <li key={h.id} className="flex items-center justify-between px-5 py-2.5">
                    <div>
                      <div className="text-sm text-ink-800">{h.name}</div>
                      <div className="text-[12px] text-ink-400">{h.calendar.name}</div>
                    </div>
                    <span className="text-[13px] font-medium text-ink-600">{fmtDate(h.observedDate ?? h.date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {(birthdays.length > 0 || anniversaries.length > 0) && (
            <Card>
              <CardHeader title="Celebrations this week" />
              <ul className="divide-y divide-ink-100">
                {birthdays.map((w) => (
                  <li key={`b-${w.id}`} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <Link href={`/people/${w.id}`} className="text-ink-800 hover:text-brand-600">
                      {fullName(w)}
                    </Link>
                    <Badge tone="blue">Birthday</Badge>
                  </li>
                ))}
                {anniversaries.map((w) => (
                  <li key={`a-${w.id}`} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <Link href={`/people/${w.id}`} className="text-ink-800 hover:text-brand-600">
                      {fullName(w)}
                    </Link>
                    <Badge tone="green">
                      {w.hireDate ? `${today.getUTCFullYear() - w.hireDate.getUTCFullYear()} yr` : ''} anniversary
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
