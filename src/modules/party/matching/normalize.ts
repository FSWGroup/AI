/**
 * Name and value normalization for matching (ADR-0025).
 *
 * Its own component, and versioned, because changing it changes every score that has
 * ever been computed. A stored score produced under version 1 is not comparable with a
 * threshold applied to version 2, so the version travels with the score.
 *
 * The scope is deliberately narrow: case, accents, punctuation, legal suffixes and a
 * short list of industry stop words. It does not attempt to expand abbreviations, guess
 * at misspellings, or apply any kind of stemming — those turn a normalizer into a
 * matcher, and a matcher whose behaviour is buried in a normalizer is unexplainable.
 */

/** Bumped whenever normalization changes meaning. Stored on every score and alias. */
export const NAME_NORMALIZATION_VERSION = 1;

/**
 * Legal-form suffixes, removed before comparison.
 *
 * "Acme Pharma LLC" and "Acme Pharma Inc" are far more often the same company under a
 * changed legal form than two different companies — and where they are genuinely
 * different, the address, domain and phone signals are what should separate them, not
 * a token every company has.
 */
const LEGAL_SUFFIXES = new Set([
  'inc',
  'incorporated',
  'llc',
  'llp',
  'lp',
  'ltd',
  'limited',
  'co',
  'company',
  'corp',
  'corporation',
  'plc',
  'gmbh',
  'sa',
  'nv',
  'bv',
  'ag',
  'pty',
  'pte',
  'srl',
  'spa',
  'oy',
  'ab',
  'as',
]);

/**
 * Words too common in this industry to carry evidence.
 *
 * Kept short on purpose. Every word removed here is evidence discarded, and an
 * over-eager stop list makes "Keystone Valve" and "Keystone Pump" look identical.
 */
const STOP_WORDS = new Set(['the', 'and', 'of', 'a', 'an']);

/** Words that describe what a company does, weakened but not removed. */
const INDUSTRY_WORDS = new Set([
  'industrial',
  'industries',
  'supply',
  'supplies',
  'equipment',
  'systems',
  'services',
  'solutions',
  'group',
  'holdings',
  'international',
  'associates',
  'enterprises',
]);

/** Case-fold, strip accents, and reduce punctuation to spaces. */
export function foldText(text: string): string {
  return (
    text
      .normalize('NFD')
      // Combining marks: 'é' becomes 'e', so a source that types accents and one that
      // does not agree.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      // '&' becomes the word, so "B & G" and "B and G" reach the same place. ('and'
      // is a stop word and drops out afterwards; what matters is that neither
      // spelling collapses to "bg", which would collide with far too much.)
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
  );
}

export interface NormalizedName {
  /** The comparison form: folded, suffixes and stop words removed. */
  readonly normalized: string;
  /** Tokens of the comparison form, for set overlap. */
  readonly tokens: readonly string[];
  /** Tokens that actually distinguish this name, industry words excluded. */
  readonly distinctiveTokens: readonly string[];
  /** Folded but complete, for cases where the suffix matters. */
  readonly folded: string;
  readonly version: number;
}

export function normalizeName(name: string): NormalizedName {
  const folded = foldText(name);
  const all = folded.split(' ').filter((token) => token !== '');

  let tokens = all.filter(
    (token) => !LEGAL_SUFFIXES.has(token) && !STOP_WORDS.has(token),
  );

  // A name that is ENTIRELY suffixes and stop words keeps its tokens: an empty
  // normalized name would block against every other empty one, which is the worst
  // possible outcome for a matching key.
  if (tokens.length === 0) tokens = all;

  const distinctive = tokens.filter((token) => !INDUSTRY_WORDS.has(token));

  return {
    normalized: tokens.join(' '),
    tokens,
    distinctiveTokens: distinctive.length > 0 ? distinctive : tokens,
    folded,
    version: NAME_NORMALIZATION_VERSION,
  };
}

/**
 * The registrable domain of a URL or email address, lowercased.
 *
 * `www` is stripped; nothing else is. Reducing 'shop.example.com' to 'example.com'
 * would be a guess about how the company organises its estate, and the public-suffix
 * data needed to do it correctly is a dependency this does not warrant.
 */
export function normalizeDomain(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = value.trim().toLowerCase();
  if (text === '') return undefined;

  const afterAt = text.includes('@') ? text.slice(text.lastIndexOf('@') + 1) : text;
  const withoutScheme = afterAt.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const host = withoutScheme.split(/[/?#]/)[0] ?? '';
  const withoutPort = host.split(':')[0] ?? '';
  const bare = withoutPort.replace(/^www\./, '');

  // A hostname has a dot and no spaces. Anything else is not a domain, and treating it
  // as one would make two records with the same typo look like a domain match.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(bare)) return undefined;
  return bare;
}

/**
 * A North American phone number reduced to E.164, or undefined.
 *
 * Deliberately conservative: only lengths that are unambiguously NANP are accepted.
 * A seven-digit number has no area code, and inventing one from an address is a guess
 * that would make two unrelated companies in different states look like a phone match.
 * Extensions are dropped, because 'x204' identifies a person rather than a company.
 */
export function normalizePhone(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  // A trailing extension identifies a person, not a company, so it is dropped. The
  // pattern is anchored: a word-boundary match does not fire on 'x204' at all.
  const beforeExtension = value.replace(/\s*(?:x|ext|extn|extension)\.?\s*\d+\s*$/i, '');
  const digits = beforeExtension.replace(/\D/g, '');

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return undefined;
}

/** Jaccard similarity over two token sets: shared tokens over total distinct tokens. */
export function tokenOverlap(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const a = new Set(left);
  const b = new Set(right);
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * How completely the smaller name is contained in the larger.
 *
 * Distinct from Jaccard and worth having: "Acme Pharma" against "Acme Pharma West
 * Chester Division" scores 0.4 on Jaccard and 1.0 here, and containment is the better
 * signal for the case where one source records a division and another does not.
 */
export function tokenContainment(
  left: readonly string[],
  right: readonly string[],
): number {
  if (left.length === 0 || right.length === 0) return 0;
  const [smaller, larger] =
    left.length <= right.length
      ? [new Set(left), new Set(right)]
      : [new Set(right), new Set(left)];
  let shared = 0;
  for (const token of smaller) if (larger.has(token)) shared += 1;
  return shared / smaller.size;
}
