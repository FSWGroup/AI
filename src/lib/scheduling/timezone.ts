/**
 * Time zone arithmetic.
 *
 * Every instant this application stores is UTC. Availability, though, is
 * written the way people think about it — "Tuesdays, 9 to 5" — which is a
 * statement about a wall clock in a particular place. Converting between the
 * two correctly is where scheduling code usually goes wrong, so it lives here
 * and nowhere else.
 *
 * No dependency: Node ships full ICU, and Intl.DateTimeFormat can tell us
 * what a given UTC instant looks like on the wall in any IANA zone. That is
 * all that is actually needed, and it stays correct through daylight-saving
 * changes without a table to maintain.
 */

const PART_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = PART_FORMATTERS.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    PART_FORMATTERS.set(timeZone, f);
  }
  return f;
}

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday. */
  dayOfWeek: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** What a UTC instant reads as on the wall in a zone. */
export function wallClockIn(instant: Date, timeZone: string): WallClock {
  const parts = formatter(timeZone).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // "24" appears at midnight in the hour12:false formatting of some engines.
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    dayOfWeek: WEEKDAY_INDEX[map.weekday] ?? 0,
  };
}

/** The zone's offset from UTC, in milliseconds, at a given instant. */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const w = wallClockIn(instant, timeZone);
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asIfUtc - instant.getTime();
}

/**
 * The UTC instant at which a given wall-clock time occurs in a zone.
 *
 * Two passes. The first guess uses the offset at the naive instant, which can
 * be the wrong side of a daylight-saving boundary; applying the offset found
 * at the corrected instant settles it. On the one hour a year that a wall
 * clock repeats, this resolves to the first occurrence, which is the
 * conventional and the less surprising choice.
 */
export function utcFromWallClock(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  minutesFromMidnight: number,
): Date {
  const naive = Date.UTC(year, month - 1, day, 0, minutesFromMidnight, 0);
  const firstGuess = naive - zoneOffsetMs(new Date(naive), timeZone);
  const settled = naive - zoneOffsetMs(new Date(firstGuess), timeZone);
  return new Date(settled);
}

/**
 * The instant at which a local calendar day begins.
 *
 * Where the clocks go forward at midnight — Havana, Santiago and the Azores
 * do — that wall-clock time does not exist, and this returns 23:00 on the
 * PREVIOUS local date. Do not use it to enumerate dates; `localDatesBetween`
 * walks the calendar instead, for exactly that reason.
 */
export function startOfLocalDay(instant: Date, timeZone: string): Date {
  const w = wallClockIn(instant, timeZone);
  return utcFromWallClock(timeZone, w.year, w.month, w.day, 0);
}

export interface LocalDate {
  year: number;
  month: number;
  day: number;
  /** 0 = Sunday. */
  dayOfWeek: number;
}

/** The most days this will enumerate before giving up on a pathological range. */
export const MAX_LOCAL_DATES = 400;

/**
 * Every local calendar date between two instants.
 *
 * Walked as calendar arithmetic rather than by stepping an instant, because a
 * date is a date — it does not need an instant to represent it, and choosing
 * one is where this went wrong.
 *
 * It used to anchor each day at local midnight. In a zone where the clocks go
 * forward AT midnight, that wall-clock time does not exist, so resolving it
 * landed on the previous local date: the date before was emitted twice and
 * the transition date was never emitted at all. Sweeping every IANA zone this
 * runtime knows across 2026 finds three — America/Havana on 8 March,
 * America/Santiago on 6 September, Atlantic/Azores on 29 March. Downstream,
 * an interviewer in any of them simply could not be booked on that day: the
 * available-intervals expansion iterates these dates, so it returned nothing,
 * and ignored an explicit opening exception written for the missing date too.
 */
export function localDatesBetween(
  from: Date,
  to: Date,
  timeZone: string,
): LocalDate[] {
  const days: LocalDate[] = [];
  if (to.getTime() < from.getTime()) return days;

  const start = wallClockIn(from, timeZone);
  const end = wallClockIn(to, timeZone);
  const last = Date.UTC(end.year, end.month - 1, end.day);

  // A UTC instant used purely as a calendar cursor. UTC has no transitions,
  // so incrementing the date here is exact.
  let cursor = Date.UTC(start.year, start.month - 1, start.day);
  for (let i = 0; i < MAX_LOCAL_DATES && cursor <= last; i++) {
    const d = new Date(cursor);
    days.push({
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      dayOfWeek: d.getUTCDay(),
    });
    cursor += 86_400_000;
  }
  return days;
}

/** "2:30 PM" in a zone, for display. */
export function formatTimeIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
}

/** Whether a string is an IANA zone this runtime actually knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
