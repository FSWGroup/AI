/**
 * Explainable weighted scoring (ADR-0025, spec §49).
 *
 * Additive, transparent, and entirely configuration-driven. There is no model here and
 * there will not be one: specification §80 forbids ML matching, and the reason is
 * practical rather than ideological. A merge deletes a salesperson's account from their
 * view. "The model scored it 0.94" is not an answer they can argue with, and an answer
 * nobody can argue with is one nobody can correct.
 *
 * Every score therefore comes with the vector that produced it: which signals fired,
 * what each measured, and what each contributed. That is what the review screen shows.
 */
import { createHash } from 'node:crypto';
import {
  NAME_NORMALIZATION_VERSION,
  normalizeDomain,
  normalizeName,
  normalizePhone,
  tokenContainment,
  tokenOverlap,
} from './normalize.js';

/** Signals the scorer knows how to compute. A weight absent from the configuration
 * disables its signal, so removing one is configuration rather than a code change. */
export type SignalName =
  | 'name_similarity'
  | 'name_token_overlap'
  | 'alias_exact'
  | 'address_similarity'
  | 'postal_exact'
  | 'city_region_exact'
  | 'domain_exact'
  | 'phone_exact'
  | 'shared_parent';

export interface Feature {
  readonly signal: SignalName;
  /** What the signal measured, 0 to 1. */
  readonly value: number;
  readonly weight: number;
  readonly contribution: number;
  /** What a reviewer needs to see to judge it: the two values compared. */
  readonly detail: string;
}

/** One side of a comparison, already normalized by the caller. */
export interface MatchSubject {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly addressLine1: string | null;
  readonly city: string | null;
  readonly regionCode: string | null;
  readonly postalCode: string | null;
  readonly website: string | null;
  readonly phone: string | null;
  readonly parentIds: readonly string[];
  /** Trusted external identifiers, for the deterministic stage. */
  readonly duns: string | null;
  readonly taxIdentifier: string | null;
}

export interface MatchWeights {
  readonly [signal: string]: number;
}

export interface ScoreResult {
  readonly score: number;
  readonly features: readonly Feature[];
  readonly evidenceFingerprint: string;
  readonly normalizationVersion: number;
}

/**
 * Trigram similarity, matching PostgreSQL's `pg_trgm` definition.
 *
 * Reimplemented rather than pushed into SQL so scoring is a pure function: the rule
 * behaviour is combinatorial, and needing a database round trip per case is how a
 * matching engine ends up tested on three examples. `tests/party/matching.test.ts`
 * checks this against PostgreSQL's own `similarity()` on a corpus, so the two cannot
 * drift apart silently.
 */
export function trigramSimilarity(left: string, right: string): number {
  if (left === right) return left === '' ? 0 : 1;
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** pg_trgm pads each word with two leading spaces and one trailing space. */
function trigrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (const word of text.split(/\s+/).filter((w) => w !== '')) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) {
      grams.add(padded.slice(i, i + 3));
    }
  }
  return grams;
}

/**
 * Score a pair.
 *
 * Returns every signal that could be computed, INCLUDING those that scored zero:
 * "the postal codes were compared and differ" is evidence a reviewer needs, and
 * omitting it makes an absent signal indistinguishable from a disagreeing one. Signals
 * that could not be computed at all — neither side has a phone number — are omitted,
 * with the distinction recorded in the detail of those that remain.
 */
export function scorePair(
  left: MatchSubject,
  right: MatchSubject,
  weights: MatchWeights,
): ScoreResult {
  const features: Feature[] = [];

  const add = (signal: SignalName, value: number, detail: string): void => {
    const weight = weights[signal];
    if (weight === undefined || weight === 0) return;
    // Contribution is computed from the ROUNDED value, so a reviewer adding up the
    // column arrives at the score they are shown rather than one that is quietly off.
    const rounded = round(value);
    features.push({
      signal,
      value: rounded,
      weight,
      contribution: round(rounded * weight),
      detail,
    });
  };

  const leftName = normalizeName(left.name);
  const rightName = normalizeName(right.name);

  add(
    'name_similarity',
    trigramSimilarity(leftName.normalized, rightName.normalized),
    `'${leftName.normalized}' against '${rightName.normalized}'`,
  );

  add(
    'name_token_overlap',
    Math.max(
      tokenOverlap(leftName.distinctiveTokens, rightName.distinctiveTokens),
      tokenContainment(leftName.distinctiveTokens, rightName.distinctiveTokens),
    ),
    `[${leftName.distinctiveTokens.join(', ')}] against [${rightName.distinctiveTokens.join(', ')}]`,
  );

  const aliasHit = bestAliasMatch(left, right);
  if (aliasHit !== undefined) {
    add('alias_exact', 1, aliasHit);
  }

  if (left.addressLine1 !== null && right.addressLine1 !== null) {
    const leftLine = normalizeName(left.addressLine1).folded;
    const rightLine = normalizeName(right.addressLine1).folded;
    add(
      'address_similarity',
      trigramSimilarity(leftLine, rightLine),
      `'${leftLine}' against '${rightLine}'`,
    );
  }

  if (left.postalCode !== null && right.postalCode !== null) {
    const leftPostal = left.postalCode.trim().slice(0, 5).toLowerCase();
    const rightPostal = right.postalCode.trim().slice(0, 5).toLowerCase();
    add(
      'postal_exact',
      leftPostal === rightPostal ? 1 : 0,
      `${leftPostal} against ${rightPostal}`,
    );
  }

  if (
    left.city !== null &&
    right.city !== null &&
    left.regionCode !== null &&
    right.regionCode !== null
  ) {
    const leftPlace = `${normalizeName(left.city).folded}, ${left.regionCode.toLowerCase()}`;
    const rightPlace = `${normalizeName(right.city).folded}, ${right.regionCode.toLowerCase()}`;
    add(
      'city_region_exact',
      leftPlace === rightPlace ? 1 : 0,
      `${leftPlace} against ${rightPlace}`,
    );
  }

  const leftDomain = normalizeDomain(left.website);
  const rightDomain = normalizeDomain(right.website);
  if (leftDomain !== undefined && rightDomain !== undefined) {
    add(
      'domain_exact',
      leftDomain === rightDomain ? 1 : 0,
      `${leftDomain} against ${rightDomain}`,
    );
  }

  const leftPhone = normalizePhone(left.phone);
  const rightPhone = normalizePhone(right.phone);
  if (leftPhone !== undefined && rightPhone !== undefined) {
    add(
      'phone_exact',
      leftPhone === rightPhone ? 1 : 0,
      `${leftPhone} against ${rightPhone}`,
    );
  }

  const sharedParent = left.parentIds.find((id) => right.parentIds.includes(id));
  if (left.parentIds.length > 0 && right.parentIds.length > 0) {
    add(
      'shared_parent',
      sharedParent === undefined ? 0 : 1,
      sharedParent === undefined
        ? 'no parent in common'
        : `both are under ${sharedParent}`,
    );
  }

  const total = features.reduce((sum, feature) => sum + feature.contribution, 0);

  // Normalized by the weight of the signals that could actually be compared, not by
  // the full configured total. Otherwise two records with only a name — which is the
  // common case for a CRM export — could never clear a threshold however identical
  // their names, simply because nobody recorded a phone number.
  const availableWeight = features.reduce((sum, feature) => sum + feature.weight, 0);
  const score = availableWeight === 0 ? 0 : Math.min(1, total / availableWeight);

  return {
    score: round(score),
    features,
    evidenceFingerprint: fingerprint(left, right, features),
    normalizationVersion: NAME_NORMALIZATION_VERSION,
  };
}

function bestAliasMatch(left: MatchSubject, right: MatchSubject): string | undefined {
  const leftForms = new Set(
    [left.name, ...left.aliases].map((value) => normalizeName(value).normalized),
  );
  for (const alias of [right.name, ...right.aliases]) {
    const normalized = normalizeName(alias).normalized;
    if (leftForms.has(normalized)) return `both are known as '${normalized}'`;
  }
  return undefined;
}

/**
 * A hash over what the evidence actually SAID, not over the score.
 *
 * The distinction matters. A rejected pair must not resurface because a weight was
 * tuned — that is not new information about the two companies, and a queue that
 * refills every time someone edits configuration stops being read. It must resurface
 * when a signal's measured value changes, because that is a source telling us
 * something new.
 */
function fingerprint(
  left: MatchSubject,
  right: MatchSubject,
  features: readonly Feature[],
): string {
  const evidence = features
    .map((feature) => `${feature.signal}=${feature.value.toFixed(2)}`)
    .sort()
    .join('|');
  // The identifiers are ordered, because a pair is one pair however it was found.
  // Resolving A and then resolving B must produce the same fingerprint, or a rejected
  // pair would come straight back the next time the other side was processed — which
  // is the exact failure the fingerprint exists to prevent.
  const [first, second] = left.id < right.id ? [left.id, right.id] : [right.id, left.id];
  return createHash('sha256').update(`${first}|${second}|${evidence}`).digest('hex');
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * The deterministic rules (ADR-0025 stage 1).
 *
 * Exact agreement on a trusted key links immediately, with no scoring at all. Running
 * these first is not an optimisation: a weighted score can be dragged below a
 * threshold by disagreeing minor signals, and two records sharing a tax identifier are
 * the same company whatever their addresses say.
 */
export type DeterministicRule =
  'TRUSTED_TAX_IDENTIFIER' | 'TRUSTED_DUNS' | 'DOMAIN_AND_NAME' | 'ADDRESS_AND_NAME';

/** How similar names must be for the composite deterministic rules. High on purpose:
 * these bypass scoring entirely, so they must not fire on a plausible coincidence. */
export const DETERMINISTIC_NAME_FLOOR = 0.85;

export function deterministicMatch(
  left: MatchSubject,
  right: MatchSubject,
): { rule: DeterministicRule; detail: string } | undefined {
  if (
    left.taxIdentifier !== null &&
    right.taxIdentifier !== null &&
    normalizeIdentifier(left.taxIdentifier) === normalizeIdentifier(right.taxIdentifier)
  ) {
    return {
      rule: 'TRUSTED_TAX_IDENTIFIER',
      detail: 'Both records carry the same tax identifier.',
    };
  }

  if (
    left.duns !== null &&
    right.duns !== null &&
    normalizeIdentifier(left.duns) === normalizeIdentifier(right.duns)
  ) {
    return { rule: 'TRUSTED_DUNS', detail: 'Both records carry the same DUNS number.' };
  }

  const nameSimilarity = trigramSimilarity(
    normalizeName(left.name).normalized,
    normalizeName(right.name).normalized,
  );

  if (nameSimilarity >= DETERMINISTIC_NAME_FLOOR) {
    const leftDomain = normalizeDomain(left.website);
    const rightDomain = normalizeDomain(right.website);
    if (leftDomain !== undefined && leftDomain === rightDomain) {
      return {
        rule: 'DOMAIN_AND_NAME',
        detail: `Same domain (${leftDomain}) and closely matching names (${nameSimilarity.toFixed(2)}).`,
      };
    }

    if (
      left.addressLine1 !== null &&
      right.addressLine1 !== null &&
      left.postalCode !== null &&
      normalizeName(left.addressLine1).folded ===
        normalizeName(right.addressLine1).folded &&
      left.postalCode.slice(0, 5) === right.postalCode?.slice(0, 5)
    ) {
      return {
        rule: 'ADDRESS_AND_NAME',
        detail: `Same address and closely matching names (${nameSimilarity.toFixed(2)}).`,
      };
    }
  }

  return undefined;
}

function normalizeIdentifier(value: string): string {
  return value.replace(/\D/g, '');
}
