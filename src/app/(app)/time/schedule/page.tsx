import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, can } from '@/lib/authz';
import { fmtMoney, fullName, isoDate } from '@/lib/format';
import {
  Badge, Callout, Card, CardBody, CardHeader, DeniedState, EmptyState, PageHeader, StatCard,
  Table, TD, TH, THead, TRow,
} from '@/components/ui';
import { projectOvertime, weeklyBreakFindings, scheduledLaborCost, weekStart, shiftHours, FLSA_WEEKLY_THRESHOLD } from '@/lib/scheduling';
import { NewShiftButton, AssignButton, UnassignButton, DeleteShiftButton, PublishWeekButton } from './schedule-ui';

export const metadata: Metadata = { title: 'Schedule' };
export const dynamic = 'force-dynamic';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function fmtTime(d: Date): string {
  return d.toISOString().slice(11, 16);
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const ctx = await requireCtx();
  const { week } = await searchParams;
  const canWrite = can(ctx, 'schedule.write');
  const canReadAll = can(ctx, 'schedule.read') || canWrite;

  const start = weekStart(week ? new Date(`${week}T00:00:00Z`) : new Date());
  const end = new Date(start.getTime() + 7 * 86_400_000);
  const prev = isoDate(new Date(start.getTime() - 7 * 86_400_000));
  const next = isoDate(new Date(start.getTime() + 7 * 86_400_000));

  // Someone without schedule.read sees only their own published shifts —
  // enforced in the query, not by hiding rows.
  const shifts = await db.shift.findMany({
    where: {
      date: { gte: start, lt: end },
      status: { not: 'CANCELED' },
      ...(canReadAll ? {} : { status: 'PUBLISHED', assignments: { some: { workerId: ctx.workerId ?? '__none__' } } }),
    },
    include: {
      assignments: {
        include: { worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } } },
      },
    },
    orderBy: [{ date: 'asc' }, { startsAt: 'asc' }],
  });

  if (!canReadAll && !ctx.workerId) {
    return <DeniedState message="Scheduling is for workers with a profile." />;
  }

  const [projection, breaks, cost, locations, departments, staff] = await Promise.all([
    canWrite ? projectOvertime(start) : Promise.resolve([]),
    canWrite ? weeklyBreakFindings(start) : Promise.resolve([]),
    canWrite ? scheduledLaborCost(start) : Promise.resolve([]),
    db.location.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.department.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    canWrite
      ? db.worker.findMany({
          where: { status: 'ACTIVE', deletedAt: null },
          select: { id: true, legalFirstName: true, preferredName: true, lastName: true },
          orderBy: { lastName: 'asc' },
        })
      : Promise.resolve([]),
  ]);

  const drafts = shifts.filter((s) => s.status === 'DRAFT');
  const overtimeRows = projection.filter((p) => p.overtimeHours > 0);
  const totalHours = shifts.reduce((sum, s) => sum + shiftHours(s) * Math.max(1, s.assignments.length), 0);

  const byDay = DAY_NAMES.map((name, i) => {
    const day = new Date(start.getTime() + i * 86_400_000);
    return { name, date: isoDate(day), shifts: shifts.filter((s) => isoDate(s.date) === isoDate(day)) };
  });

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Time', href: '/time/pto' }, { label: 'Schedule' }]}
        title="Schedule"
        description={`Week of ${isoDate(start)}${canReadAll ? '' : ' — your published shifts'}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/time/schedule?week=${prev}`} className="text-[13px] text-brand-700 hover:underline">← Previous</Link>
            <Link href={`/time/schedule?week=${next}`} className="text-[13px] text-brand-700 hover:underline">Next →</Link>
            {canWrite ? <PublishWeekButton weekStart={isoDate(start)} draftCount={drafts.length} /> : null}
          </div>
        }
      />

      {canWrite ? (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Shifts this week" value={shifts.length} hint={`${drafts.length} still draft`} />
          <StatCard label="Scheduled hours" value={totalHours.toFixed(1)} />
          <StatCard label="People projected into overtime" value={overtimeRows.length} tone={overtimeRows.length > 0 ? 'warn' : 'default'} />
          <StatCard label="Break rule findings" value={breaks.length} tone={breaks.length > 0 ? 'danger' : 'default'} />
        </div>
      ) : null}

      {canWrite && drafts.length > 0 ? (
        <Callout tone="info">
          {drafts.length} shift{drafts.length === 1 ? ' is' : 's are'} still a draft and invisible to the people working
          them. Publishing the week is a single act on purpose — a schedule should never be half-changed in front of
          the crew.
        </Callout>
      ) : null}

      <Card className="mt-4">
        <CardHeader title="Week" description={canWrite ? 'Draft shifts are shown greyed until the week is published.' : undefined} />
        <CardBody>
          <div className="fsw-scroll -mx-1 flex gap-3 overflow-x-auto pb-2">
            {byDay.map((day) => (
              <section key={day.date} className="w-56 shrink-0" aria-label={day.name}>
                <div className="mb-2 flex items-center justify-between px-1">
                  <div>
                    <h2 className="text-[13px] font-semibold text-ink-700">{day.name}</h2>
                    <span className="text-[11px] text-ink-400">{day.date.slice(5)}</span>
                  </div>
                  {canWrite ? (
                    <NewShiftButton
                      date={day.date}
                      locations={locations.map((l) => ({ value: l.id, label: l.name }))}
                      departments={departments.map((d) => ({ value: d.id, label: d.name }))}
                    />
                  ) : null}
                </div>
                <div className="space-y-2">
                  {day.shifts.map((shift) => (
                    <div
                      key={shift.id}
                      className={`rounded-card border border-ink-200/80 bg-white p-2.5 shadow-card ${
                        shift.status === 'DRAFT' ? 'opacity-60' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-medium text-ink-900">
                          {fmtTime(shift.startsAt)}–{fmtTime(shift.endsAt)}
                        </span>
                        {shift.status === 'DRAFT' ? <Badge tone="gray">draft</Badge> : null}
                      </div>
                      <div className="text-[11px] text-ink-500">
                        {shift.role ?? 'Shift'} · {shiftHours(shift).toFixed(1)}h
                        {shift.breakMinutes ? ` · ${shift.breakMinutes}m break` : ''}
                      </div>
                      <ul className="mt-1.5 space-y-0.5">
                        {shift.assignments.map((a) => (
                          <li key={a.id} className="flex items-center justify-between text-[12px] text-ink-700">
                            <Link href={`/people/${a.workerId}`} className="truncate hover:text-brand-600">
                              {fullName(a.worker)}
                            </Link>
                            {canWrite ? <UnassignButton assignmentId={a.id} /> : null}
                          </li>
                        ))}
                        {shift.assignments.length === 0 ? (
                          <li className="text-[12px] text-danger-500">unfilled</li>
                        ) : null}
                      </ul>
                      {canWrite ? (
                        <div className="mt-1.5 flex items-center gap-1 border-t border-ink-100 pt-1.5">
                          <AssignButton
                            shiftId={shift.id}
                            workers={staff.map((w) => ({ value: w.id, label: fullName(w) }))}
                          />
                          <DeleteShiftButton shiftId={shift.id} published={shift.status === 'PUBLISHED'} />
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {day.shifts.length === 0 ? (
                    <div className="rounded-card border border-dashed border-ink-200 px-2 py-4 text-center text-[11px] text-ink-300">
                      No shifts
                    </div>
                  ) : null}
                </div>
              </section>
            ))}
          </div>
        </CardBody>
      </Card>

      {canWrite ? (
        <>
          <Card className="mt-4">
            <CardHeader
              title="Overtime forecast"
              description={`Worked hours plus scheduled hours against the ${FLSA_WEEKLY_THRESHOLD}-hour FLSA week. Exempt employees are shown but do not accrue overtime.`}
            />
            <CardBody>
              {projection.length === 0 ? (
                <EmptyState title="Nothing scheduled or worked this week" />
              ) : (
                <Table>
                  <THead>
                    <TH>Person</TH>
                    <TH>Worked</TH>
                    <TH>Scheduled</TH>
                    <TH>Projected</TH>
                    <TH>Overtime</TH>
                    <TH>FLSA</TH>
                  </THead>
                  <tbody>
                    {projection.map((row) => (
                      <TRow key={row.workerId}>
                        <TD>
                          <Link href={`/people/${row.workerId}`} className="text-ink-900 hover:text-brand-600">{row.name}</Link>
                        </TD>
                        <TD className="tabular-nums">{row.workedHours.toFixed(1)}</TD>
                        <TD className="tabular-nums">{row.scheduledHours.toFixed(1)}</TD>
                        <TD className="tabular-nums">{row.projectedHours.toFixed(1)}</TD>
                        <TD className="tabular-nums">
                          {row.overtimeHours > 0 ? <Badge tone="amber">{row.overtimeHours.toFixed(1)}h</Badge> : '—'}
                        </TD>
                        <TD>{row.flsaStatus ? row.flsaStatus.toLowerCase().replace('_', '-') : '—'}</TD>
                      </TRow>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardBody>
          </Card>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Break rule findings"
                description="Scheduled unpaid break against the rules recorded for that location's jurisdiction."
              />
              <CardBody>
                {breaks.length === 0 ? (
                  <EmptyState title="No findings" description="Every published shift meets the unpaid break rules on file." />
                ) : (
                  <ul className="space-y-2">
                    {breaks.map((f, i) => (
                      <li key={`${f.shiftId}-${i}`} className="rounded-md border border-ink-100 px-3 py-2 text-[13px]">
                        <span className="font-medium text-ink-900">{f.ruleName}</span>
                        <span className="block text-[12px] text-ink-500">
                          {isoDate(f.date)} · {f.jurisdiction} · needs {f.requiredMinutes}m, scheduled {f.scheduledMinutes}m
                          {f.workers > 0 ? ` · ${f.workers} assigned` : ' · unassigned'}
                        </span>
                        {f.sourceUrl ? (
                          <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="text-[12px] text-brand-600 hover:underline">
                            source ↗
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-[12px] text-ink-500">
                  A scheduling aid built from rules an administrator recorded, with their sources — not a legal opinion.
                  Confirm current requirements with HR or counsel.
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Estimated labour cost" description="Scheduled hours at current base rates." />
              <CardBody>
                {cost.length === 0 ? (
                  <EmptyState title="Nothing scheduled" />
                ) : (
                  <>
                    <Table>
                      <THead>
                        <TH>Location</TH>
                        <TH>People</TH>
                        <TH>Hours</TH>
                        <TH>Estimate</TH>
                      </THead>
                      <tbody>
                        {cost.map((row) => (
                          <TRow key={row.key}>
                            <TD>{row.key}</TD>
                            <TD className="tabular-nums">{row.workers}</TD>
                            <TD className="tabular-nums">{row.scheduledHours.toFixed(1)}</TD>
                            <TD className="tabular-nums">{fmtMoney(row.estimatedCost, row.currency)}</TD>
                          </TRow>
                        ))}
                      </tbody>
                    </Table>
                    <p className="mt-3 text-[12px] text-ink-500">
                      Base rates only. No overtime premium, shift differential or employer taxes — payroll computes
                      those, and a number that looked complete here would be trusted when it should not be.
                    </p>
                  </>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
