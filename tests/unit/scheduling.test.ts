import { describe, expect, it } from "vitest";
import {
  formatTimeIn,
  isValidTimeZone,
  localDatesBetween,
  utcFromWallClock,
  wallClockIn,
  zoneOffsetMs,
} from "@/lib/scheduling/timezone";
import {
  availableIntervalsFor,
  findSlots,
  groupSlotsByDay,
  intersectIntervals,
  mergeIntervals,
  slotStillAvailable,
  subtractIntervals,
  type PanelistAvailability,
} from "@/lib/scheduling/slots";

const MANILA = "Asia/Manila";
const NY = "America/New_York";

describe("timezone", () => {
  it("reads a UTC instant on the wall in a zone", () => {
    // 2026-09-01 00:30 UTC is 08:30 the same day in Manila (UTC+8, no DST).
    const w = wallClockIn(new Date("2026-09-01T00:30:00Z"), MANILA);
    expect(w).toMatchObject({ year: 2026, month: 9, day: 1, hour: 8, minute: 30 });
    expect(w.dayOfWeek).toBe(2); // Tuesday
  });

  it("converts a wall-clock time back to the right instant", () => {
    const utc = utcFromWallClock(MANILA, 2026, 9, 1, 9 * 60);
    expect(utc.toISOString()).toBe("2026-09-01T01:00:00.000Z");
  });

  it("round-trips through the wall clock", () => {
    const utc = utcFromWallClock(NY, 2026, 3, 15, 14 * 60 + 30);
    const w = wallClockIn(utc, NY);
    expect(w).toMatchObject({ year: 2026, month: 3, day: 15, hour: 14, minute: 30 });
  });

  it("gets the offset right on both sides of a daylight-saving change", () => {
    // US DST begins 2026-03-08. Before: UTC-5. After: UTC-4.
    expect(zoneOffsetMs(new Date("2026-03-07T12:00:00Z"), NY)).toBe(-5 * 3600_000);
    expect(zoneOffsetMs(new Date("2026-03-09T12:00:00Z"), NY)).toBe(-4 * 3600_000);
  });

  it("keeps 9am at 9am across a spring-forward weekend", () => {
    // The whole point of storing the rule as a wall-clock time: an interviewer
    // who said "9am" means 9am on both sides of the clock change, even though
    // the UTC instants are an hour apart.
    const before = utcFromWallClock(NY, 2026, 3, 6, 9 * 60);
    const after = utcFromWallClock(NY, 2026, 3, 10, 9 * 60);
    expect(wallClockIn(before, NY).hour).toBe(9);
    expect(wallClockIn(after, NY).hour).toBe(9);
    expect(before.toISOString()).toContain("14:00");
    expect(after.toISOString()).toContain("13:00");
  });

  it("walks local days without losing one to a clock change", () => {
    const days = localDatesBetween(
      new Date("2026-03-06T12:00:00Z"),
      new Date("2026-03-11T12:00:00Z"),
      NY,
    );
    expect(days.map((d) => d.day)).toEqual([6, 7, 8, 9, 10, 11]);
  });

  it("recognizes bad zones instead of throwing later", () => {
    expect(isValidTimeZone(MANILA)).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
  });

  it("formats a time in the reader's own zone", () => {
    const t = new Date("2026-09-01T01:00:00Z");
    expect(formatTimeIn(t, MANILA)).toBe("9:00 AM");
    expect(formatTimeIn(t, "UTC")).toBe("1:00 AM");
  });
});

// ---------------------------------------------------------------------------

const iv = (a: string, b: string) => ({ start: new Date(a), end: new Date(b) });

describe("interval algebra", () => {
  it("merges overlapping and touching intervals", () => {
    const merged = mergeIntervals([
      iv("2026-09-01T09:00:00Z", "2026-09-01T10:00:00Z"),
      iv("2026-09-01T09:30:00Z", "2026-09-01T11:00:00Z"),
      iv("2026-09-01T11:00:00Z", "2026-09-01T12:00:00Z"),
      iv("2026-09-01T14:00:00Z", "2026-09-01T15:00:00Z"),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].end.toISOString()).toContain("12:00");
  });

  it("drops zero-length intervals", () => {
    expect(mergeIntervals([iv("2026-09-01T09:00:00Z", "2026-09-01T09:00:00Z")])).toEqual([]);
  });

  it("intersects two sets", () => {
    const out = intersectIntervals(
      [iv("2026-09-01T09:00:00Z", "2026-09-01T12:00:00Z")],
      [
        iv("2026-09-01T08:00:00Z", "2026-09-01T10:00:00Z"),
        iv("2026-09-01T11:00:00Z", "2026-09-01T13:00:00Z"),
      ],
    );
    expect(out).toHaveLength(2);
    expect(out[0].start.toISOString()).toContain("09:00");
    expect(out[0].end.toISOString()).toContain("10:00");
    expect(out[1].start.toISOString()).toContain("11:00");
  });

  it("subtracts a block from the middle, leaving both sides", () => {
    const out = subtractIntervals(
      [iv("2026-09-01T09:00:00Z", "2026-09-01T17:00:00Z")],
      [iv("2026-09-01T12:00:00Z", "2026-09-01T13:00:00Z")],
    );
    expect(out).toHaveLength(2);
    expect(out[0].end.toISOString()).toContain("12:00");
    expect(out[1].start.toISOString()).toContain("13:00");
  });

  it("removes an interval swallowed entirely by a block", () => {
    expect(
      subtractIntervals(
        [iv("2026-09-01T10:00:00Z", "2026-09-01T11:00:00Z")],
        [iv("2026-09-01T09:00:00Z", "2026-09-01T17:00:00Z")],
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

function panelist(over: Partial<PanelistAvailability> = {}): PanelistAvailability {
  return {
    userId: "u1",
    timeZone: MANILA,
    required: true,
    // Weekdays 9-5 local.
    rules: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
      dayOfWeek,
      startMinute: 9 * 60,
      endMinute: 17 * 60,
    })),
    exceptions: [],
    busy: [],
    ...over,
  };
}

// Tuesday 2026-09-01 through Friday 2026-09-04, in UTC.
const WINDOW = iv("2026-09-01T00:00:00Z", "2026-09-04T23:59:00Z");

describe("availableIntervalsFor", () => {
  it("turns a weekly rule into concrete UTC windows", () => {
    const out = availableIntervalsFor(panelist(), WINDOW);
    // Four weekdays inside the window.
    expect(out).toHaveLength(4);
    // 9am Manila is 01:00 UTC.
    expect(out[0].start.toISOString()).toBe("2026-09-01T01:00:00.000Z");
    expect(out[0].end.toISOString()).toBe("2026-09-01T09:00:00.000Z");
  });

  it("carves out busy time", () => {
    const out = availableIntervalsFor(
      panelist({ busy: [iv("2026-09-01T03:00:00Z", "2026-09-01T04:00:00Z")] }),
      WINDOW,
    );
    expect(out[0].end.toISOString()).toContain("03:00");
    expect(out[1].start.toISOString()).toContain("04:00");
  });

  it("honours a blocking exception for one day only", () => {
    const out = availableIntervalsFor(
      panelist({
        exceptions: [
          { year: 2026, month: 9, day: 2, startMinute: 0, endMinute: 24 * 60, available: false },
        ],
      }),
      WINDOW,
    );
    expect(out).toHaveLength(3);
    expect(out.every((i) => !i.start.toISOString().startsWith("2026-09-02"))).toBe(true);
  });

  it("honours an opening exception on a day the pattern does not cover", () => {
    // Saturday 2026-09-05.
    const out = availableIntervalsFor(
      panelist({
        exceptions: [
          { year: 2026, month: 9, day: 5, startMinute: 10 * 60, endMinute: 12 * 60, available: true },
        ],
      }),
      iv("2026-09-05T00:00:00Z", "2026-09-05T23:59:00Z"),
    );
    expect(out).toHaveLength(1);
    expect(out[0].start.toISOString()).toBe("2026-09-05T02:00:00.000Z");
  });
});

describe("findSlots", () => {
  const NOW = new Date("2026-08-31T00:00:00Z");

  it("offers slots on the granularity boundary", () => {
    const slots = findSlots([panelist()], WINDOW, {
      durationMinutes: 45,
      now: NOW,
      maxSlots: 5,
    });
    expect(slots).toHaveLength(5);
    expect(slots[0].start.toISOString()).toBe("2026-09-01T01:00:00.000Z");
    expect(slots[1].start.toISOString()).toBe("2026-09-01T01:30:00.000Z");
  });

  it("never offers a slot that runs past the end of a free window", () => {
    const slots = findSlots(
      [
        panelist({
          rules: [{ dayOfWeek: 2, startMinute: 9 * 60, endMinute: 10 * 60 }],
        }),
      ],
      WINDOW,
      { durationMinutes: 45, now: NOW },
    );
    // Only 9:00 fits a 45-minute meeting inside a one-hour window; 9:30 would
    // overrun, and an offered time that has to be taken back is worse than
    // one fewer option.
    expect(slots).toHaveLength(1);
    expect(slots[0].end.toISOString()).toBe("2026-09-01T01:45:00.000Z");
  });

  it("requires every required panelist to be free", () => {
    const early = panelist({
      userId: "early",
      rules: [{ dayOfWeek: 2, startMinute: 9 * 60, endMinute: 12 * 60 }],
    });
    const late = panelist({
      userId: "late",
      rules: [{ dayOfWeek: 2, startMinute: 11 * 60, endMinute: 17 * 60 }],
    });
    const slots = findSlots([early, late], WINDOW, {
      durationMinutes: 60,
      now: NOW,
    });
    // The overlap is 11:00-12:00 Manila = 03:00-04:00 UTC: one slot.
    expect(slots).toHaveLength(1);
    expect(slots[0].start.toISOString()).toBe("2026-09-01T03:00:00.000Z");
  });

  it("finds the overlap across time zones", () => {
    // Manila 9-5 and New York 9-5 barely overlap: NY 9pm-midnight is Manila
    // 9am-noon the next day.
    const manila = panelist({ userId: "manila" });
    const newYork = panelist({
      userId: "ny",
      timeZone: NY,
      rules: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
        dayOfWeek,
        startMinute: 20 * 60,
        endMinute: 22 * 60,
      })),
    });
    const slots = findSlots([manila, newYork], WINDOW, {
      durationMinutes: 60,
      now: NOW,
    });
    expect(slots.length).toBeGreaterThan(0);
    // Every slot must read as inside both people's stated hours.
    for (const s of slots) {
      expect(wallClockIn(s.start, MANILA).hour).toBeGreaterThanOrEqual(9);
      expect(wallClockIn(s.start, NY).hour).toBeGreaterThanOrEqual(20);
    }
  });

  it("does not let an optional panelist remove a slot", () => {
    const required = panelist({ userId: "req" });
    const optional = panelist({
      userId: "opt",
      required: false,
      rules: [{ dayOfWeek: 2, startMinute: 9 * 60, endMinute: 10 * 60 }],
    });
    const withOptional = findSlots([required, optional], WINDOW, {
      durationMinutes: 30,
      now: NOW,
      maxSlots: 100,
    });
    const withoutOptional = findSlots([required], WINDOW, {
      durationMinutes: 30,
      now: NOW,
      maxSlots: 100,
    });
    expect(withOptional).toHaveLength(withoutOptional.length);
    expect(withOptional[0].optionalAvailable).toEqual(["opt"]);
    expect(withOptional[withOptional.length - 1].optionalAvailable).toEqual([]);
  });

  it("respects the minimum notice", () => {
    const soon = new Date("2026-09-01T00:00:00Z");
    const slots = findSlots([panelist()], WINDOW, {
      durationMinutes: 30,
      minNoticeHours: 24,
      now: soon,
      maxSlots: 100,
    });
    expect(slots.every((s) => s.start.getTime() >= soon.getTime() + 24 * 3600_000)).toBe(true);
  });

  it("returns nothing when there are no required panelists", () => {
    expect(
      findSlots([panelist({ required: false })], WINDOW, { durationMinutes: 30 }),
    ).toEqual([]);
  });

  it("caps how many it returns", () => {
    const slots = findSlots([panelist()], WINDOW, {
      durationMinutes: 30,
      now: NOW,
      maxSlots: 7,
    });
    expect(slots).toHaveLength(7);
  });
});

describe("slotStillAvailable", () => {
  const NOW = new Date("2026-08-31T00:00:00Z");

  it("confirms a slot that is genuinely free", () => {
    const out = slotStillAvailable(
      [panelist()],
      new Date("2026-09-01T02:00:00Z"),
      45,
      { now: NOW },
    );
    expect(out.ok).toBe(true);
  });

  it("catches a slot taken since the page loaded", () => {
    // The race that would otherwise double-book a panel.
    const out = slotStillAvailable(
      [panelist({ busy: [iv("2026-09-01T02:00:00Z", "2026-09-01T03:00:00Z")] })],
      new Date("2026-09-01T02:00:00Z"),
      45,
      { now: NOW },
    );
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toContain("just been taken");
  });

  it("refuses a booking inside the notice period", () => {
    const out = slotStillAvailable(
      [panelist()],
      new Date("2026-09-01T02:00:00Z"),
      45,
      { now: new Date("2026-09-01T00:00:00Z"), minNoticeHours: 12 },
    );
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toContain("too soon");
  });
});

describe("groupSlotsByDay", () => {
  it("groups by the reader's own calendar day", () => {
    const slots = findSlots([panelist()], WINDOW, {
      durationMinutes: 60,
      now: new Date("2026-08-31T00:00:00Z"),
      maxSlots: 100,
    });
    const groups = groupSlotsByDay(slots, MANILA);
    expect(groups.map((g) => g.key)).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
    ]);
  });
});
