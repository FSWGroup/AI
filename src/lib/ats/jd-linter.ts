/**
 * Job description linter.
 *
 * Runs on requisition copy before it is published. It works at the widest part
 * of the funnel, which is where a fix compounds: a requirement that quietly
 * removes a third of qualified applicants costs more than any downstream
 * screening decision, and nobody ever sees the people it removed.
 *
 * Every finding is advisory. The linter explains what it noticed and why it
 * matters, and a recruiter overrides it by ignoring it — nothing is blocked,
 * because a rule confident enough to block would be wrong often enough to
 * damage postings it does not understand.
 */

export type FindingSeverity = "HIGH" | "MEDIUM" | "LOW";

export type FindingKind =
  | "CODED_LANGUAGE"
  | "GENDERED_TERM"
  | "INFLATED_REQUIREMENT"
  | "AGE_SIGNAL"
  | "EXCLUSIONARY_PHRASING"
  | "READING_LEVEL"
  | "LENGTH"
  | "PAY_TRANSPARENCY"
  | "MISSING_SECTION"
  | "JARGON";

export interface LintFinding {
  kind: FindingKind;
  severity: FindingSeverity;
  /** Which field the finding is about. */
  field: string;
  /** The exact text that triggered it, where there is one. */
  match?: string;
  message: string;
  /** What to write instead. */
  suggestion?: string;
}

export interface LintInput {
  title: string;
  summary?: string | null;
  description?: string | null;
  responsibilities?: string | null;
  requirements?: string | null;
  benefits?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryPublish: boolean;
  /** Where the role is based; pay-transparency duties are jurisdictional. */
  locationRegion?: string | null;
  locationCountry?: string;
}

export interface LintResult {
  findings: LintFinding[];
  /** 0-100. A rough health indicator, not a grade to optimize. */
  score: number;
  wordCount: number;
  readingGrade: number | null;
  counts: Record<FindingSeverity, number>;
}

/**
 * Masculine-coded and feminine-coded terms.
 *
 * Based on the Gaucher, Friesen & Kay (2011) finding that masculine-coded
 * wording in adverts reduces job appeal to women without changing perceived
 * competence. The effect is small per word and cumulative across a posting,
 * which is why these are reported as a count rather than individually alarming.
 */
const MASCULINE_CODED = [
  "aggressive", "ambitious", "assertive", "autonomous", "battle", "boast",
  "challenging", "competitive", "confident", "courageous", "decisive",
  "determined", "dominant", "driven", "fearless", "fight", "force", "greedy",
  "headstrong", "hierarchical", "hostile", "impulsive", "independent",
  "individualistic", "intellectual", "lead", "logic", "objective",
  "opinionated", "outspoken", "persist", "principle", "reckless", "self-reliant",
  "self-sufficient", "stubborn", "superior", "unreasonable", "ninja", "rockstar",
  "guru", "warrior", "hacker", "crush it", "dominate",
];

const FEMININE_CODED = [
  "affectionate", "collaborate", "commit", "communal", "compassion",
  "connect", "considerate", "cooperat", "depend", "emotional", "empath",
  "feel", "gentle", "honest", "interpersonal", "kind", "loyal", "nurtur",
  "pleasant", "polite", "quiet", "responsive", "sensitive", "submissive",
  "support", "sympath", "tender", "together", "trust", "understand", "warm",
  "yield",
];

/** Terms that read as an age preference whether or not one is intended. */
const AGE_SIGNALS = [
  "young", "youthful", "recent graduate", "recent grad", "new grad",
  "digital native", "energetic", "fresh", "mature", "seasoned veteran",
  "high-energy", "vibrant",
];

/** Phrasings that exclude people who could do the job. */
const EXCLUSIONARY: { pattern: RegExp; message: string; suggestion: string }[] = [
  {
    pattern: /\bmust be able to (?:lift|stand|walk|climb)\b/i,
    message:
      "A physical requirement stated without a reason reads as a barrier. Under the ADA and equivalents, requirements should map to essential functions.",
    suggestion:
      "Tie it to the task: \"moves stock between the floor and storage, up to 20kg\" — and say whether accommodations are available.",
  },
  {
    pattern: /\b(?:he|she|his|her)\b/i,
    message: "Gendered pronouns for a hypothetical holder of the role.",
    suggestion: "Use \"you\" or \"they\".",
  },
  {
    pattern: /\bnative (?:english|speaker)\b/i,
    message:
      "\"Native speaker\" is a national-origin proxy and is unlawful as a requirement in several jurisdictions.",
    suggestion: "State the actual standard: \"writes clearly for customers in English\".",
  },
  {
    pattern: /\bculture fit\b/i,
    message:
      "\"Culture fit\" is where unexamined similarity preference lives. It reliably filters for people like the existing team.",
    suggestion: "Name the behaviour you want: \"gives direct feedback\", \"works well without close supervision\".",
  },
  {
    pattern: /\bwork hard,? play hard\b/i,
    message:
      "Reads as an expectation of long hours and after-work socializing, which filters on caring responsibilities and on people who do not drink.",
    suggestion: "Describe the pace of the work directly.",
  },
  {
    pattern: /\brock ?star|ninja|guru|wizard\b/i,
    message: "Novelty job language narrows the applicant pool and dates quickly.",
    suggestion: "Say what the person will do.",
  },
];

/** Requirements that shrink the pool without predicting performance. */
const INFLATED: { pattern: RegExp; message: string; suggestion: string }[] = [
  {
    pattern: /\b(?:bachelor'?s?|master'?s?|degree|university degree)\b(?![^.]{0,60}\b(?:or equivalent|preferred|nice to have|desirable)\b)/i,
    message:
      "A degree stated as a hard requirement. Unless the work genuinely needs it, it removes capable applicants and has a documented disparate impact.",
    suggestion:
      "Write \"degree or equivalent practical experience\", or drop it and state the skill the degree was standing in for.",
  },
  {
    pattern: /\b(1[0-9]|[7-9])\+?\s*years?\b/i,
    message:
      "A long experience requirement. Beyond a few years, additional experience has little relationship to performance, and long minimums screen out career changers and returners.",
    suggestion: "State the capability instead of the tenure, or lower the number.",
  },
  {
    pattern: /\bexpert(?:-level)?\b/i,
    message: "\"Expert\" discourages qualified applicants who self-assess conservatively.",
    suggestion: "Describe what they should be able to do unaided.",
  },
  {
    pattern: /\bfluent in\b[^.]{0,80}\band\b[^.]{0,80}\band\b/i,
    message: "A stacked list of required tools. Each one multiplies out applicants.",
    suggestion: "Split into must-have and nice-to-have.",
  },
];

const JARGON = [
  "synergy", "leverage", "paradigm", "value-add", "low-hanging fruit",
  "move the needle", "boil the ocean", "circle back", "blue sky",
  "best-in-class", "world-class", "hit the ground running", "wear many hats",
];

/** US states and other jurisdictions with pay-range posting duties. */
const PAY_TRANSPARENCY_REGIONS = new Set([
  "CA", "CO", "CT", "HI", "IL", "MD", "MN", "NV", "NY", "RI", "WA", "DC", "NJ", "VT", "MA",
]);

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const groups = w
    .replace(/(?:es|ed|[^laeiouy]e)$/, "")
    .match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

/**
 * Flesch–Kincaid grade level. Approximate by design: it is used to say
 * "this reads like a legal document" rather than to report a precise number.
 */
export function readingGrade(text: string): number | null {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (sentences.length === 0 || words.length < 20) return null;
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  const grade =
    0.39 * (words.length / sentences.length) +
    11.8 * (syllables / words.length) -
    15.59;
  return Math.round(grade * 10) / 10;
}

function findAll(
  text: string,
  terms: string[],
): { term: string; index: number }[] {
  const hits: { term: string; index: number }[] = [];
  for (const term of terms) {
    // Word-boundary match, tolerating stem forms like "collaborat(e|ion)".
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      hits.push({ term: m[0], index: m.index });
      if (re.lastIndex === m.index) re.lastIndex++;
    }
  }
  return hits;
}

const SEVERITY_COST: Record<FindingSeverity, number> = {
  HIGH: 12,
  MEDIUM: 5,
  LOW: 2,
};

export function lintJobDescription(input: LintInput): LintResult {
  const findings: LintFinding[] = [];

  const fields: [string, string][] = [
    ["title", input.title ?? ""],
    ["summary", input.summary ?? ""],
    ["description", input.description ?? ""],
    ["responsibilities", input.responsibilities ?? ""],
    ["requirements", input.requirements ?? ""],
    ["benefits", input.benefits ?? ""],
  ];
  const body = fields.map(([, v]) => v).join("\n\n");
  const wordCount = body.split(/\s+/).filter(Boolean).length;

  // ---- Coded language, counted rather than listed one by one -------------
  const masculine = findAll(body, MASCULINE_CODED);
  const feminine = findAll(body, FEMININE_CODED);
  const skew = masculine.length - feminine.length;
  if (masculine.length >= 3 && skew >= 3) {
    findings.push({
      kind: "CODED_LANGUAGE",
      severity: skew >= 6 ? "MEDIUM" : "LOW",
      field: "description",
      match: [...new Set(masculine.map((m) => m.term.toLowerCase()))].slice(0, 8).join(", "),
      message: `${masculine.length} masculine-coded words against ${feminine.length} feminine-coded. Wording skewed this way measurably reduces how appealing a role looks to women without changing how competent it looks.`,
      suggestion:
        "Balance it rather than purging words: pair achievement language with collaborative language.",
    });
  }
  if (feminine.length >= 3 && -skew >= 6) {
    findings.push({
      kind: "CODED_LANGUAGE",
      severity: "LOW",
      field: "description",
      match: [...new Set(feminine.map((m) => m.term.toLowerCase()))].slice(0, 8).join(", "),
      message: `${feminine.length} feminine-coded words against ${masculine.length} masculine-coded. The same effect runs in both directions.`,
      suggestion: "Balance it rather than purging words.",
    });
  }

  // ---- Per-field pattern checks ------------------------------------------
  for (const [field, text] of fields) {
    if (!text.trim()) continue;

    for (const rule of EXCLUSIONARY) {
      const m = rule.pattern.exec(text);
      if (m) {
        findings.push({
          kind: "EXCLUSIONARY_PHRASING",
          severity: "HIGH",
          field,
          match: m[0],
          message: rule.message,
          suggestion: rule.suggestion,
        });
      }
    }

    for (const hit of findAll(text, AGE_SIGNALS)) {
      findings.push({
        kind: "AGE_SIGNAL",
        severity: "HIGH",
        field,
        match: hit.term,
        message:
          "Reads as an age preference. Age is a protected characteristic, and terms like this are cited in age-discrimination claims whether or not one was intended.",
        suggestion: "Describe the pace or the skill instead.",
      });
      break;
    }

    for (const hit of findAll(text, JARGON)) {
      findings.push({
        kind: "JARGON",
        severity: "LOW",
        field,
        match: hit.term,
        message: "Business jargon. It tells an applicant nothing about the work.",
        suggestion: "Say the thing plainly.",
      });
      break;
    }
  }

  // Inflated requirements only make sense in the requirements section.
  const requirements = input.requirements ?? "";
  for (const rule of INFLATED) {
    const m = rule.pattern.exec(requirements);
    if (m) {
      findings.push({
        kind: "INFLATED_REQUIREMENT",
        severity: "MEDIUM",
        field: "requirements",
        match: m[0],
        message: rule.message,
        suggestion: rule.suggestion,
      });
    }
  }

  const requirementLines = requirements
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (requirementLines.length > 10) {
    findings.push({
      kind: "INFLATED_REQUIREMENT",
      severity: "MEDIUM",
      field: "requirements",
      message: `${requirementLines.length} separate requirements. Long lists deter applicants who meet most of them — an effect that falls hardest on people who self-assess conservatively.`,
      suggestion: "Cut to the five or six that genuinely decide whether someone can do the job.",
    });
  }

  // ---- Structure ----------------------------------------------------------
  if (!input.responsibilities?.trim()) {
    findings.push({
      kind: "MISSING_SECTION",
      severity: "MEDIUM",
      field: "responsibilities",
      message: "No responsibilities section. Applicants cannot tell what the job involves day to day.",
      suggestion: "List four to six things the person will actually do.",
    });
  }
  if (!input.benefits?.trim()) {
    findings.push({
      kind: "MISSING_SECTION",
      severity: "LOW",
      field: "benefits",
      message: "No benefits section.",
      suggestion: "Even a short list improves response rates.",
    });
  }

  // ---- Pay transparency ---------------------------------------------------
  const region = (input.locationRegion ?? "").toUpperCase();
  const mandated =
    input.locationCountry === "US" && PAY_TRANSPARENCY_REGIONS.has(region);
  if (!input.salaryPublish || input.salaryMin == null) {
    findings.push({
      kind: "PAY_TRANSPARENCY",
      severity: mandated ? "HIGH" : "MEDIUM",
      field: "salary",
      message: mandated
        ? `No published pay range. ${region} requires a good-faith range in the posting.`
        : "No published pay range. Postings that state one draw better-matched applicants and fewer wasted screens, and disclosure duties are spreading.",
      suggestion: "Set a range and tick \"publish the range\".",
    });
  } else if (
    input.salaryMax != null &&
    input.salaryMin > 0 &&
    input.salaryMax / input.salaryMin > 2
  ) {
    findings.push({
      kind: "PAY_TRANSPARENCY",
      severity: "MEDIUM",
      field: "salary",
      message:
        "The published range is more than double from bottom to top, which reads as evasive and in some jurisdictions fails the good-faith test.",
      suggestion: "Narrow it, or split the posting into two levels.",
    });
  }

  // ---- Length and readability --------------------------------------------
  if (wordCount > 700) {
    findings.push({
      kind: "LENGTH",
      severity: "MEDIUM",
      field: "description",
      message: `${wordCount} words. Long postings measurably reduce completed applications, most on mobile.`,
      suggestion: "Aim for 300–600. Cut the company boilerplate before the job detail.",
    });
  } else if (wordCount > 0 && wordCount < 120) {
    findings.push({
      kind: "LENGTH",
      severity: "LOW",
      field: "description",
      message: `${wordCount} words. Too thin for an applicant to self-select on.`,
      suggestion: "Add what the person will do and what you are looking for.",
    });
  }

  const grade = readingGrade(body);
  if (grade != null && grade > 12) {
    findings.push({
      kind: "READING_LEVEL",
      severity: grade > 15 ? "MEDIUM" : "LOW",
      field: "description",
      message: `Reads at about grade ${grade}. Dense wording filters on education and on reading in a second language, neither of which the job may require.`,
      suggestion: "Shorten sentences and prefer plain words.",
    });
  }

  const counts: Record<FindingSeverity, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of findings) counts[f.severity] += 1;

  const penalty = findings.reduce((n, f) => n + SEVERITY_COST[f.severity], 0);
  return {
    findings,
    score: Math.max(0, Math.min(100, 100 - penalty)),
    wordCount,
    readingGrade: grade,
    counts,
  };
}

export const FINDING_LABEL: Record<FindingKind, string> = {
  CODED_LANGUAGE: "Coded language",
  GENDERED_TERM: "Gendered wording",
  INFLATED_REQUIREMENT: "Requirement may be inflated",
  AGE_SIGNAL: "Reads as an age preference",
  EXCLUSIONARY_PHRASING: "Exclusionary phrasing",
  READING_LEVEL: "Reading level",
  LENGTH: "Length",
  PAY_TRANSPARENCY: "Pay transparency",
  MISSING_SECTION: "Missing section",
  JARGON: "Jargon",
};
