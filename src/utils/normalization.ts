/** Text normalization helpers shared by the parser and aggregation services. */
import { COMPANY_ALIASES } from '../config/companyAliases';
import { SALES_REP_ALIASES, NON_PERSON_REP_VALUES, UNASSIGNED_REP_LABEL } from '../config/salesRepAliases';
import { VENDOR_ALIASES, VENDOR_STOPLIST_PATTERNS, INTERNAL_PASSTHROUGH_PATTERNS } from '../config/vendorAliases';

/** Trim, collapse whitespace (including line breaks). Display-safe. */
export function cleanText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

/** Lower-cased, whitespace-collapsed key for case-insensitive comparison. */
export function normalizeKey(value: unknown): string {
  return cleanText(value).toLowerCase();
}

/** Header normalization: lower-case, punctuation -> space, collapse spaces. */
export function normalizeHeader(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Alphanumeric-only lower-case token (used for vendor alias matching). */
export function normalizeLoose(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const companyAliasMap: Map<string, string> = new Map(
  Object.entries(COMPANY_ALIASES).map(([k, v]) => [normalizeKey(k), cleanText(v)]),
);

/**
 * Company grouping key: trimmed, collapsed, case-insensitive, with optional manual
 * aliases applied. No fuzzy matching by design.
 */
export function companyKey(name: unknown): string {
  const key = normalizeKey(name);
  const alias = companyAliasMap.get(key);
  return alias ? normalizeKey(alias) : key;
}

/** Cleanest display version of a company name (alias target wins when configured). */
export function companyDisplay(name: unknown): string {
  const key = normalizeKey(name);
  const alias = companyAliasMap.get(key);
  return alias ?? cleanText(name);
}

/**
 * Picks the best display name among variants of the same normalized company:
 * prefer mixed-case over ALL CAPS, then the most frequent, then the longest.
 */
export function pickDisplayName(variants: Map<string, number>): string {
  let best = '';
  let bestScore = -Infinity;
  for (const [name, count] of variants) {
    const hasLower = /[a-z]/.test(name);
    const hasUpper = /[A-Z]/.test(name);
    const mixed = hasLower && hasUpper ? 2 : hasLower ? 1 : 0;
    const score = mixed * 1_000_000 + count * 1000 + name.length;
    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }
  return best;
}

const repAliasMap: Map<string, string> = new Map(
  Object.entries(SALES_REP_ALIASES).map(([k, v]) => [normalizeKey(k), v]),
);
const nonPersonSet = new Set(NON_PERSON_REP_VALUES.map(normalizeKey));

/** Returns the canonical salesperson name, or null when the value is not a person. */
export function normalizeSalesRepName(value: unknown): string | null {
  const key = normalizeKey(value);
  if (!key || nonPersonSet.has(key)) return null;
  const alias = repAliasMap.get(key);
  if (alias) return alias;
  return cleanText(value);
}

export interface RepResolution {
  rep: string;
  assigned: boolean;
  source: 'territoryManager' | 'onlineSupport' | 'unassigned';
}

/**
 * Sales-rep ownership for a row: TERRITORY MANAGER when it names a person; otherwise
 * ONLINE SUPPORT when it names a person; otherwise "Online / Unassigned".
 */
export function resolveSalesRep(territoryManager: unknown, onlineSupport: unknown): RepResolution {
  const tm = normalizeSalesRepName(territoryManager);
  if (tm) return { rep: tm, assigned: true, source: 'territoryManager' };
  const os = normalizeSalesRepName(onlineSupport);
  if (os) return { rep: os, assigned: true, source: 'onlineSupport' };
  return { rep: UNASSIGNED_REP_LABEL, assigned: false, source: 'unassigned' };
}

const vendorAliasMap: Map<string, string> = new Map(
  Object.entries(VENDOR_ALIASES).map(([k, v]) => [normalizeLoose(k), v]),
);

function isVendorStopword(text: string): boolean {
  const t = cleanText(text);
  if (!t) return true;
  return VENDOR_STOPLIST_PATTERNS.some((re) => re.test(t));
}

/** Title-cases an ALL-CAPS vendor name for display; leaves mixed case alone. */
function vendorDisplayCase(name: string): string {
  if (!/[a-z]/.test(name) && /[A-Z]/.test(name) && name.length > 4) {
    return name
      .toLowerCase()
      .replace(/(^|[\s\-\/(])([a-z])/g, (_m, p, c) => p + c.toUpperCase())
      .replace(/\b(Llc|Inc|Ltd|Lp|Usa)\b/g, (m) => m.toUpperCase());
  }
  return name;
}

export interface VendorResolution {
  key: string;
  display: string;
}

/**
 * Resolves a VENDOR cell to a canonical vendor. Returns null when the cell is a
 * placeholder/status rather than a vendor. "Internal > Manufacturer" chains use
 * the manufacturer; "Vendor > VM" chains use the vendor.
 */
export function resolveVendor(value: unknown): VendorResolution | null {
  let text = cleanText(value);
  if (!text) return null;
  // Strip trailing question marks / commas and notes after a dash like "Titan-RGA" are handled below.
  text = text.replace(/[?,]+$/g, '').trim();
  if (text.includes('>')) {
    const parts = text.split(/\s*>+\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const first = parts[0];
      const isInternal = INTERNAL_PASSTHROUGH_PATTERNS.some((re) => re.test(first));
      const second = parts[1];
      if (isInternal && second && !isVendorStopword(second)) {
        text = second;
      } else {
        text = first;
      }
    } else if (parts.length === 1) {
      text = parts[0];
    }
  }
  // "Titan-RGA", "Titan-Replacement", "Triac-Missing 2 Items" -> vendor before the dash when the suffix is a note.
  const dashNote = /^(.*?)\s*-\s*(rga.*|replacement|missing.*|freight)$/i.exec(text);
  if (dashNote) text = dashNote[1].trim();
  if (isVendorStopword(text)) return null;
  const loose = normalizeLoose(text);
  if (!loose) return null;
  const alias = vendorAliasMap.get(loose);
  if (alias) return { key: normalizeLoose(alias), display: alias };
  // Strip a trailing corporate suffix for the key only, so "Acme Inc" and "Acme, Inc." match.
  const stripped = loose.replace(/\b(inc|llc|l p|lp|ltd|corp|corporation|co|company)\b\.?$/g, '').trim();
  const key = stripped || loose;
  const alias2 = vendorAliasMap.get(key);
  if (alias2) return { key: normalizeLoose(alias2), display: alias2 };
  return { key, display: vendorDisplayCase(text) };
}

/** Leading identifier token: digits (optionally letter-prefixed like "QN1234" or "I-8308"). */
export function extractIdentifierBase(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const inv = /^\s*(?:see\s+)?I\s*-?\s*(\d{3,})/i.exec(text);
  if (inv) return `I-${inv[1]}`;
  const m = /^\s*(?:see\s+)?(?:po\s*#?\s*)?([A-Za-z]{0,3}\d{3,})/.exec(text);
  if (m) return m[1].toUpperCase();
  return null;
}

/**
 * Some VENDOR cells list several vendors ("Main Line, Bonomi", "Conbraco / Layden").
 * Splits on commas and slashes when every part resolves to a vendor on its own;
 * otherwise treats the cell as one vendor.
 */
export function resolveVendors(value: unknown): VendorResolution[] {
  const text = cleanText(value).replace(/\s+vm$/i, '');
  if (!text) return [];
  if (!text.includes('>') && /[,\/]/.test(text)) {
    const parts = text.split(/\s*[,\/]\s*/).map((p) => p.trim()).filter(Boolean);
    const suffix = /^(inc|llc|l\.?p\.?|ltd|co|corp|corporation|company)\.?$/i;
    if (parts.length >= 2 && !parts.some((p) => suffix.test(p))) {
      const resolved = parts.map((p) => resolveVendor(p));
      if (resolved.every((r) => r != null)) {
        const out: VendorResolution[] = [];
        for (const r of resolved as VendorResolution[]) if (!out.some((o) => o.key === r.key)) out.push(r);
        return out;
      }
    }
  }
  const single = resolveVendor(text);
  return single ? [single] : [];
}

export function pluralize(n: number, singular: string, plural = singular + 's'): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
