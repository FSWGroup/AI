import "server-only";
import { InternalCalendar } from "./internal";
import type { CalendarProvider } from "./types";

export type { BusyInterval, CalendarEvent, CalendarProvider } from "./types";
export { buildIcs, icsFileName } from "./ics";

let provider: CalendarProvider | null = null;

/**
 * The calendar in use.
 *
 * Only the internal provider ships. `CALENDAR_PROVIDER` is read here so that
 * adding Google or Microsoft is a new file and one branch, not a rewrite of
 * the scheduling code — and so that an organization can see, from one place,
 * exactly what the platform is and is not able to see about their calendars.
 */
export function getCalendar(): CalendarProvider {
  if (!provider) provider = new InternalCalendar();
  return provider;
}
