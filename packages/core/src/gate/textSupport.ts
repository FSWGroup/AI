/**
 * Deterministic "does this text support this value" check used by the gate for citation validity.
 * Numbers must appear as a numeric token (decimal, fraction like 3/4 or 1-1/2, or negative).
 * Text values must have every significant token present (stem-tolerant prefix match).
 * Booleans require an explicit yes/no marker.
 */
export function numericTokens(text: string): number[] {
  const out: number[] = [];
  const re = /(?<![A-Za-z0-9])-?\d+(?:-\d+\/\d+|\/\d+|\.\d+)?/g;
  for (const m of text.matchAll(re)) {
    const tok = m[0];
    let val: number;
    if (/^-?\d+-\d+\/\d+$/.test(tok)) { const neg = tok.startsWith("-"); const [whole, frac] = tok.replace(/^-/, "").split("-"); const [n, d] = frac.split("/").map(Number); val = Number(whole) + n / d; if (neg) val = -val; }
    else if (/^-?\d+\/\d+$/.test(tok)) { const [n, d] = tok.split("/").map(Number); val = n / d; }
    else val = Number(tok);
    if (Number.isFinite(val)) out.push(val);
  }
  // Also accept digits glued to letters (e.g. "S70-200 180" handled above; "Cv260" style)
  for (const m of text.matchAll(/(?<=[A-Za-z])(\d+(?:\.\d+)?)/g)) out.push(Number(m[1]));
  return out;
}

export function valueSupportedByText(value: string, text: string): boolean {
  const v = value.trim();
  if (!text) return false;
  const lower = text.toLowerCase();
  if (/^-?\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    return numericTokens(text).some((t) => Math.abs(t - n) < 1e-9);
  }
  if (/^-?\d+(\.\d+)?–-?\d+(\.\d+)?$/.test(v)) {
    const [a, b] = v.split("–").map(Number);
    const toks = numericTokens(text);
    return toks.some((t) => Math.abs(t - a) < 1e-9) && toks.some((t) => Math.abs(t - b) < 1e-9);
  }
  if (v === "true" || v === "false") {
    return v === "true" ? /\b(yes|true|compliant)\b/i.test(text) : /\b(no|false|not)\b/i.test(text);
  }
  const tokens = v.toLowerCase().replace(/_/g, " ").split(/[^a-z0-9]+/).filter((t) => t.length > 0);
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.every((tok) => {
    if (/^\d+$/.test(tok)) return numericTokens(text).some((t) => t === Number(tok)) || words.includes(tok);
    return words.some((w) => w === tok || (tok.length >= 4 && w.length >= 4 && (w.startsWith(tok) || tok.startsWith(w))));
  });
}
