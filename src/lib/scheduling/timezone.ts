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

/** Midnight, in the given zone, of the day a UTC instant falls on there. */
export function startOfLocalDay(instant: Date, timeZone: string): Date {
  const w = wallClockIn(instant, timeZone);
  return utcFromWallClock(timeZone, w.year, w.month, w.day, 0);
}

/** Every local calendar date, as [year, month, day], between two instants. */
export function localDatesBetween(
  from: Date,
  to: Date,
  timeZone: string,
): { year: number; month: number; day: number; dayOfWeek: number }[] {
  const days: { year: number; month: number; day: number; dayOfWeek: number }[] = [];
  let cursor = startOfLocalDay(from, timeZone);
  // Guard against a pathological range rather than looping forever.
  for (let i = 0; i < 400 && cursor.getTime() <= to.getTime(); i++) {
    const w = wallClockIn(cursor, timeZone);
    days.push({ year: w.year, month: w.month, day: w.day, dayOfWeek: w.dayOfWeek });
    // Step 26 hours and re-anchor: adding exactly 24 lands on the same local
    // day when the clocks go back.
    cursor = startOfLocalDay(new Date(cursor.getTime() + 26 * 3600_000), timeZone);
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

export function formatDateIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(instant);
}

/** The short zone name a person would recognize, e.g. "PST" or "GMT+8". */
export function zoneLabel(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(instant);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
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
