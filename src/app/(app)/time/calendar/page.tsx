import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx } from '@/lib/authz';
import { addDays, fullName, isoDate, startOfUTCDay } from '@/lib/format';
import { Badge, ButtonLink, Card, CardBody, PageHeader, cx } from '@/components/ui';
import { FilterSelect } from '@/components/ui/client';

export const metadata: Metadata = { title: 'Calendar' };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; dept?: string }>;
}) {
  await requireCtx();
  const params = await searchParams;
  const now = new Date();
  const [y, m] = params.month
    ? params.month.split('-').map(Number)
    : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const monthStart = new Date(Date.UTC(y, m - 1, 1));
  const monthEnd = new Date(Date.UTC(y, m, 0));
  const gridStart = addDays(monthStart, -((monthStart.getUTCDay() + 6) % 7));
  const gridEnd = addDays(monthEnd, 6 - ((monthEnd.getUTCDay() + 6) % 7));

  const deptFilter = params.dept
    ? { worker: { employments: { some: { effectiveTo: null, departmentId: params.dept } } } }
    : {};

  const [ptoRequests, holidays, departments, workers] = await Promise.all([
    db.ptoRequest.findMany({
      where: { status: 'APPROVED', startDate: { lte: gridEnd }, endDate: { gte: gridStart }, ...deptFilter },
      include: { worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } }, policy: { select: { leaveType: true } } },
    }),
    db.holiday.findMany({
      where: { date: { gte: gridStart, lte: gridEnd }, calendar: { active: true } },
      include: { calendar: { select: { country: true } } },
    }),
    db.department.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    db.worker.findMany({
      where: { status: { in: ['ACTIVE', 'ONBOARDING'] }, deletedAt: null },
      select: { id: true, legalFirstName: true, preferredName: true, lastName: true, dateOfBirth: true, hireDate: true },
    }),
  ]);

  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);

  const prevMonth = new Date(Date.UTC(y, m - 2, 1));
  const nextMonth = new Date(Date.UTC(y, m, 1));
  const fmtMonthParam = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const today = startOfUTCDay();

  return (
    <div>
      <PageHeader
        title={monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
        description="Approved time off, company holidays, birthdays and start-date anniversaries."
        actions={
          <div className="flex items-center gap-2">
            <FilterSelect param="dept" allLabel="All departments" ariaLabel="Filter by department"
              options={departments.map((d) => ({ value: d.id, label: d.name }))} />
            <ButtonLink variant="secondary" size="sm" href={`/time/calendar?month=${fmtMonthParam(prevMonth)}${params.dept ? `&dept=${params.dept}` : ''}`}>
              ← Prev
            </ButtonLink>
            <ButtonLink variant="secondary" size="sm" href="/time/calendar">
              Today
            </ButtonLink>
            <ButtonLink variant="secondary" size="sm" href={`/time/calendar?month=${fmtMonthParam(nextMonth)}${params.dept ? `&dept=${params.dept}` : ''}`}>
              Next →
            </ButtonLink>
          </div>
        }
      />

      <Card>
        <CardBody className="p-0">
          <div className="grid grid-cols-7 border-b border-ink-100 text-center text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="py-2">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const inMonth = day.getUTCMonth() === m - 1;
              const iso = isoDate(day);
              const dayPto = ptoRequests.filter((r) => isoDate(r.startDate) <= iso && iso <= isoDate(r.endDate));
              const dayHolidays = holidays.filter((h) => isoDate(h.observedDate ?? h.date) === iso);
              const birthdays = workers.filter(
                (w) => w.dateOfBirth && w.dateOfBirth.getUTCMonth() === day.getUTCMonth() && w.dateOfBirth.getUTCDate() === day.getUTCDate(),
              );
              const isToday = iso === isoDate(today);
              return (
                <div
                  key={iso}
                  className={cx(
                    'min-h-24 border-r border-b border-ink-100 p-1.5 align-top last:border-r-0',
                    !inMonth && 'bg-ink-50/60',
                  )}
                >
                  <div
                    className={cx(
                      'mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px]',
                      isToday ? 'bg-brand-600 font-semibold text-white' : inMonth ? 'text-ink-700' : 'text-ink-300',
                    )}
                  >
                    {day.getUTCDate()}
                  </div>
                  <div className="space-y-0.5">
                    {dayHolidays.map((h) => (
                      <div key={h.id} className="truncate rounded bg-ink-800 px-1.5 py-0.5 text-[10.5px] text-white" title={h.name}>
                        {h.calendar.country === 'PH' ? '🇵🇭 ' : '🇺🇸 '}
                        {h.name}
                      </div>
                    ))}
                    {dayPto.slice(0, 3).map((r) => (
                      <Link
                        key={r.id}
                        href={`/people/${r.worker.id}`}
                        className="block truncate rounded bg-brand-100 px-1.5 py-0.5 text-[10.5px] text-brand-700 hover:bg-brand-200"
                        title={`${fullName(r.worker)} — ${r.policy.leaveType.toLowerCase()}`}
                      >
                        {fullName(r.worker)}
                      </Link>
                    ))}
                    {dayPto.length > 3 ? <div className="text-[10.5px] text-ink-400">+{dayPto.length - 3} more out</div> : null}
                    {birthdays.map((w) => (
                      <div key={w.id} className="truncate rounded bg-warn-100 px-1.5 py-0.5 text-[10.5px] text-warn-500" title={`${fullName(w)}'s birthday`}>
                        🎂 {fullName(w)}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-ink-500">
        <span className="flex items-center gap-1.5"><Badge tone="blue">Name</Badge> approved time off</span>
        <span className="flex items-center gap-1.5"><Badge tone="navy">Holiday</Badge> company holiday</span>
        <span className="flex items-center gap-1.5"><Badge tone="amber">🎂</Badge> birthday</span>
      </div>
    </div>
  );
}
