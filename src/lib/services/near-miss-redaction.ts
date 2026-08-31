/**
 * Blameless-write-up checks for the near-miss library.
 *
 * A near-miss library only works if people believe filing one cannot be turned
 * against them or a colleague. Believing that is not a policy statement, it is
 * something the software has to make structurally hard to get wrong — so before
 * a report can be published, its narrative is scanned for two things:
 *
 *  1. **Identifying detail.** A colleague's name, an email address, an employee
 *    number. These block publication. The reviewer has to rewrite the sentence
 *    in terms of the role ("the quoting engineer") rather than the person.
 *  2. **Blame language.** "Careless", "his fault", "should have known". These
 *    warn rather than block: sometimes the phrase is quoting a customer, and a
 *    reviewer who is told why can decide. A warning that cannot be overridden
 *    just teaches people to route around the tool.
 *
 * Deliberately free of Prisma, session and clock so the rules can be tested
 * exhaustively without a database (same pattern as criteria.ts and grading.ts).
 * The caller supplies the directory; this file never queries one.
 */

export type IdentifierKind =
  | "EMAIL"
  | "FULL_NAME"
  | "EMPLOYEE_ID"
  | "PHONE"
  | "FIRST_NAME"
  | "BLAME";

export interface IdentifierFinding {
  kind: IdentifierKind;
  /** The text that triggered it, as written. */
  match: string;
  /** Label of the field it was found in, for a message a reviewer can act on. */
  field: string;
  /** True when publication must be refused until it is resolved. */
  blocking: boolean;
  /** What the reviewer should do about it. */
  advice: string;
}

/** A directory entry to check the narrative against. */
export interface DirectoryPerson {
  name: string;
  email?: string | null;
  employeeId?: string | null;
}

/** A named piece of narrative to scan. */
export interface NarrativeField {
  field: string;
  text: string | null | undefined;
}

/*
 * Blame markers. Each is matched case-insensitively on word boundaries. The
 * list is intentionally about attribution of character or fault, not about
 * strong language: "the pressure rating was wrong" is a finding, "he was
 * careless" is blame, and only the second belongs here.
 */
const BLAME_PATTERNS: { pattern: RegExp; advice: string }[] = [
  {
    pattern: /\b(his|her|their|your|my)\s+fault\b/gi,
    advice: "Describe the condition that allowed it, not whose fault it was.",
  },
  {
    pattern: /\bat\s+fault\b/gi,
    advice: "Describe the condition that allowed it, not who was at fault.",
  },
  {
    pattern: /\bto\s+blame\b/gi,
    advice: "A published near miss assigns causes, not blame.",
  },
  {
    pattern: /\b(careless|carelessly|sloppy|lazy|incompetent|stupid|idiotic|negligent|negligence)\b/gi,
    advice: "Replace the judgment with what actually happened at that step.",
  },
  {
    pattern: /\bshould\s+have\s+(known|noticed|checked|realised|realized|caught)\b/gi,
    advice:
      "“Should have known” hides the real finding: say why the information was not available at the time.",
  },
  {
    pattern: /\b(didn't|did\s+not|couldn't|could\s+not)\s+bother\b/gi,
    advice: "Say what made the correct step easy to skip instead.",
  },
  {
    pattern: /\bfailed\s+to\s+(care|pay\s+attention)\b/gi,
    advice: "Attention is a symptom, not a cause. Describe the condition.",
  },
  {
    pattern: /\bdeliberately\s+(ignored|skipped|bypassed)\b/gi,
    advice:
      "If a step is routinely bypassed, the finding is usually that the step is impractical — say so.",
  },
];

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/*
 * Phone numbers, in two tiers.
 *
 * Anything punctuated or internationally prefixed is unambiguous and blocks
 * publication. A bare ten-digit run only warns: in this business a long digit
 * string is at least as likely to be a part number or an order reference, and
 * blocking publication over one would teach reviewers to distrust the check.
 *
 * Both are fenced with lookarounds so a candidate can never be found inside a
 * longer digit run — without that, any 13-digit identifier contains a
 * "phone number".
 */
const PHONE_PUNCTUATED =
  /(?<![\d-])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]?\d{4}(?![\d-])/g;
const PHONE_INTERNATIONAL = /(?<![\d-])\+\d[\d\s.()-]{7,}\d(?![\d-])/g;
const PHONE_BARE = /(?<![\d-])\d{10}(?![\d-])/g;

/**
 * First names common enough as ordinary English words that flagging them as a
 * possible person would be noise rather than signal. Kept short on purpose: a
 * first-name hit is only a warning, so the cost of a miss here is low.
 */
const AMBIGUOUS_FIRST_NAMES = new Set([
  "bill",
  "will",
  "mark",
  "may",
  "june",
  "art",
  "chase",
  "grant",
  "hope",
  "rich",
  "van",
  "drew",
  "case",
  "sunny",
  "penny",
  "faith",
]);

/** Normalize a word for comparison: lowercase, strip possessives and accents. */
function normalizeWord(word: string): string {
  return word
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2019]s$/, "")
    .replace(/[^a-z-]/g, "");
}

/** Split text into comparable word tokens, preserving the original spelling. */
function tokenize(text: string): { raw: string; norm: string }[] {
  const tokens: { raw: string; norm: string }[] = [];
  for (const match of text.matchAll(/[A-Za-z\u00c0-\u024f][A-Za-z\u00c0-\u024f'\u2019-]*/g)) {
    const raw = match[0];
    const norm = normalizeWord(raw);
    if (norm.length > 0) tokens.push({ raw, norm });
  }
  return tokens;
}

/** Name parts of a directory entry, normalized; empty when unusable. */
function nameParts(name: string): { first: string; last: string; raw: string } | null {
  const parts = name
    .split(/\s+/)
    .map((part) => normalizeWord(part))
    .filter((part) => part.length > 0);
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  if (!first || !last) return null;
  return { first, last, raw: name.trim() };
}

function dedupe(findings: IdentifierFinding[]): IdentifierFinding[] {
  const seen = new Set<string>();
  const out: IdentifierFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.kind}|${finding.field}|${finding.match.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}

/**
 * Scan narrative fields for identifying detail and blame language.
 *
 * Findings are returned in severity order: blocking first, then warnings, each
 * group in the order the fields were supplied so a reviewer reads them in the
 * order the form presents them.
 */
export function findIdentifiers(
  fields: NarrativeField[],
  directory: DirectoryPerson[],
): IdentifierFinding[] {
  const people = directory
    .map((person) => ({ ...person, parts: nameParts(person.name) }))
    .filter((person): person is typeof person & { parts: NonNullable<typeof person.parts> } =>
      person.parts !== null,
    );

  const emails = new Set(
    directory
      .map((person) => person.email?.trim().toLowerCase())
      .filter((email): email is string => Boolean(email)),
  );
  const employeeIds = new Set(
    directory
      .map((person) => person.employeeId?.trim().toLowerCase())
      .filter((id): id is string => typeof id === "string" && id.length >= 3),
  );

  /*
   * First names worth warning about, computed once: long enough not to be an
   * initial, and not a word that reads naturally as ordinary English.
   */
  const firstNames = new Set(
    people
      .map((person) => person.parts.first)
      .filter((first) => first.length >= 3 && !AMBIGUOUS_FIRST_NAMES.has(first)),
  );

  const findings: IdentifierFinding[] = [];

  for (const { field, text } of fields) {
    if (!text) continue;
    const trimmed = text.trim();
    if (trimmed.length === 0) continue;

    // 1. Any email address, whether or not it is one of ours. A supplier
    //    contact is as identifying as a colleague.
    for (const match of trimmed.matchAll(EMAIL_PATTERN)) {
      const value = match[0];
      findings.push({
        kind: "EMAIL",
        match: value,
        field,
        blocking: true,
        advice: emails.has(value.toLowerCase())
          ? "Remove the address and describe the role instead."
          : "Remove the address — an external contact is identifying too.",
      });
    }

    // 2. Phone numbers, blocking when unambiguous and warning when not.
    for (const pattern of [PHONE_PUNCTUATED, PHONE_INTERNATIONAL]) {
      for (const match of trimmed.matchAll(pattern)) {
        findings.push({
          kind: "PHONE",
          match: match[0].trim(),
          field,
          blocking: true,
          advice: "Remove the number. It is never part of the lesson.",
        });
      }
    }
    for (const match of trimmed.matchAll(PHONE_BARE)) {
      findings.push({
        kind: "PHONE",
        match: match[0],
        field,
        blocking: false,
        advice:
          "Ten digits together. If it is a phone number, remove it; if it is a part or order number, leave it.",
      });
    }

    const tokens = tokenize(trimmed);

    // 3. Employee identifiers, matched as whole tokens so "12" never matches
    //    inside "120 psi".
    if (employeeIds.size > 0) {
      for (const token of tokens) {
        if (employeeIds.has(token.norm)) {
          findings.push({
            kind: "EMPLOYEE_ID",
            match: token.raw,
            field,
            blocking: true,
            advice: "Remove the employee number.",
          });
        }
      }
      /*
       * Employee references usually carry digits and often a hyphen
       * ("FSW-1042"), neither of which survives `tokenize`. Scan the raw text
       * for alphanumeric references and compare whole candidates, so "1042"
       * inside "1042 psi" can never match "FSW-1042".
       */
      for (const match of trimmed.matchAll(/[A-Za-z0-9][A-Za-z0-9-]*/g)) {
        const candidate = match[0].replace(/^-+|-+$/g, "");
        if (candidate.length >= 3 && employeeIds.has(candidate.toLowerCase())) {
          findings.push({
            kind: "EMPLOYEE_ID",
            match: candidate,
            field,
            blocking: true,
            advice: "Remove the employee number.",
          });
        }
      }
    }

    /*
     * 4. A colleague's full name: first and last adjacent, optionally with a
     *    middle name or initial between them. Every occurrence is scanned, not
     *    just the first, so its tokens are marked consumed and rule 5 below
     *    cannot warn about the same words a second time.
     */
    const consumed = new Set<number>();
    for (const person of people) {
      const { first, last } = person.parts;
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i]?.norm !== first) continue;
        const next = tokens[i + 1]?.norm;
        const afterNext = tokens[i + 2]?.norm;
        const adjacent = next === last;
        const withMiddle = next !== undefined && next !== last && afterNext === last;
        if (!adjacent && !withMiddle) continue;
        const length = adjacent ? 2 : 3;
        const span = tokens
          .slice(i, i + length)
          .map((token) => token.raw)
          .join(" ");
        for (let offset = 0; offset < length; offset++) consumed.add(i + offset);
        findings.push({
          kind: "FULL_NAME",
          match: span,
          field,
          blocking: true,
          advice: "Name the role, not the person — e.g. “the quoting engineer”.",
        });
      }
    }

    // 5. A first name on its own. Only a warning: it may be a coincidence, and
    //    a reviewer reading the sentence can tell instantly.
    for (const [index, token] of tokens.entries()) {
      if (consumed.has(index)) continue;
      if (!firstNames.has(token.norm)) continue;
      findings.push({
        kind: "FIRST_NAME",
        match: token.raw,
        field,
        blocking: false,
        advice:
          "This matches a colleague's first name. If it refers to a person, replace it with their role.",
      });
    }

    // 6. Blame language.
    for (const { pattern, advice } of BLAME_PATTERNS) {
      for (const match of trimmed.matchAll(pattern)) {
        findings.push({ kind: "BLAME", match: match[0], field, blocking: false, advice });
      }
    }
  }

  const unique = dedupe(findings);
  return [...unique.filter((f) => f.blocking), ...unique.filter((f) => !f.blocking)];
}

/** True when at least one finding must be resolved before publication. */
export function hasBlockingIdentifiers(findings: IdentifierFinding[]): boolean {
  return findings.some((finding) => finding.blocking);
}

/** One-line summary for an error message or an audit entry. */
export function summarizeBlocking(findings: IdentifierFinding[]): string {
  const blocking = findings.filter((finding) => finding.blocking);
  if (blocking.length === 0) return "";
  const kinds = new Map<IdentifierKind, number>();
  for (const finding of blocking) kinds.set(finding.kind, (kinds.get(finding.kind) ?? 0) + 1);
  const label: Record<IdentifierKind, string> = {
    EMAIL: "email address",
    FULL_NAME: "person's name",
    EMPLOYEE_ID: "employee number",
    PHONE: "phone number",
    FIRST_NAME: "first name",
    BLAME: "blame language",
  };
  return [...kinds.entries()]
    .map(([kind, count]) => `${count} ${label[kind]}${count === 1 ? "" : "s"}`)
    .join(", ");
}
