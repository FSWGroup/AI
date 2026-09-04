/**
 * Consent for the talent pool.
 *
 * A person who applied for one job did not thereby agree to sit in a
 * marketing database indefinitely. This module is the gate that everything
 * else in the CRM has to pass through, and it is deliberately the strictest
 * reading rather than the most convenient one:
 *
 *   Applying is not consent. A profile exists only once someone has been
 *   asked, and asking is itself recorded.
 *
 *   Silence is not consent. INVITED means "asked, no answer" and permits
 *   nothing except one reminder.
 *
 *   An opt-out is permanent and cannot be reversed from inside the
 *   organization. Only the person who opted out can come back, by applying
 *   again.
 *
 *   Consent expires. Someone who agreed to be kept in mind agreed to it for a
 *   period; the retention policy decides how long, and membership lapses
 *   without anyone having to remember.
 */

export type ConsentStatus = "NOT_ASKED" | "INVITED" | "OPTED_IN" | "OPTED_OUT";

export const CONSENT_LABEL: Record<ConsentStatus, string> = {
  NOT_ASKED: "Not asked",
  INVITED: "Asked, no answer yet",
  OPTED_IN: "Agreed to be kept in mind",
  OPTED_OUT: "Asked not to be contacted",
};

/** Badge colour for each status, wherever one is shown. */
export const CONSENT_TONE: Record<
  ConsentStatus,
  "green" | "amber" | "neutral" | "red"
> = {
  OPTED_IN: "green",
  INVITED: "amber",
  NOT_ASKED: "neutral",
  OPTED_OUT: "red",
};

/** The wording the candidate sees. Plain, and honest about what it means. */
export const CONSENT_STATEMENT = [
  "We would like to keep your details so we can get in touch if a role comes up that fits you better than the one you applied for.",
  "If you say yes: we keep your application, your interview notes and any assessment results, and a recruiter may contact you about relevant openings. You can change your mind at any time, and we will delete your details on request.",
  "If you say no: we will not contact you about future roles, and we will not ask you again. You can still apply to us whenever you like.",
  "Either way, your answer here has no effect on the application you already made.",
].join("\n\n");

/** How long a pool membership lasts before it lapses, absent a policy. */
export const DEFAULT_POOL_RETENTION_DAYS = 730;

/** Days after asking before the ask is treated as unanswered. */
export const CONSENT_REMINDER_DAYS = 14;
export const CONSENT_LAPSE_DAYS = 45;

export interface ProfileLike {
  consentStatus: ConsentStatus;
  consentAskedAt: Date | null;
  expiresAt: Date | null;
  lastContactedAt: Date | null;
  contactCount: number;
}

export type ContactGate = { ok: true } | { ok: false; reason: string };

/**
 * Minimum gap between approaches. Someone who agreed to hear about relevant
 * roles agreed to hear about relevant roles, not to be a mailing list.
 */
export const MIN_DAYS_BETWEEN_OUTREACH = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function canContact(
  profile: ProfileLike,
  suppressed: boolean,
  now: Date = new Date(),
): ContactGate {
  if (suppressed) {
    return {
      ok: false,
      reason:
        "This email address is on the do-not-contact list. That list survives the deletion of a candidate record on purpose, so an opt-out cannot be undone by re-importing someone.",
    };
  }
  switch (profile.consentStatus) {
    case "OPTED_OUT":
      return {
        ok: false,
        reason:
          "This person asked not to be contacted about future roles. That cannot be reversed from in here — only they can, by applying again.",
      };
    case "NOT_ASKED":
      return {
        ok: false,
        reason:
          "This person has not been asked whether they want to hear about future roles. Applying for one job is not agreement to be kept on file.",
      };
    case "INVITED":
      return {
        ok: false,
        reason:
          "We have asked and not heard back. Silence is not agreement — wait for an answer.",
      };
    case "OPTED_IN":
      break;
  }

  if (profile.expiresAt && profile.expiresAt < now) {
    return {
      ok: false,
      reason:
        "Their agreement has lapsed under the retention policy. Ask again before contacting them.",
    };
  }
  if (profile.lastContactedAt) {
    const daysSince = (now.getTime() - profile.lastContactedAt.getTime()) / DAY_MS;
    if (daysSince < MIN_DAYS_BETWEEN_OUTREACH) {
      return {
        ok: false,
        reason: `Contacted ${Math.floor(daysSince)} days ago. Approaches are limited to one every ${MIN_DAYS_BETWEEN_OUTREACH} days — someone who agreed to hear about relevant roles did not agree to be a mailing list.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Whether a person may be searched for and shown in the CRM at all.
 *
 * Two conditions, because they come from different places: the profile's own
 * consent status, and the suppression list, which is keyed on a hash of the
 * email address and so outlives deletion of the profile row. A profile
 * recreated for a suppressed address passes the first and must still fail.
 */
export function canAppearInSearch(profile: ProfileLike, suppressed: boolean): boolean {
  if (suppressed) return false;
  return profile.consentStatus !== "OPTED_OUT";
}

/** Whether an outstanding ask should be chased, dropped, or left alone. */
export type AskState = "FRESH" | "REMIND" | "LAPSED";

export function askState(
  profile: ProfileLike,
  now: Date = new Date(),
): AskState | null {
  if (profile.consentStatus !== "INVITED" || !profile.consentAskedAt) return null;
  const days = (now.getTime() - profile.consentAskedAt.getTime()) / DAY_MS;
  if (days >= CONSENT_LAPSE_DAYS) return "LAPSED";
  if (days >= CONSENT_REMINDER_DAYS) return "REMIND";
  return "FRESH";
}

export function poolExpiryFrom(
  consentAt: Date,
  retentionDays: number | null,
): Date {
  const days = retentionDays ?? DEFAULT_POOL_RETENTION_DAYS;
  return new Date(consentAt.getTime() + days * DAY_MS);
}
