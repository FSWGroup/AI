import { formatInTimeZone } from "date-fns-tz";

/**
 * Date formatting.
 *
 * Everything is stored in UTC and displayed in the viewer's timezone. No offset
 * is ever hard-coded — US Eastern and Asia/Manila both matter here, and both
 * change relative to each other twice a year.
 */

const FALLBACK_TIMEZONE = "America/New_York";

function tz(timezone: string | null | undefined): string {
  return timezone && timezone.length > 0 ? timezone : FALLBACK_TIMEZONE;
}

/** "28 Aug 2026" — unambiguous across US and international readers. */
export function formatShortDate(date: Date | string | null, timezone: string): string {
  if (!date) return "—";
  return formatInTimeZone(new Date(date), tz(timezone), "d MMM yyyy");
}

/** "28 Aug 2026, 2:30 PM" */
export function formatDateTime(date: Date | string | null, timezone: string): string {
  if (!date) return "—";
  return formatInTimeZone(new Date(date), tz(timezone), "d MMM yyyy, h:mm a");
}

/** "28 Aug 2026, 2:30 PM PHT" — for live sessions across timezones. */
export function formatDateTimeWithZone(date: Date | string | null, timezone: string): string {
  if (!date) return "—";
  return formatInTimeZone(new Date(date), tz(timezone), "d MMM yyyy, h:mm a zzz");
}

/** ISO date for form inputs and CSV export. */
export function formatIsoDate(date: Date | string | null, timezone: string): string {
  if (!date) return "";
  return formatInTimeZone(new Date(date), tz(timezone), "yyyy-MM-dd");
}

/**
 * A due date phrased the way a person thinks about it: "Due today",
 * "Overdue by 3 days", "Due in 5 days", then an absolute date further out.
 */
export function formatDueDate(
  date: Date | string | null,
  timezone: string,
  now: Date = new Date(),
): string {
  if (!date) return "No due date";

  const due = new Date(date);
  const zone = tz(timezone);

  // Compare calendar days in the viewer's timezone, not raw elapsed hours —
  // "tomorrow" means the next local date, not 24 hours from now.
  const dueDay = formatInTimeZone(due, zone, "yyyy-MM-dd");
  const nowDay = formatInTimeZone(now, zone, "yyyy-MM-dd");

  const dayDiff = Math.round(
    (Date.parse(`${dueDay}T00:00:00Z`) - Date.parse(`${nowDay}T00:00:00Z`)) /
      (24 * 60 * 60 * 1000),
  );

  if (dayDiff === 0) return "Due today";
  if (dayDiff === 1) return "Due tomorrow";
  if (dayDiff === -1) return "Overdue by 1 day";
  if (dayDiff < -1) return `Overdue by ${Math.abs(dayDiff)} days`;
  if (dayDiff <= 14) return `Due in ${dayDiff} days`;
  return `Due ${formatShortDate(due, zone)}`;
}

/** Relative phrasing for activity feeds: "2 hours ago", "3 days ago". */
export function formatRelative(date: Date | string | null, now: Date = new Date()): string {
  if (!date) return "—";

  const then = new Date(date).getTime();
  const seconds = Math.round((now.getTime() - then) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`;
  const years = Math.round(months / 12);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

/**
 * Add days to a date, preserving the time of day. Used for relative due dates
 * in learning paths ("due 30 days after start").
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** Add months, used for recertification intervals. */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const targetMonth = result.getUTCMonth() + months;
  result.setUTCMonth(targetMonth);
  // Guard the 31 Jan + 1 month case, which would otherwise roll into March.
  if (result.getUTCMonth() !== ((targetMonth % 12) + 12) % 12) {
    result.setUTCDate(0);
  }
  return result;
}

/** Whole days between two dates, rounded up. Negative when `to` is in the past. */
export function daysUntil(to: Date, from: Date = new Date()): number {
  return Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

/** True when the date has passed. */
export function isPast(date: Date | null, now: Date = new Date()): boolean {
  return Boolean(date && date.getTime() < now.getTime());
}

/**
 * Compute a due date from a person's training start and a relative offset.
 * Falls back to employment start, then to today, so a missing start date never
 * produces an assignment with no due date.
 */
export function computeRelativeDueDate(
  startDate: Date | null,
  employmentStart: Date | null,
  daysAfterStart: number,
  now: Date = new Date(),
): Date {
  const base = startDate ?? employmentStart ?? now;
  return addDays(base, daysAfterStart);
}
