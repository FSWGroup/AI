import Link from "next/link";
import { requireActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { formatInTimeZone } from "date-fns-tz";
import { PageHeader, PageBody } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";

type CalendarEventKind = "due" | "live_session" | "certificate_expiry" | "sop_review";

interface CalendarEvent {
  date: Date;
  kind: CalendarEventKind;
  title: string;
  href: string;
}

const KIND_LABEL: Record<CalendarEventKind, string> = {
  due: "Due",
  live_session: "Live session",
  certificate_expiry: "Certificate expires",
  sop_review: "SOP review due",
};

const KIND_TONE: Record<CalendarEventKind, "warning" | "info" | "danger" | "neutral"> = {
  due: "warning",
  live_session: "info",
  certificate_expiry: "danger",
  sop_review: "neutral",
};

function monthBounds(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  return { start, end };
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireActor();
  const params = await searchParams;

  const now = new Date();
  const monthParts = (params.month ?? "").split("-").map(Number);
  const yearParam = monthParts[0];
  const monthParam = monthParts[1];
  const year: number = Number.isFinite(yearParam) ? (yearParam as number) : now.getUTCFullYear();
  const month: number = Number.isFinite(monthParam) ? (monthParam as number) - 1 : now.getUTCMonth();
  const { start, end } = monthBounds(year, month);

  const [assignments, liveSessions, certificates, ownedSops] = await Promise.all([
    prisma.assignment.findMany({
      where: { userId: actor.id, dueAt: { gte: start, lt: end } },
      include: { course: { select: { id: true, title: true } }, sop: { select: { id: true, title: true } }, path: { select: { id: true, title: true } } },
    }),
    prisma.liveSession.findMany({
      where: { startsAt: { gte: start, lt: end }, attendance: { some: { userId: actor.id } } },
      select: { id: true, title: true, startsAt: true, courseId: true },
    }),
    prisma.certificate.findMany({
      where: { userId: actor.id, revokedAt: null, expiresAt: { gte: start, lt: end } },
      select: { id: true, courseTitleSnapshot: true, expiresAt: true },
    }),
    prisma.sop.findMany({
      where: { isDeleted: false, ownerId: actor.id, nextReviewAt: { gte: start, lt: end } },
      select: { id: true, title: true, sopCode: true, nextReviewAt: true },
    }),
  ]);

  const events: CalendarEvent[] = [
    ...assignments
      .filter((a): a is typeof a & { dueAt: Date } => Boolean(a.dueAt))
      .map((a) => ({
        date: a.dueAt,
        kind: "due" as const,
        title: a.course?.title ?? a.sop?.title ?? a.path?.title ?? "Training",
        href: a.course ? `/courses/${a.course.id}` : a.sop ? `/sops/${a.sop.id}` : a.path ? `/paths/${a.path.id}` : "/my-training",
      })),
    ...liveSessions.map((s) => ({ date: s.startsAt, kind: "live_session" as const, title: s.title, href: s.courseId ? `/courses/${s.courseId}` : "/calendar" })),
    ...certificates
      .filter((c): c is typeof c & { expiresAt: Date } => Boolean(c.expiresAt))
      .map((c) => ({ date: c.expiresAt, kind: "certificate_expiry" as const, title: c.courseTitleSnapshot, href: "/certificates" })),
    ...ownedSops
      .filter((s): s is typeof s & { nextReviewAt: Date } => Boolean(s.nextReviewAt))
      .map((s) => ({ date: s.nextReviewAt, kind: "sop_review" as const, title: `${s.sopCode} — ${s.title}`, href: `/admin/content/sops/${s.id}` })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  const eventsByDay = new Map<number, CalendarEvent[]>();
  for (const event of events) {
    const day = event.date.getUTCDate();
    eventsByDay.set(day, [...(eventsByDay.get(day) ?? []), event]);
  }

  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const firstWeekday = start.getUTCDay();
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const prevMonth = month === 0 ? { year: year - 1, month: 12 } : { year, month };
  const nextMonth = month === 11 ? { year: year + 1, month: 1 } : { year, month: month + 2 };
  const monthLabel = new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div>
      <PageHeader
        title="Calendar"
        description={`Assigned due dates, live sessions, certificate expirations, and SOP review deadlines, shown in your time zone (${actor.timezone}).`}
        meta={
          <div className="flex items-center gap-2 text-[0.8125rem]">
            <Link href={`/calendar?month=${prevMonth.year}-${String(prevMonth.month).padStart(2, "0")}`} className="rounded-md border border-[var(--border-default)] px-2.5 py-1 hover:bg-[var(--surface-sunken)]">
              ← Previous
            </Link>
            <span className="font-semibold text-[var(--text-primary)]">{monthLabel}</span>
            <Link href={`/calendar?month=${nextMonth.year}-${String(nextMonth.month).padStart(2, "0")}`} className="rounded-md border border-[var(--border-default)] px-2.5 py-1 hover:bg-[var(--surface-sunken)]">
              Next →
            </Link>
          </div>
        }
      />
      <PageBody className="flex flex-col gap-6">
        {/* Visual month grid — decorative summary; the agenda list below is the accessible source of truth. */}
        <div aria-hidden="true" className="hidden overflow-hidden rounded-lg border border-[var(--border-subtle)] sm:block">
          <div className="grid grid-cols-7 bg-[var(--surface-sunken)] text-center text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              const dayEvents = day ? (eventsByDay.get(day) ?? []) : [];
              const isToday = day === now.getUTCDate() && month === now.getUTCMonth() && year === now.getUTCFullYear();
              return (
                <div key={i} className="min-h-24 border-b border-r border-[var(--border-subtle)] p-1.5">
                  {day && (
                    <>
                      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[0.75rem] ${isToday ? "bg-[var(--brand-primary)] font-semibold text-white" : "text-[var(--text-secondary)]"}`}>
                        {day}
                      </span>
                      <div className="mt-1 flex flex-col gap-0.5">
                        {dayEvents.slice(0, 3).map((e, idx) => (
                          <span key={idx} className="truncate text-[0.6875rem] text-[var(--text-secondary)]">
                            <Badge tone={KIND_TONE[e.kind]} className="mr-1 px-1 py-0 text-[0.625rem]" dot />
                            {e.title}
                          </span>
                        ))}
                        {dayEvents.length > 3 && <span className="text-[0.625rem] text-[var(--text-muted)]">+{dayEvents.length - 3} more</span>}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <section>
          <h2 className="mb-2 text-[0.9375rem] font-semibold text-[var(--text-primary)]">Agenda</h2>
          {events.length === 0 ? (
            <EmptyState icon={<Icon name="calendar" className="h-5 w-5" />} title="Nothing scheduled this month" description="Due dates, live sessions, and expirations will appear here." />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {events.map((event, i) => (
                <li key={i}>
                  <Link href={event.href} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3.5 hover:border-[var(--border-strong)]">
                    <div className="flex items-center gap-3">
                      <div className="flex w-14 shrink-0 flex-col items-center rounded-md bg-[var(--surface-sunken)] py-1">
                        <span className="text-[0.6875rem] font-semibold uppercase text-[var(--text-muted)]">{formatInTimeZone(event.date, actor.timezone, "MMM")}</span>
                        <span className="text-[1rem] font-semibold text-[var(--text-primary)]">{formatInTimeZone(event.date, actor.timezone, "d")}</span>
                      </div>
                      <div>
                        <p className="font-medium text-[var(--text-primary)]">{event.title}</p>
                        <p className="text-[0.75rem] text-[var(--text-muted)]">{formatInTimeZone(event.date, actor.timezone, "EEEE, h:mm a zzz")}</p>
                      </div>
                    </div>
                    <Badge tone={KIND_TONE[event.kind]}>{KIND_LABEL[event.kind]}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </PageBody>
    </div>
  );
}
