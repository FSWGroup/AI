/**
 * Identifier normalization.
 *
 * ABC-123 / ABC123 / ABC 123 / abc-123 / abc.123 → "ABC123".
 * Normalization is intentionally lossy so that the *exact* raw identifier is always stored beside it.
 * Matching semantics (exact / normalized / prefix) are decided by the retrieval layer, never here.
 */
export function normalizeIdentifier(raw: string): string {
  return raw
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s\-_.\/\\,;:()\[\]]/g, "")
    .trim();
}

/** Tokens that look like part numbers inside free text (letters+digits with optional separators). */
export function extractIdentifierCandidates(text: string): string[] {
  const out = new Set<string>();
  const re = /\b(?=[A-Za-z0-9\-\/\.]*\d)(?=[A-Za-z0-9\-\/\.]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9\-\/\.]{2,}[A-Za-z0-9]\b/g;
  for (const m of text.matchAll(re)) {
    const tok = m[0];
    // exclude sizes like 1/2", 2IN, and units
    if (/^\d+(\.\d+)?(IN|MM|PSI|PSIG|F|C|V|VAC|VDC|NPT)$/i.test(tok)) continue;
    if (/^\d+\/\d+$/.test(tok)) continue;
    out.add(tok);
  }
  return [...out];
}
