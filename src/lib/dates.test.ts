import { describe, it, expect } from "vitest";
import {
  addDays,
  addMonths,
  computeRelativeDueDate,
  daysUntil,
  formatDueDate,
  formatIsoDate,
  formatRelative,
  formatShortDate,
  isPast,
} from "@/lib/dates";

describe("timezone-aware formatting", () => {
  const instant = new Date("2026-08-28T02:30:00Z");

  it("renders the same instant as different local dates", () => {
    // 02:30 UTC is the previous evening in New York and mid-morning in Manila.
    expect(formatShortDate(instant, "America/New_York")).toBe("27 Aug 2026");
    expect(formatShortDate(instant, "Asia/Manila")).toBe("28 Aug 2026");
  });

  it("falls back to Eastern when no timezone is given", () => {
    expect(formatShortDate(instant, "")).toBe("27 Aug 2026");
  });

  it("formats ISO dates in the viewer's timezone", () => {
    expect(formatIsoDate(instant, "America/New_York")).toBe("2026-08-27");
    expect(formatIsoDate(instant, "Asia/Manila")).toBe("2026-08-28");
  });

  it("returns an em dash for a missing date", () => {
    expect(formatShortDate(null, "America/New_York")).toBe("—");
  });
});

describe("formatDueDate", () => {
  const now = new Date("2026-08-28T15:00:00Z");
  const zone = "America/New_York"; // 11:00 local

  it("says today for a due date on the same local day", () => {
    expect(formatDueDate(new Date("2026-08-28T20:00:00Z"), zone, now)).toBe("Due today");
  });

  it("says tomorrow for the next local day", () => {
    expect(formatDueDate(new Date("2026-08-29T14:00:00Z"), zone, now)).toBe("Due tomorrow");
  });

  it("counts local calendar days, not UTC calendar days", () => {
    // 02:00 UTC on the 31st is 22:00 on the 30th in New York: three UTC days
    // ahead of the 28th, but only two local days ahead.
    expect(formatDueDate(new Date("2026-08-31T02:00:00Z"), zone, now)).toBe("Due in 2 days");
  });

  it("stays on today for a UTC timestamp that is still today locally", () => {
    // 02:00 UTC on the 29th is 22:00 on the 28th in New York — a due date that
    // looks like tomorrow in UTC but is genuinely still today for the learner.
    expect(formatDueDate(new Date("2026-08-29T02:00:00Z"), zone, now)).toBe("Due today");
  });

  it("phrases overdue in days past", () => {
    expect(formatDueDate(new Date("2026-08-27T14:00:00Z"), zone, now)).toBe("Overdue by 1 day");
    expect(formatDueDate(new Date("2026-08-25T14:00:00Z"), zone, now)).toBe("Overdue by 3 days");
  });

  it("switches to an absolute date beyond two weeks", () => {
    expect(formatDueDate(new Date("2026-10-01T14:00:00Z"), zone, now)).toBe("Due 1 Oct 2026");
  });

  it("handles a missing due date", () => {
    expect(formatDueDate(null, zone, now)).toBe("No due date");
  });

  it("resolves the same instant differently across timezones near midnight", () => {
    // 03:00 UTC on the 29th is still the 28th in New York but the 29th in Manila.
    const due = new Date("2026-08-29T03:00:00Z");
    const reference = new Date("2026-08-28T15:00:00Z");
    expect(formatDueDate(due, "America/New_York", reference)).toBe("Due today");
    expect(formatDueDate(due, "Asia/Manila", reference)).toBe("Due tomorrow");
  });
});

describe("date arithmetic", () => {
  it("adds days", () => {
    expect(addDays(new Date("2026-08-28T12:00:00Z"), 7).toISOString()).toBe(
      "2026-09-04T12:00:00.000Z",
    );
  });

  it("adds days across a month boundary", () => {
    expect(addDays(new Date("2026-08-28T12:00:00Z"), 5).toISOString()).toBe(
      "2026-09-02T12:00:00.000Z",
    );
  });

  it("adds months for recertification intervals", () => {
    expect(addMonths(new Date("2026-08-28T12:00:00Z"), 12).toISOString()).toBe(
      "2027-08-28T12:00:00.000Z",
    );
    expect(addMonths(new Date("2026-08-28T12:00:00Z"), 6).toISOString()).toBe(
      "2027-02-28T12:00:00.000Z",
    );
  });

  it("clamps a month addition that would overflow the target month", () => {
    // 31 Jan + 1 month must be 28 Feb, not 3 March.
    const result = addMonths(new Date("2026-01-31T12:00:00Z"), 1);
    expect(result.getUTCMonth()).toBe(1); // February
    expect(result.getUTCDate()).toBe(28);
  });

  it("computes whole days until a date", () => {
    const from = new Date("2026-08-28T12:00:00Z");
    expect(daysUntil(new Date("2026-09-04T12:00:00Z"), from)).toBe(7);
    expect(daysUntil(new Date("2026-08-27T12:00:00Z"), from)).toBe(-1);
  });

  it("detects a past date", () => {
    const now = new Date("2026-08-28T12:00:00Z");
    expect(isPast(new Date("2026-08-27T12:00:00Z"), now)).toBe(true);
    expect(isPast(new Date("2026-08-29T12:00:00Z"), now)).toBe(false);
    expect(isPast(null, now)).toBe(false);
  });
});

describe("computeRelativeDueDate", () => {
  const now = new Date("2026-08-28T12:00:00Z");

  it("uses the training start date when present", () => {
    const result = computeRelativeDueDate(
      new Date("2026-08-01T12:00:00Z"),
      new Date("2026-07-01T12:00:00Z"),
      30,
      now,
    );
    expect(result.toISOString()).toBe("2026-08-31T12:00:00.000Z");
  });

  it("falls back to the employment start date", () => {
    const result = computeRelativeDueDate(null, new Date("2026-08-01T12:00:00Z"), 7, now);
    expect(result.toISOString()).toBe("2026-08-08T12:00:00.000Z");
  });

  it("falls back to today so an assignment always gets a due date", () => {
    const result = computeRelativeDueDate(null, null, 14, now);
    expect(result.toISOString()).toBe("2026-09-11T12:00:00.000Z");
  });

  it("treats day 1 as the day after the start", () => {
    const result = computeRelativeDueDate(new Date("2026-08-28T09:00:00Z"), null, 1, now);
    expect(result.toISOString()).toBe("2026-08-29T09:00:00.000Z");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-08-28T12:00:00Z");

  it("describes recent times", () => {
    expect(formatRelative(new Date("2026-08-28T11:59:30Z"), now)).toBe("just now");
    expect(formatRelative(new Date("2026-08-28T11:45:00Z"), now)).toBe("15 minutes ago");
    expect(formatRelative(new Date("2026-08-28T09:00:00Z"), now)).toBe("3 hours ago");
  });

  it("describes days, months, and years", () => {
    expect(formatRelative(new Date("2026-08-25T12:00:00Z"), now)).toBe("3 days ago");
    expect(formatRelative(new Date("2026-06-28T12:00:00Z"), now)).toBe("2 months ago");
    expect(formatRelative(new Date("2024-08-28T12:00:00Z"), now)).toBe("2 years ago");
  });

  it("uses the singular form for one unit", () => {
    expect(formatRelative(new Date("2026-08-28T11:00:00Z"), now)).toBe("1 hour ago");
    expect(formatRelative(new Date("2026-08-27T12:00:00Z"), now)).toBe("1 day ago");
  });
});
