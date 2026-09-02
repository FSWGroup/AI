import { describe, expect, it } from "vitest";
import { buildIcs, icsFileName } from "@/lib/calendar/ics";

const BASE = {
  uid: "ws-123@fsw",
  title: "Interview — Inside Sales",
  start: new Date("2026-09-01T01:00:00Z"),
  end: new Date("2026-09-01T01:45:00Z"),
};

function lines(ics: string): string[] {
  return ics.split("\r\n");
}

describe("buildIcs", () => {
  it("produces a well-formed VEVENT", () => {
    const out = lines(buildIcs(BASE));
    expect(out[0]).toBe("BEGIN:VCALENDAR");
    expect(out).toContain("BEGIN:VEVENT");
    expect(out).toContain("UID:ws-123@fsw");
    expect(out).toContain("DTSTART:20260901T010000Z");
    expect(out).toContain("DTEND:20260901T014500Z");
    expect(out).toContain("END:VCALENDAR");
  });

  it("uses CRLF line endings throughout", () => {
    const ics = buildIcs(BASE);
    expect(ics.includes("\r\n")).toBe(true);
    // No bare LF anywhere: some clients reject the file outright.
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
    expect(ics.endsWith("\r\n")).toBe(true);
  });

  it("escapes the characters the spec reserves", () => {
    const ics = buildIcs({
      ...BASE,
      title: "Sales, ops; and a\\thing",
      description: "Line one\nLine two",
    });
    expect(ics).toContain("SUMMARY:Sales\\, ops\; and a\\\\thing");
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two");
  });

  it("folds long lines to 75 octets with a leading space", () => {
    const ics = buildIcs({ ...BASE, description: "x".repeat(300) });
    for (const line of lines(ics)) {
      expect(Buffer.from(line, "utf8").length).toBeLessThanOrEqual(75);
    }
    expect(ics).toContain("\r\n x");
  });

  it("never splits a multi-byte character across a fold", () => {
    // A line of emoji is the case that breaks a naive character-count fold.
    const ics = buildIcs({ ...BASE, description: "🙂".repeat(60) });
    for (const line of lines(ics)) {
      expect(Buffer.from(line, "utf8").length).toBeLessThanOrEqual(75);
    }
    // Round-trips: unfolding gives the description back intact.
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("🙂".repeat(60));
  });

  it("carries organizer and attendees", () => {
    const ics = buildIcs({
      ...BASE,
      organizerEmail: "hr@fsw.example",
      organizerName: "Harper Reyes",
      attendees: [{ email: "ana@example.com", name: "Ana Cruz" }],
    });
    expect(ics).toContain("ORGANIZER;CN=Harper Reyes:mailto:hr@fsw.example");
    expect(ics).toContain("ATTENDEE;CN=Ana Cruz;ROLE=REQ-PARTICIPANT");
  });

  it("cancels with METHOD and STATUS together", () => {
    // A cancellation needs both, and a higher SEQUENCE, or calendars keep
    // showing the old event.
    const ics = buildIcs(
      { ...BASE, status: "CANCELLED", sequence: 2 },
      { method: "CANCEL" },
    );
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SEQUENCE:2");
  });

  it("makes a safe filename", () => {
    expect(icsFileName("Interview — Inside Sales")).toBe("interview-inside-sales.ics");
    expect(icsFileName("")).toBe("interview.ics");
  });
});
