import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, can, directReportIds } from '@/lib/authz';
import { addDays, fmtDate, fullName, isoDate, startOfUTCDay } from '@/lib/format';
import {
  Badge, Callout, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge, Table, THead, TH, TRow, TD,
} from '@/components/ui';
import { ClockWidget, ManualEntryForm, TimesheetDecideForm, SubmitTimesheetButton } from './tracking-forms';

export const metadata: Metadata = { title: 'Timesheets' };

function weekStartOf(d: Date): Date {
  const day = startOfUTCDay(d);
  return addDays(day, -((day.getUTCDay() + 6) % 7));
}

function entryHours(e: { clockIn: Date | null; clockOut: Date | null; breakMinutes: number; manualHours: unknown }): number {
  if (e.manualHours !== null && e.manualHours !== undefined) return Number(e.manualHours);
  if (e.clockIn && e.clockOut) {
    return Math.max(0, (e.clockOut.getTime() - e.clockIn.getTime()) / 3600_000 - e.breakMinutes / 60);
  }
  return 0;
}

export default async function TrackingPage() {
  const ctx = await requireCtx();
  const weekStart = weekStartOf(new Date());

  const sheet = ctx.workerId
    ? await db.timesheet.findUnique({
        where: { workerId_weekStart: { workerId: ctx.workerId, weekStart } },
        include: { entries: { orderBy: [{ date: 'asc' }, { clockIn: 'asc' }] } },
      })
    : null;

  const openPunch = ctx.workerId
    ? await db.timeEntry.findFirst({
        where: { timesheet: { workerId: ctx.workerId }, clockIn: { not: null }, clockOut: null },
        orderBy: { clockIn: 'desc' },
      })
    : null;

  const totalHours = sheet ? sheet.entries.reduce((sum, e) => sum + entryHours(e), 0) : 0;
  const overtime = Math.max(0, totalHours - 40);

  // Manager approvals
  const isApprover = can(ctx, 'time.approve') || can(ctx, 'time.admin');
  let submitted: {
    id: string; weekStart: Date; status: string;
    worker: { id: string; legalFirstName: string; preferredName: string | null; lastName: string };
    entries: { clockIn: Date | null; clockOut: Date | null; breakMinutes: number; manualHours: unknown }[];
  }[] = [];
  if (isApprover) {
    const scope = can(ctx, 'time.admin') ? undefined : ctx.workerId ? await directReportIds(ctx.workerId) : [];
    submitted = await db.timesheet.findMany({
      where: { status: 'SUBMITTED', ...(scope ? { workerId: { in: scope } } : {}) },
      include: {
        worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
        entries: true,
      },
      orderBy: { weekStart: 'asc' },
    });
  }

  const editable = !sheet || sheet.status === 'OPEN' || sheet.status === 'REJECTED';

  return (
    <div>
      <PageHeader
        title="Timesheets"
        description={`Week of ${fmtDate(weekStart)} · overtime and other pay rules are configurable warnings, not legal determinations.`}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="This week"
              description={`${totalHours.toFixed(2)} hours recorded${overtime > 0 ? ` · ${overtime.toFixed(2)}h over 40` : ''}`}
              actions={sheet ? <StatusBadge status={sheet.status} /> : <Badge tone="gray">Open</Badge>}
            />
            {overtime > 0 ? (
              <CardBody className="pt-0">
                <Callout tone="warn">
                  Over 40 hours this week. For non-exempt U.S. employees, verify overtime handling with payroll.
                </Callout>
              </CardBody>
            ) : null}
            {!sheet || sheet.entries.length === 0 ? (
              <EmptyState title="No time recorded this week" description="Clock in, or add a manual entry below." />
            ) : (
              <Table>
                <THead><TH>Date</TH><TH>In</TH><TH>Out</TH><TH>Break</TH><TH>Hours</TH><TH>Project</TH></THead>
                <tbody>
                  {sheet.entries.map((e) => (
                    <TRow key={e.id}>
                      <TD>{fmtDate(e.date)}</TD>
                      <TD>{e.clockIn ? e.clockIn.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'manual'}</TD>
                      <TD>{e.clockOut ? e.clockOut.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : e.clockIn ? <Badge tone="blue">active</Badge> : '—'}</TD>
                      <TD>{e.breakMinutes ? `${e.breakMinutes}m` : '—'}</TD>
                      <TD className="tabular-nums">{entryHours(e).toFixed(2)}</TD>
                      <TD>{e.projectCode ?? '—'}</TD>
                    </TRow>
                  ))}
                </tbody>
              </Table>
            )}
            {sheet && sheet.entries.length > 0 && editable ? (
              <CardBody className="border-t border-ink-100">
                <SubmitTimesheetButton timesheetId={sheet.id} />
              </CardBody>
            ) : null}
          </Card>

          {editable && ctx.workerId ? (
            <Card>
              <CardHeader title="Add manual entry" />
              <CardBody>
                <ManualEntryForm />
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          {ctx.workerId ? (
            <Card>
              <CardHeader title="Clock" />
              <CardBody>
                <ClockWidget clockedInSince={openPunch?.clockIn ? openPunch.clockIn.toISOString() : null} />
              </CardBody>
            </Card>
          ) : null}

          {isApprover ? (
            <Card>
              <CardHeader title={`Awaiting approval (${submitted.length})`} />
              {submitted.length === 0 ? (
                <CardBody><p className="text-[13px] text-ink-500">No submitted timesheets.</p></CardBody>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {submitted.map((s) => {
                    const hours = s.entries.reduce((sum, e) => sum + entryHours(e), 0);
                    return (
                      <li key={s.id} className="px-5 py-3">
                        <div className="flex items-center justify-between">
                          <Link href={`/people/${s.worker.id}`} className="text-sm font-medium text-ink-900 hover:text-brand-600">
                            {fullName(s.worker)}
                          </Link>
                          <span className="text-[13px] text-ink-500 tabular-nums">{hours.toFixed(1)}h</span>
                        </div>
                        <div className="text-[12px] text-ink-400">Week of {isoDate(s.weekStart)}</div>
                        <div className="mt-2">
                          <TimesheetDecideForm timesheetId={s.id} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
