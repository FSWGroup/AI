/**
 * The internal calendar.
 *
 * Busy time comes from this platform's own scheduled interviews. That is the
 * source that actually prevents double-booking a panel, and it needs no
 * account, no OAuth, and no token to refresh.
 *
 * It cannot see a dentist appointment. An organization that wants that
 * connects a real provider; the seam is here for it, and nothing above this
 * file has to change.
 */

import "server-only";
import { prisma } from "@/lib/db";
import type { BusyInterval, CalendarEvent, CalendarProvider } from "./types";

export class InternalCalendar implements CalendarProvider {
  readonly kind = "internal" as const;
  readonly readsExternalBusy = false;

  async getBusy(userId: string, from: Date, to: Date): Promise<BusyInterval[]> {
    const interviews = await prisma.interview.findMany({
      where: {
        status: "SCHEDULED",
        scheduledAt: { gte: new Date(from.getTime() - 8 * 3600_000), lte: to },
        participants: { some: { userId } },
      },
      select: { scheduledAt: true, durationMinutes: true, title: true },
    });
    return interviews.map((i) => ({
      start: i.scheduledAt,
      end: new Date(i.scheduledAt.getTime() + i.durationMinutes * 60_000),
      source: `interview:${i.title}`,
    }));
  }

  async getBusyMany(
    userIds: string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, BusyInterval[]>> {
    const out = new Map<string, BusyInterval[]>(userIds.map((id) => [id, []]));
    if (userIds.length === 0) return out;

    const interviews = await prisma.interview.findMany({
      where: {
        status: "SCHEDULED",
        scheduledAt: { gte: new Date(from.getTime() - 8 * 3600_000), lte: to },
        participants: { some: { userId: { in: userIds } } },
      },
      select: {
        scheduledAt: true,
        durationMinutes: true,
        title: true,
        participants: { select: { userId: true } },
      },
    });

    const wanted = new Set(userIds);
    for (const i of interviews) {
      const interval = {
        start: i.scheduledAt,
        end: new Date(i.scheduledAt.getTime() + i.durationMinutes * 60_000),
        source: `interview:${i.title}`,
      };
      for (const participant of i.participants) {
        if (wanted.has(participant.userId)) {
          out.get(participant.userId)!.push(interval);
        }
      }
    }
    return out;
  }

  // Nothing to write: the .ics attachment is the whole mechanism here, and
  // it is generated at send time rather than stored.
  async createEvent(_userId: string, _event: CalendarEvent): Promise<string | null> {
    return null;
  }
  async updateEvent(): Promise<void> {}
  async cancelEvent(): Promise<void> {}
}
