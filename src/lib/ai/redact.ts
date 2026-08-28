/**
 * Identity redaction for résumé text before AI analysis.
 *
 * Why this exists: large language models have been shown to favour
 * candidates by name in résumé-screening tasks (Wilson & Caliskan, AIES
 * 2024), and a human reviewing a biased AI summary reproduces that bias
 * rather than correcting it ("No Thoughts, Just AI", AIES 2025). So the
 * model never sees the candidate's name, contact details, or address — it
 * reasons about work history against the role, which is the only thing it
 * is being asked to do.
 *
 * This is deliberately conservative: over-redaction costs a little context,
 * under-redaction reintroduces a documented bias. Redaction is not a
 * substitute for bias testing — see docs/AI-FEATURES.md.
 */

export interface RedactionResult {
  text: string;
  redactedCounts: Record<string, number>;
}

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PATTERNS: { label: string; re: RegExp; replacement: string }[] = [
  {
    label: "email",
    re: /[\w.+-]+@[\w-]+\.[\w.-]+/g,
    replacement: "[email removed]",
  },
  {
    label: "phone",
    // Common US/international shapes; deliberately broad.
    re: /(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
    replacement: "[phone removed]",
  },
  {
    label: "url",
    // Schemed, www-prefixed, AND bare domains (a bare "linkedin.com/in/jane-doe"
    // is a profile link that carries the candidate's name inside the path).
    re: /\b(?:https?:\/\/|www\.)[^\s)]+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|io|co|dev|me|edu|gov|info|biz)\b(?:\/[^\s)]*)?/gi,
    replacement: "[link removed]",
  },
  {
    label: "streetAddress",
    re: /\b\d{1,5}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+)*\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Terrace|Ter|Place|Pl|Circle|Cir)\b\.?/gi,
    replacement: "[address removed]",
  },
  {
    label: "postalCode",
    // US ZIP / ZIP+4. ZIP codes are an explicitly prohibited proxy for
    // protected characteristics under Illinois HB 3773.
    re: /\b\d{5}(?:-\d{4})?\b/g,
    replacement: "[postal code removed]",
  },
];

/**
 * Remove direct identifiers from résumé text.
 *
 * @param text      Raw extracted résumé text.
 * @param knownNames Name parts from the candidate record, removed wherever
 *                   they appear (headers, signature lines, "References for…").
 */
export function redactIdentity(
  text: string,
  knownNames: string[] = [],
): RedactionResult {
  let out = text;
  const counts: Record<string, number> = {};

  const record = (label: string, n: number) => {
    if (n > 0) counts[label] = (counts[label] ?? 0) + n;
  };

  for (const { label, re, replacement } of PATTERNS) {
    const matches = out.match(re);
    record(label, matches?.length ?? 0);
    out = out.replace(re, replacement);
  }

  // Remove the candidate's own name wherever it appears.
  const nameParts = knownNames
    .flatMap((n) => n.split(/\s+/))
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);

  // Run-together forms first (handles and usernames like "jordanreyes"),
  // otherwise the word-boundary pass below cannot see them.
  if (nameParts.length >= 2) {
    for (const [a, b] of [
      [nameParts[0], nameParts[nameParts.length - 1]],
      [nameParts[nameParts.length - 1], nameParts[0]],
    ]) {
      const re = new RegExp(
        `${escapeRegExp(a)}[._-]?${escapeRegExp(b)}`,
        "gi",
      );
      const matches = out.match(re);
      record("name", matches?.length ?? 0);
      out = out.replace(re, "[name removed]");
    }
  }

  for (const part of nameParts) {
    const re = new RegExp(`\\b${escapeRegExp(part)}\\b`, "gi");
    const matches = out.match(re);
    record("name", matches?.length ?? 0);
    out = out.replace(re, "[name removed]");
  }

  return { text: out, redactedCounts: counts };
}
