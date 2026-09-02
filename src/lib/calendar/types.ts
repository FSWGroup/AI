/**
 * The calendar seam.
 *
 * Modelled on the storage provider: one interface, an internal default that
 * works with no third-party account at all, and room to drop in Google or
 * Microsoft later without touching the scheduling logic.
 *
 * The internal default is not a stub. It reads busy time from this platform's
 * own interviews, which is the source that actually matters for
 * double-booking, and it hands out .ics files, which every calendar
 * application on earth understands. An organization that never connects a
 * calendar still gets working scheduling.
 */

export interface BusyInterval {
  start: Date;
  end: Date;
  /** For diagnostics; never shown to a candidate. */
  source: string;
}

export interface CalendarEvent {
  /** Stable id we generate, used as the ICS UID and for updates. */
  uid: string;
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  organizerEmail?: string;
  organizerName?: string;
  attendees?: { email: string; name?: string }[];
  /** Bumped on every change; calendars use it to supersede an older copy. */
  sequence?: number;
  status?: "CONFIRMED" | "CANCELLED";
}

export interface CalendarProvider {
  readonly kind: "internal" | "google" | "microsoft";
  /** True when this provider can see commitments outside this platform. */
  readonly readsExternalBusy: boolean;
  /**
   * Busy intervals for a user. The internal provider returns this platform's
   * own interviews; a connected provider returns the person's whole calendar.
   */
  getBusy(userId: string, from: Date, to: Date): Promise<BusyInterval[]>;
  /**
   * Write the event to the user's calendar. Returns a provider-side id, or
   * null when the provider does not maintain one (the internal case, where
   * the .ics file is the whole mechanism).
   */
  createEvent(userId: string, event: CalendarEvent): Promise<string | null>;
  updateEvent(userId: string, externalId: string, event: CalendarEvent): Promise<void>;
  cancelEvent(userId: string, externalId: string): Promise<void>;
}
