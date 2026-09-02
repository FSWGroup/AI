/**
 * Scheduling service.
 *
 * Loads availability, offers slots, books, reschedules, cancels, and queues
 * reminders. The interval mathematics lives in slots.ts; this is the part
 * that talks to the database and the calendar provider.
 */

import "server-only";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { generateToken, hashToken } from "@/lib/crypto";
import { getCalendar, buildIcs, type CalendarEvent } from "@/lib/calendar";
import {
  findSlots,
  slotStillAvailable,
  type Interval,
  type PanelistAvailability,
  type Slot,
} from "./slots";
import { wallClockIn } from "./timezone";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function schedulingReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `IV-${Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("")}`;
}

/**
 * Load what each panelist has said about their availability, plus what they
 * are already committed to.
 *
 * `excludeInterviewId` matters when rescheduling: the interview being moved
 * must not block its own new time.
 */
export async function loadPanelistAvailability(
  panelists: { userId: string; required: boolean }[],
  window: Interval,
  excludeInterviewId?: string | null,
): Promise<PanelistAvailability[]> {
  if (panelists.length === 0) return [];
  const userIds = panelists.map((p) => p.userId);

  const [users, rules, exceptions] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, timeZone: true },
    }),
    prisma.availabilityRule.findMany({
      where: { userId: { in: userIds }, active: true },
    }),
    prisma.availabilityException.findMany({
      where: {
        userId: { in: userIds },
        date: {
          gte: new Date(window.start.getTime() - 2 * 86_400_000),
          lte: new Date(window.end.getTime() + 2 * 86_400_000),
        },
      },
    }),
  ]);

  const zoneById = new Map(users.map((u) => [u.id, u.timeZone]));
  const calendar = getCalendar();

  return Promise.all(
    panelists.map(async (p) => {
      const timeZone = zoneById.get(p.userId) ?? "Asia/Manila";
      const busy = (await calendar.getBusy(p.userId, window.start, window.end)).map(
        (b) => ({ start: b.start, end: b.end }),
      );
      const ownBusy = excludeInterviewId
        ? await excludeOwn(busy, excludeInterviewId)
        : busy;
      return {
        userId: p.userId,
        timeZone,
        required: p.required,
        rules: rules
          .filter((r) => r.userId === p.userId)
          .map((r) => ({
            dayOfWeek: r.dayOfWeek,
            startMinute: r.startMinute,
            endMinute: r.endMinute,
          })),
        exceptions: exceptions
          .filter((e) => e.userId === p.userId)
          .map((e) => {
            // Stored as midnight UTC of the local date the person meant.
            const w = wallClockIn(e.date, "UTC");
            return {
              year: w.year,
              month: w.month,
              day: w.day,
              startMinute: e.startMinute,
              endMinute: e.endMinute,
              available: e.available,
            };
          }),
        busy: ownBusy,
      };
    }),
  );
}

/** Drop the interview being rescheduled from its own panelists' busy time. */
async function excludeOwn(
  busy: Interval[],
  interviewId: string,
): Promise<Interval[]> {
  const own = await prisma.interview.findUnique({
    where: { id: interviewId },
    select: { scheduledAt: true, durationMinutes: true },
  });
  if (!own) return busy;
  const start = own.scheduledAt.getTime();
  const end = start + own.durationMinutes * 60_000;
  return busy.filter(
    (b) => !(b.start.getTime() === start && b.end.getTime() === end),
  );
}

// ---------------------------------------------------------------------------
// Creating a request
// ---------------------------------------------------------------------------

export async function createSchedulingRequest(args: {
  applicationId: string;
  title: string;
  durationMinutes: number;
  kitId?: string | null;
  stageId?: string | null;
  notes?: string | null;
  meetingDetail?: string | null;
  earliestAt: Date;
  latestAt: Date;
  minNoticeHours: number;
  panelists: { userId: string; required: boolean }[];
  actorId: string;
  baseUrl: string;
}): Promise<{ id: string; reference: string; token: string; url: string } | { error: string }> {
  if (args.panelists.filter((p) => p.required).length === 0) {
    return {
      error:
        "Name at least one required interviewer. Without one there is nobody whose calendar decides which times can be offered.",
    };
  }
  if (args.latestAt <= args.earliestAt) {
    return { error: "The booking window ends before it starts." };
  }

  const token = generateToken();
  const request = await prisma.schedulingRequest.create({
    data: {
      applicationId: args.applicationId,
      kitId: args.kitId ?? null,
      stageId: args.stageId ?? null,
      title: args.title,
      durationMinutes: args.durationMinutes,
      notes: args.notes ?? null,
      meetingDetail: args.meetingDetail ?? null,
      reference: schedulingReference(),
      tokenHash: hashToken(token),
      earliestAt: args.earliestAt,
      latestAt: args.latestAt,
      minNoticeHours: args.minNoticeHours,
      createdById: args.actorId,
      panelists: {
        create: args.panelists.map((p) => ({
          userId: p.userId,
          required: p.required,
        })),
      },
    },
  });

  await audit({
    userId: args.actorId,
    action: "scheduling.request_created",
    entityType: "SchedulingRequest",
    entityId: request.id,
    newValue: { reference: request.reference, panelists: args.panelists.length },
  });

  return {
    id: request.id,
    reference: request.reference,
    token,
    url: `${args.baseUrl.replace(/\/$/, "")}/schedule/${token}`,
  };
}

export async function loadRequestByToken(token: string) {
  return prisma.schedulingRequest.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      panelists: { include: { user: { select: { id: true, name: true } } } },
      application: {
        include: {
          candidate: { select: { firstName: true, lastName: true, email: true } },
          requisition: { select: { title: true } },
        },
      },
      interview: true,
    },
  });
}

/** Slots to offer, for a request in its current state. */
export async function slotsForRequest(
  requestId: string,
  now: Date = new Date(),
): Promise<Slot[]> {
  const request = await prisma.schedulingRequest.findUnique({
    where: { id: requestId },
    include: { panelists: true },
  });
  if (!request) return [];

  const window: Interval = { start: request.earliestAt, end: request.latestAt };
  const availability = await loadPanelistAvailability(
    request.panelists.map((p) => ({ userId: p.userId, required: p.required })),
    window,
    request.interviewId,
  );

  return findSlots(availability, window, {
    durationMinutes: request.durationMinutes,
    minNoticeHours: request.minNoticeHours,
    now,
    maxSlots: 60,
  });
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

export type BookResult =
  | { ok: true; interviewId: string; rescheduled: boolean }
  | { ok: false; reason: string };

export async function bookSlot(args: {
  requestId: string;
  start: Date;
  candidateTimeZone?: string | null;
  now?: Date;
}): Promise<BookResult> {
  const now = args.now ?? new Date();
  const request = await prisma.schedulingRequest.findUnique({
    where: { id: args.requestId },
    include: { panelists: true, application: true },
  });
  if (!request) return { ok: false, reason: "That link is not valid." };
  if (request.status === "CANCELLED") {
    return { ok: false, reason: "This interview request has been withdrawn." };
  }
  if (request.status === "EXPIRED" || request.latestAt < now) {
    return {
      ok: false,
      reason:
        "The window for booking this interview has closed. Contact your recruiting contact and they will reopen it.",
    };
  }

  const rescheduling = request.status === "BOOKED";
  if (rescheduling && request.rescheduleCount >= request.maxReschedules) {
    return {
      ok: false,
      reason:
        "This interview has already been moved as many times as the link allows. Please contact your recruiting contact directly.",
    };
  }

  if (args.start < request.earliestAt || args.start > request.latestAt) {
    return { ok: false, reason: "That time is outside the booking window." };
  }

  // Re-check against live availability. The list the candidate is looking at
  // was computed when their page loaded, and somebody else may have taken the
  // time since — this is what stops two candidates booking the same panel.
  const availability = await loadPanelistAvailability(
    request.panelists.map((p) => ({ userId: p.userId, required: p.required })),
    {
      start: new Date(args.start.getTime() - 86_400_000),
      end: new Date(args.start.getTime() + 86_400_000),
    },
    request.interviewId,
  );
  const check = slotStillAvailable(availability, args.start, request.durationMinutes, {
    minNoticeHours: request.minNoticeHours,
    now,
  });
  if (!check.ok) return { ok: false, reason: check.reason };

  const interviewId = await prisma.$transaction(async (tx) => {
    let id = request.interviewId;
    if (id) {
      await tx.interview.update({
        where: { id },
        data: { scheduledAt: args.start, status: "SCHEDULED" },
      });
    } else {
      const created = await tx.interview.create({
        data: {
          applicationId: request.applicationId,
          stageId: request.stageId,
          kitId: request.kitId,
          title: request.title,
          scheduledAt: args.start,
          durationMinutes: request.durationMinutes,
          meetingDetail: request.meetingDetail,
          participants: {
            create: request.panelists.map((p) => ({ userId: p.userId })),
          },
        },
      });
      id = created.id;
    }

    await tx.schedulingRequest.update({
      where: { id: request.id },
      data: {
        status: "BOOKED",
        interviewId: id,
        candidateTimeZone: args.candidateTimeZone ?? request.candidateTimeZone,
        ...(rescheduling ? { rescheduleCount: { increment: 1 } } : {}),
      },
    });
    await tx.application.update({
      where: { id: request.applicationId },
      data: { lastActivityAt: new Date() },
    });

    // Reminders are rewritten from scratch on every booking, so a moved
    // interview never leaves a reminder pointing at the old time.
    await tx.scheduledReminder.deleteMany({
      where: { interviewId: id, sentAt: null },
    });
    const reminders = plannedReminders(
      id as string,
      args.start,
      request.panelists.map((p) => p.userId),
    ).filter((r) => r.dueAt > now);
    if (reminders.length > 0) {
      await tx.scheduledReminder.createMany({ data: reminders, skipDuplicates: true });
    }
    return id as string;
  });

  await audit({
    actorLabel: "candidate",
    action: rescheduling ? "scheduling.rescheduled" : "scheduling.booked",
    entityType: "SchedulingRequest",
    entityId: request.id,
    newValue: { interviewId, start: args.start },
  });

  return { ok: true, interviewId, rescheduled: rescheduling };
}

function plannedReminders(
  interviewId: string,
  start: Date,
  panelistIds: string[],
): {
  interviewId: string;
  kind: "CANDIDATE_DAY_BEFORE" | "CANDIDATE_HOUR_BEFORE" | "PANELIST_DAY_BEFORE";
  userId: string | null;
  dueAt: Date;
}[] {
  return [
    {
      interviewId,
      kind: "CANDIDATE_DAY_BEFORE" as const,
      userId: null,
      dueAt: new Date(start.getTime() - 24 * 3600_000),
    },
    {
      interviewId,
      kind: "CANDIDATE_HOUR_BEFORE" as const,
      userId: null,
      dueAt: new Date(start.getTime() - 3600_000),
    },
    ...panelistIds.map((userId) => ({
      interviewId,
      kind: "PANELIST_DAY_BEFORE" as const,
      userId,
      dueAt: new Date(start.getTime() - 24 * 3600_000),
    })),
  ];
}

export async function cancelBooking(args: {
  requestId: string;
  reason?: string | null;
  byCandidate: boolean;
  actorId?: string | null;
}): Promise<void> {
  const request = await prisma.schedulingRequest.findUniqueOrThrow({
    where: { id: args.requestId },
  });

  await prisma.$transaction(async (tx) => {
    if (request.interviewId) {
      await tx.interview.update({
        where: { id: request.interviewId },
        data: {
          status: "CANCELLED",
          cancelledReason: args.reason ?? (args.byCandidate ? "Cancelled by candidate" : null),
        },
      });
      await tx.scheduledReminder.updateMany({
        where: { interviewId: request.interviewId, sentAt: null },
        data: { cancelledAt: new Date() },
      });
    }
    await tx.schedulingRequest.update({
      where: { id: request.id },
      data: { status: "CANCELLED", cancelledReason: args.reason ?? null },
    });
  });

  await audit({
    userId: args.actorId ?? null,
    actorLabel: args.byCandidate ? "candidate" : undefined,
    action: "scheduling.cancelled",
    entityType: "SchedulingRequest",
    entityId: request.id,
    newValue: { reason: args.reason ?? null },
  });
}

// ---------------------------------------------------------------------------
// Calendar files
// ---------------------------------------------------------------------------

export async function interviewCalendarEvent(
  interviewId: string,
  opts: { cancelled?: boolean } = {},
): Promise<{ event: CalendarEvent; ics: string } | null> {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: {
      participants: { include: { user: { select: { name: true, email: true } } } },
      application: {
        include: {
          candidate: { select: { firstName: true, lastName: true, email: true } },
          requisition: { select: { title: true } },
        },
      },
      schedulingRequest: { select: { rescheduleCount: true, notes: true } },
    },
  });
  if (!interview) return null;

  const event: CalendarEvent = {
    uid: `interview-${interview.id}@fsw-talent-scout`,
    title: `${interview.title} — ${interview.application.requisition.title}`,
    description: interview.schedulingRequest?.notes ?? undefined,
    location: interview.meetingDetail ?? undefined,
    start: interview.scheduledAt,
    end: new Date(interview.scheduledAt.getTime() + interview.durationMinutes * 60_000),
    attendees: [
      {
        email: interview.application.candidate.email,
        name: `${interview.application.candidate.firstName} ${interview.application.candidate.lastName}`,
      },
      ...interview.participants.map((p) => ({
        email: p.user.email,
        name: p.user.name,
      })),
    ],
    // Every reschedule bumps the sequence, or calendars keep showing the old
    // time alongside the new one.
    sequence: interview.schedulingRequest?.rescheduleCount ?? 0,
    status: opts.cancelled ? "CANCELLED" : "CONFIRMED",
  };

  return {
    event,
    ics: buildIcs(event, { method: opts.cancelled ? "CANCEL" : "REQUEST" }),
  };
}
