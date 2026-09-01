/**
 * Duplicate candidate detection.
 *
 * The same person applies through Indeed on Monday and the careers page on
 * Thursday, with a different email and their name spelled differently. Left
 * alone, they become two candidates, get contacted twice by two recruiters,
 * and their assessment history is split in half.
 *
 * This proposes matches for a human to confirm. It does not merge anything on
 * its own: a wrong automatic merge fuses two real people's records together,
 * which is far harder to unpick than a missed duplicate.
 */

export interface CandidateIdentity {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
}

export type MatchStrength = "EXACT" | "STRONG" | "POSSIBLE";

export interface DuplicateMatch {
  candidateId: string;
  strength: MatchStrength;
  reasons: string[];
}

/** Lowercase, strip gmail-style dots and +tags, so aliases collapse together. */
export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;
  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  // Dot-insensitivity is a Google convention; applying it everywhere would
  // wrongly merge distinct addresses on hosts that treat dots as significant.
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
  }
  return `${local}@${domain}`;
}

/**
 * Reduce a phone number to comparable digits. Philippine mobile numbers are
 * written as 09171234567, +639171234567, and 63 917 123 4567 by the same
 * person on the same day, so compare the last nine digits.
 */
export function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-9);
}

/** Collapse case, accents, punctuation and extra spaces. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Levenshtein distance, capped — used only on short name strings. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * How many character differences to forgive at a given name length.
 *
 * Scaled per name part, not across the whole string. A whole-string budget
 * lets a long surname pay for a wrong given name: "Ana Cruz" and "Bea Cruz"
 * are two edits apart across eight characters, and they are almost certainly
 * two different people.
 */
function editBudget(length: number): number {
  if (length >= 8) return 2;
  if (length >= 5) return 1;
  return 0;
}

function partsClose(a: string, b: string): boolean {
  if (a === b) return true;
  if (a === "" || b === "") return false;
  return editDistance(a, b) <= editBudget(Math.min(a.length, b.length));
}

/**
 * Given names are compared more loosely than surnames: people shorten them
 * ("Rob" for "Robert"), and forms capture an initial where the résumé has the
 * full name. Surnames get no such latitude.
 */
function givenNamesClose(a: string, b: string): boolean {
  if (partsClose(a, b)) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 1 && long.startsWith(short);
}

function namesClose(a: CandidateIdentity, b: CandidateIdentity): boolean {
  const aFirst = normalizeName(a.firstName);
  const aLast = normalizeName(a.lastName);
  const bFirst = normalizeName(b.firstName);
  const bLast = normalizeName(b.lastName);
  // A surname mismatch is decisive; a given-name mismatch usually is too, but
  // shortenings and initials are common enough to allow for.
  return partsClose(aLast, bLast) && givenNamesClose(aFirst, bFirst);
}

/**
 * Find candidates that may be the same person as `incoming`.
 *
 * Strength is about what a recruiter should do with it:
 *  - EXACT     the same normalized email; safe to treat as the same person
 *  - STRONG    same phone and a close name, or same name and same phone
 *  - POSSIBLE  a close name alone; worth a look, usually not a duplicate
 */
export function findDuplicates(
  incoming: Omit<CandidateIdentity, "id">,
  existing: CandidateIdentity[],
): DuplicateMatch[] {
  const inEmail = normalizeEmail(incoming.email);
  const inPhone = normalizePhone(incoming.phone);
  const matches: DuplicateMatch[] = [];

  for (const c of existing) {
    const reasons: string[] = [];
    let strength: MatchStrength | null = null;

    const sameEmail = normalizeEmail(c.email) === inEmail;
    const cPhone = normalizePhone(c.phone);
    const samePhone = inPhone != null && cPhone != null && cPhone === inPhone;
    const closeName = namesClose({ ...incoming, id: "" }, c);

    if (sameEmail) {
      strength = "EXACT";
      reasons.push("Same email address");
      if (samePhone) reasons.push("Same phone number");
      if (closeName) reasons.push("Same name");
    } else if (samePhone && closeName) {
      strength = "STRONG";
      reasons.push("Same phone number", "Matching name");
    } else if (samePhone) {
      strength = "STRONG";
      reasons.push("Same phone number");
    } else if (closeName) {
      strength = "POSSIBLE";
      reasons.push("Similar name");
    }

    if (strength) matches.push({ candidateId: c.id, strength, reasons });
  }

  const rank: Record<MatchStrength, number> = { EXACT: 0, STRONG: 1, POSSIBLE: 2 };
  return matches.sort((a, b) => rank[a.strength] - rank[b.strength]);
}
