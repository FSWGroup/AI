/**
 * iCalendar (RFC 5545) generation.
 *
 * An .ics attachment works in every calendar application without an
 * integration, an OAuth consent screen, or a token to refresh. For a
 * candidate — who by definition has no account with us — it is the only
 * mechanism that can work at all.
 */

import type { CalendarEvent } from "./types";

/** RFC 5545 escaping: backslash, semicolon, comma, and newline. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Fold to 75 octets, per the spec.
 *
 * Octets, not characters: a line split in the middle of a multi-byte UTF-8
 * sequence produces a file some clients silently reject.
 */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Back off to a character boundary: continuation bytes are 10xxxxxx.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // continuation lines carry a leading space
  }
  return out.join("\r\n ");
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function buildIcs(
  event: CalendarEvent,
  opts: { productName?: string; method?: "REQUEST" | "CANCEL" } = {},
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${opts.productName ?? "FSW Talent Scout"}//EN`,
    "CALSCALE:GREGORIAN",
    `METHOD:${opts.method ?? "REQUEST"}`,
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(event.start)}`,
    `DTEND:${stamp(event.end)}`,
    `SUMMARY:${escapeText(event.title)}`,
    `SEQUENCE:${event.sequence ?? 0}`,
    `STATUS:${event.status ?? "CONFIRMED"}`,
  ];

  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.organizerEmail) {
    const cn = event.organizerName ? `;CN=${escapeText(event.organizerName)}` : "";
    lines.push(`ORGANIZER${cn}:mailto:${event.organizerEmail}`);
  }
  for (const a of event.attendees ?? []) {
    const cn = a.name ? `;CN=${escapeText(a.name)}` : "";
    lines.push(
      `ATTENDEE${cn};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`,
    );
  }

  lines.push("END:VEVENT", "END:VCALENDAR");
  // CRLF throughout, per the spec, and a trailing one.
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function icsFileName(title: string): string {
  const safe = title.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 60);
  return `${safe || "interview"}.ics`;
}
