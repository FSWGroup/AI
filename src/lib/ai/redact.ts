/**
 * Minimise what leaves the building (§35, §49).
 *
 * The interview-question generator only needs to know what someone has done
 * and what the job asks for. Contact details, government identifiers and
 * account numbers add nothing to a good interview question, so they are
 * stripped before the text is sent anywhere. This is data minimisation, not
 * a security boundary: the résumé body itself is still candidate data and is
 * only sent because a recruiter with recruiting.write explicitly asked for it.
 *
 * Pure functions, no server-only import — the unit tests exercise them
 * directly.
 */

export interface RedactionResult {
  text: string;
  removed: string[];
}

const PATTERNS: Array<{ label: string; re: RegExp; replacement: string }> = [
  { label: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g, replacement: '[email removed]' },
  {
    label: 'phone',
    re: /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g,
    replacement: '[phone removed]',
  },
  { label: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[identifier removed]' },
  // Philippine government identifiers (SSS, TIN, PhilHealth, Pag-IBIG).
  { label: 'gov-id', re: /\b\d{2}-\d{7}-\d\b|\b\d{3}-\d{3}-\d{3}-\d{3}\b|\b\d{4}-\d{4}-\d{4}\b/g, replacement: '[identifier removed]' },
  { label: 'card', re: /\b(?:\d[ -]?){13,19}\b/g, replacement: '[account number removed]' },
  { label: 'url-profile', re: /\bhttps?:\/\/\S+/gi, replacement: '[link removed]' },
  // Street addresses. Keeps "Exton, PA" style locations, which are relevant.
  {
    label: 'street-address',
    re: /\b\d{1,6}\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Terrace|Ter|Place|Pl)\b\.?/g,
    replacement: '[address removed]',
  },
  { label: 'dob', re: /\b(?:date of birth|d\.?o\.?b\.?|birth date)\s*[:\-]?\s*[^\n]{0,32}/gi, replacement: '[date of birth removed]' },
];

export function redactPersonalData(input: string): RedactionResult {
  let text = input;
  const removed: string[] = [];
  for (const { label, re, replacement } of PATTERNS) {
    // Fresh regex per call: the global flag carries lastIndex between uses.
    const pattern = new RegExp(re.source, re.flags);
    if (pattern.test(text)) {
      removed.push(label);
      text = text.replace(new RegExp(re.source, re.flags), replacement);
    }
  }
  return { text, removed };
}

/**
 * Résumés get long. Cap what we send both to control cost and to keep the
 * request well inside the model's context.
 */
export function truncateForPrompt(text: string, maxChars = 14_000): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return { text: trimmed, truncated: false };
  return { text: `${trimmed.slice(0, maxChars)}\n\n[résumé truncated]`, truncated: true };
}
