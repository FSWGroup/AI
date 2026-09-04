/**
 * Working out when a panel is actually free.
 *
 * Interval algebra over UTC instants, plus the rules that decide which of the
 * resulting gaps are worth offering a candidate. Pure functions: the caller
 * loads availability and busy time from wherever it lives, and this decides.
 *
 * The design commitment: a slot is offered only when EVERY required panelist
 * is free for the whole of it. Offering a time that then has to be taken back
 * is worse than offering fewer times, because the candidate has already told
 * their current employer they need that hour.
 */

import {
  localDatesBetween,
  utcFromWallClock,
} from "./timezone";

export interface Interval {
  start: Date;
  end: Date;
}

export interface WeeklyRule {
  /** 0 = Sunday, in the owner's own zone. */
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export interface DateException {
  /** Local calendar date in the owner's zone. */
  year: number;
  month: number;
  day: number;
  startMinute: number;
  endMinute: number;
  /** False blocks the window; true opens one outside the weekly pattern. */
  available: boolean;
}

export interface PanelistAvailability {
  userId: string;
  timeZone: string;
  required: boolean;
  rules: WeeklyRule[];
  exceptions: DateException[];
  /** Times already committed: interviews, calendar events, anything. */
  busy: Interval[];
}

// ---------------------------------------------------------------------------
// Interval algebra
// ---------------------------------------------------------------------------

export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals]
    .filter((i) => i.end.getTime() > i.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Interval[] = [];
  for (const cur of sorted) {
    const last = merged[merged.length - 1];
    if (last && cur.start.getTime() <= last.end.getTime()) {
      if (cur.end.getTime() > last.end.getTime()) last.end = cur.end;
    } else {
      merged.push({ start: cur.start, end: cur.end });
    }
  }
  return merged;
}

export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const left = mergeIntervals(a);
  const right = mergeIntervals(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const start = Math.max(left[i].start.getTime(), right[j].start.getTime());
    const end = Math.min(left[i].end.getTime(), right[j].end.getTime());
    if (end > start) out.push({ start: new Date(start), end: new Date(end) });
    if (left[i].end.getTime() < right[j].end.getTime()) i++;
    else j++;
  }
  return out;
}

export function subtractIntervals(from: Interval[], remove: Interval[]): Interval[] {
  const blocks = mergeIntervals(remove);
  let out = mergeIntervals(from);
  for (const block of blocks) {
    const next: Interval[] = [];
    for (const free of out) {
      if (block.end <= free.start || block.start >= free.end) {
        next.push(free);
        continue;
      }
      if (block.start > free.start) next.push({ start: free.start, end: block.start });
      if (block.end < free.end) next.push({ start: block.end, end: free.end });
    }
    out = next;
  }
  return out;
}

// ---------------------------------------------------------------------------
// From rules to intervals
// ---------------------------------------------------------------------------

/**
 * Expand one person's weekly pattern and exceptions into concrete UTC
 * intervals across a window.
 *
 * Exceptions are applied after the pattern: a blocking exception carves out of
 * whatever the pattern produced, and an opening one adds a window the pattern
 * never had.
 */
export function availableIntervalsFor(
  panelist: PanelistAvailability,
  window: Interval,
): Interval[] {
  const days = localDatesBetween(window.start, window.end, panelist.timeZone);
  const base: Interval[] = [];

  for (const day of days) {
    for (const rule of panelist.rules) {
      if (rule.dayOfWeek !== day.dayOfWeek) continue;
      if (rule.endMinute <= rule.startMinute) continue;
      base.push({
        start: utcFromWallClock(panelist.timeZone, day.year, day.month, day.day, rule.startMinute),
        end: utcFromWallClock(panelist.timeZone, day.year, day.month, day.day, rule.endMinute),
      });
    }
    for (const ex of panelist.exceptions) {
      if (!ex.available) continue;
      if (ex.year !== day.year || ex.month !== day.month || ex.day !== day.day) continue;
      base.push({
        start: utcFromWallClock(panelist.timeZone, ex.year, ex.month, ex.day, ex.startMinute),
        end: utcFromWallClock(panelist.timeZone, ex.year, ex.month, ex.day, ex.endMinute),
      });
    }
  }

  const blocks: Interval[] = panelist.exceptions
    .filter((ex) => !ex.available)
    .map((ex) => ({
      start: utcFromWallClock(panelist.timeZone, ex.year, ex.month, ex.day, ex.startMinute),
      end: utcFromWallClock(panelist.timeZone, ex.year, ex.month, ex.day, ex.endMinute),
    }));

  const withinWindow = intersectIntervals(mergeIntervals(base), [window]);
  return subtractIntervals(withinWindow, [...blocks, ...panelist.busy]);
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

export interface SlotOptions {
  durationMinutes: number;
  /** Slots start on multiples of this many minutes past the hour. */
  granularityMinutes?: number;
  /** How much notice a candidate has to give. */
  minNoticeHours?: number;
  /** Cap, so a wide window does not produce a page of five hundred times. */
  maxSlots?: number;
  now?: Date;
}

export interface Slot {
  start: Date;
  end: Date;
  /** Optional panelists who are also free — the caller may prefer these. */
  optionalAvailable: string[];
}

export const DEFAULT_GRANULARITY_MINUTES = 30;

/**
 * Times a candidate can be offered.
 *
 * A slot must fit entirely inside a window every REQUIRED panelist is free
 * for. Optional panelists never remove a slot; they are reported alongside it
 * so a recruiter can see which times get the fullest panel.
 */
export function findSlots(
  panelists: PanelistAvailability[],
  window: Interval,
  options: SlotOptions,
): Slot[] {
  const required = panelists.filter((p) => p.required);
  const optional = panelists.filter((p) => !p.required);
  if (required.length === 0) return [];

  const granularity = options.granularityMinutes ?? DEFAULT_GRANULARITY_MINUTES;
  const durationMs = options.durationMinutes * 60_000;
  const now = options.now ?? new Date();
  const earliest = new Date(
    Math.max(
      window.start.getTime(),
      now.getTime() + (options.minNoticeHours ?? 0) * 3600_000,
    ),
  );
  const effective: Interval = { start: earliest, end: window.end };
  if (effective.end <= effective.start) return [];

  // Intersect every required panelist's free time.
  let common = availableIntervalsFor(required[0], effective);
  for (const p of required.slice(1)) {
    if (common.length === 0) break;
    common = intersectIntervals(common, availableIntervalsFor(p, effective));
  }
  if (common.length === 0) return [];

  const optionalFree = optional.map((p) => ({
    userId: p.userId,
    intervals: availableIntervalsFor(p, effective),
  }));

  const slots: Slot[] = [];
  const maxSlots = options.maxSlots ?? 60;
  const granularityMs = granularity * 60_000;

  for (const free of common) {
    // Start at the first granularity boundary at or after the window opens,
    // so offered times are on the half hour rather than at 9:07.
    let cursor = Math.ceil(free.start.getTime() / granularityMs) * granularityMs;
    while (cursor + durationMs <= free.end.getTime()) {
      if (slots.length >= maxSlots) return slots;
      const start = new Date(cursor);
      const end = new Date(cursor + durationMs);
      slots.push({
        start,
        end,
        optionalAvailable: optionalFree
          .filter((o) => covers(o.intervals, start, end))
          .map((o) => o.userId),
      });
      cursor += granularityMs;
    }
  }
  return slots;
}

function covers(intervals: Interval[], start: Date, end: Date): boolean {
  return intervals.some((i) => i.start <= start && i.end >= end);
}

/**
 * Re-check a chosen slot at the moment of booking.
 *
 * The slot list a candidate is looking at was computed when the page loaded.
 * Somebody else may have taken the time since. This is what stops two
 * candidates booking the same panel for the same hour.
 */
export function slotStillAvailable(
  panelists: PanelistAvailability[],
  start: Date,
  durationMinutes: number,
  options: { minNoticeHours?: number; now?: Date; granularityMinutes?: number } = {},
): { ok: true } | { ok: false; reason: string } {
  const now = options.now ?? new Date();
  const end = new Date(start.getTime() + durationMinutes * 60_000);

  // The same "somebody has to decide the times" rule findSlots applies. The
  // two functions answer the same question from different directions, and a
  // gap between them is a time the candidate could book but was never shown.
  const required = panelists.filter((x) => x.required);
  if (required.length === 0) {
    return {
      ok: false,
      reason:
        "There is nobody on this panel whose calendar decides the times. Ask the recruiter to set the interview up again.",
    };
  }

  if (start.getTime() < now.getTime() + (options.minNoticeHours ?? 0) * 3600_000) {
    return {
      ok: false,
      reason: "That time is too soon. Please choose one further ahead.",
    };
  }

  // On the grid, because the start has to be one of the times that were
  // offered. Without this a caller could post any instant that happened to
  // fall inside the panel's free time — 01:07 against a half-hour grid — and
  // it booked.
  const granularityMs =
    (options.granularityMinutes ?? DEFAULT_GRANULARITY_MINUTES) * 60_000;
  if (start.getTime() % granularityMs !== 0) {
    return {
      ok: false,
      reason: "That is not one of the times offered. Please pick one from the list.",
    };
  }

  for (const p of required) {
    const free = availableIntervalsFor(p, {
      start: new Date(start.getTime() - 60_000),
      end: new Date(end.getTime() + 60_000),
    });
    if (!covers(free, start, end)) {
      // Two different failures, and telling a candidate the wrong one wastes
      // their time: "just been taken" sends them hunting for another slot on
      // a day the panel never offered any hours at all.
      //
      // The distinction is exact rather than heuristic — recompute with
      // nothing booked. If the time is covered then, something really was
      // booked over it; if it still is not, no working hours ever reached it.
      const ifNothingBooked = availableIntervalsFor(
        { ...p, busy: [] },
        {
          start: new Date(start.getTime() - 60_000),
          end: new Date(end.getTime() + 60_000),
        },
      );
      return {
        ok: false,
        reason: covers(ifNothingBooked, start, end)
          ? "That time has just been taken. Please pick another."
          : "Nobody on the panel is available then. Please pick one of the times offered.",
      };
    }
  }
  return { ok: true };
}

/** Group slots by local calendar day, for rendering. */
export function groupSlotsByDay(
  slots: Slot[],
  timeZone: string,
): { key: string; slots: Slot[] }[] {
  const groups = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(slot.start);
    const list = groups.get(key) ?? [];
    list.push(slot);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, list]) => ({ key, slots: list }));
}
