/**
 * Entity resolution: find candidate pairs, score them, and queue what needs a person
 * (ADR-0025, spec §49).
 *
 * Three stages, in order, and the order matters:
 *
 *   1. DETERMINISTIC — exact agreement on a trusted key links immediately. Not an
 *      optimisation: a weighted score can be dragged under a threshold by disagreeing
 *      minor signals, and two records sharing a tax identifier are the same company
 *      whatever their addresses say.
 *   2. WEIGHTED — an explainable additive score, with the feature vector stored.
 *   3. HUMAN — anything between the thresholds waits for a steward.
 *
 * Blocking comes first, because full pairwise comparison is quadratic and therefore
 * not an option. Only pairs sharing a blocking key are scored, and blocking recall is
 * itself measured — a pair the blocker never generates is a pair the scorer never
 * sees, which is the failure mode nobody notices.
 */
import { sql } from 'kysely';
import type { DbTransaction } from '../../../platform/db/index.js';
import type { UnitOfWork } from '../../../kernel/unit-of-work.js';
import { MatchCandidateRaised, MatchCandidateDecided } from '../events.js';
import { ValidationError, NotFoundError } from '../../../platform/errors.js';
import {
  NAME_NORMALIZATION_VERSION,
  normalizeDomain,
  normalizeName,
  normalizePhone,
} from './normalize.js';
import {
  deterministicMatch,
  scorePair,
  type MatchSubject,
  type MatchWeights,
  type ScoreResult,
} from './score.js';

export interface MatchConfig {
  readonly version: number;
  readonly weights: MatchWeights;
  readonly autoLinkThreshold: number;
  readonly reviewThreshold: number;
  readonly normalizationVersion: number;
}

export async function loadMatchConfig(
  tx: DbTransaction,
  entityType = 'ORGANIZATION',
): Promise<MatchConfig> {
  const result = await sql<{
    version: number;
    weights: MatchWeights;
    auto_link_threshold: string;
    review_threshold: string;
    normalization_version: number;
  }>`
    SELECT version, weights, auto_link_threshold, review_threshold, normalization_version
      FROM party.match_config WHERE entity_type = ${entityType} AND is_active
  `.execute(tx);
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(
      `No active match configuration for ${entityType}. Matching without a recorded ` +
        `configuration would produce scores nobody could reproduce.`,
    );
  }
  return {
    version: row.version,
    weights: row.weights,
    autoLinkThreshold: Number(row.auto_link_threshold),
    reviewThreshold: Number(row.review_threshold),
    normalizationVersion: row.normalization_version,
  };
}

/**
 * The keys a record blocks on.
 *
 * Each is a cheap equality lookup that a true duplicate is likely to share. More keys
 * means better recall and more pairs to score; these four are the set ADR-0025 starts
 * from, and the recall test is what says whether they are enough.
 */
export function blockingKeys(subject: MatchSubject): readonly string[] {
  const keys: string[] = [];
  const name = normalizeName(subject.name);

  // The first distinctive token plus a short prefix. Catches "Acme Pharma" against
  // "Acme Pharmaceutical" without blocking every company beginning with 'A'.
  const lead = name.distinctiveTokens[0];
  if (lead !== undefined && lead.length >= 3) {
    keys.push(`name:${lead.slice(0, 6)}`);
  }
  // The whole normalized name, so an exact duplicate blocks even when its first token
  // is short ('BP', 'GE').
  if (name.normalized !== '') keys.push(`fullname:${name.normalized}`);

  if (subject.postalCode !== null && subject.postalCode.trim() !== '') {
    keys.push(`postal:${subject.postalCode.trim().slice(0, 5).toLowerCase()}`);
  }
  const domain = normalizeDomain(subject.website);
  if (domain !== undefined) keys.push(`domain:${domain}`);

  const phone = normalizePhone(subject.phone);
  if (phone !== undefined) keys.push(`phone:${phone}`);

  return keys;
}

/** Load the comparable shape of an organization, aliases and parents included. */
export async function loadSubject(
  tx: DbTransaction,
  organizationId: string,
): Promise<MatchSubject> {
  const result = await sql<{
    id: string;
    legal_name: string;
    tax_identifier: string | null;
    duns_number: string | null;
    website_url: string | null;
    main_phone: string | null;
    line1: string | null;
    city: string | null;
    region_code: string | null;
    postal_code: string | null;
    aliases: string[];
    parent_ids: string[];
  }>`
    SELECT o.id, o.legal_name, o.tax_identifier, o.duns_number, o.website_url,
           o.main_phone, l.line1, l.city, l.region_code, l.postal_code,
           coalesce(a.aliases, '{}') AS aliases,
           coalesce(p.parent_ids, '{}') AS parent_ids
      FROM party.organization o
      LEFT JOIN party.location l ON l.id = o.primary_location_id
      LEFT JOIN LATERAL (
        SELECT array_agg(alias)::text[] AS aliases FROM party.organization_alias
         WHERE organization_id = o.id
      ) a ON true
      LEFT JOIN LATERAL (
        SELECT array_agg(r.from_organization_id)::text[] AS parent_ids
          FROM party.organization_relationship r
          JOIN party.relationship_type t ON t.code = r.relationship_code
         WHERE r.to_organization_id = o.id AND t.is_hierarchical AND r.valid_to IS NULL
      ) p ON true
     WHERE o.id = ${organizationId}::uuid
  `.execute(tx);

  const row = result.rows[0];
  if (row === undefined) throw new NotFoundError('organization', organizationId);

  return {
    id: row.id,
    name: row.legal_name,
    aliases: row.aliases,
    addressLine1: row.line1,
    city: row.city,
    regionCode: row.region_code,
    postalCode: row.postal_code,
    website: row.website_url,
    phone: row.main_phone,
    parentIds: row.parent_ids,
    duns: row.duns_number,
    taxIdentifier: row.tax_identifier,
  };
}

/**
 * Organizations sharing at least one blocking key with this one.
 *
 * Merged records are excluded: they take no new facts, and a pair against one would
 * ask a steward to decide something already decided.
 */
export async function findBlockedCandidates(
  tx: DbTransaction,
  subject: MatchSubject,
  limit = 200,
): Promise<readonly MatchSubject[]> {
  const keys = blockingKeys(subject);
  if (keys.length === 0) return [];

  const name = normalizeName(subject.name);
  const lead = name.distinctiveTokens[0]?.slice(0, 6) ?? null;
  const domain = normalizeDomain(subject.website) ?? null;
  const phone = normalizePhone(subject.phone) ?? null;
  const postal =
    subject.postalCode === null
      ? null
      : subject.postalCode.trim().slice(0, 5).toLowerCase();

  const result = await sql<{ id: string }>`
    SELECT DISTINCT o.id
      FROM party.organization o
      LEFT JOIN party.location l ON l.id = o.primary_location_id
     WHERE o.id <> ${subject.id}::uuid
       AND o.merged_into_id IS NULL
       AND (
            (${lead}::text IS NOT NULL AND lower(o.legal_name) LIKE ${lead === null ? null : `%${lead}%`})
         OR (${postal}::text IS NOT NULL AND lower(left(l.postal_code, 5)) = ${postal})
         OR (${domain}::text IS NOT NULL
             AND lower(o.website_url) LIKE ${domain === null ? null : `%${domain}%`})
         OR (${phone}::text IS NOT NULL
             AND regexp_replace(coalesce(o.main_phone, ''), '\\D', '', 'g')
                 LIKE ${phone === null ? null : `%${phone.replace('+1', '')}%`})
         OR EXISTS (
              SELECT 1 FROM party.organization_alias al
               WHERE al.organization_id = o.id
                 AND al.normalized_alias = ${name.normalized}
            )
       )
     LIMIT ${limit}
  `.execute(tx);

  return Promise.all(result.rows.map((row) => loadSubject(tx, row.id)));
}

export interface ResolutionOutcome {
  readonly candidateId: string;
  readonly otherId: string;
  readonly score: number;
  readonly status: 'PENDING' | 'AUTO_LINKED' | 'SUPPRESSED';
  readonly method: 'DETERMINISTIC' | 'PROBABILISTIC';
  readonly deterministicRule: string | undefined;
}

/**
 * Resolve one organization against everything it blocks with.
 *
 * Creates nothing below the review threshold. A pair a steward will never look at is
 * not evidence; it is a row that makes the queue harder to read.
 */
export async function resolveOrganization(
  uow: UnitOfWork,
  config: MatchConfig,
  organizationId: string,
): Promise<readonly ResolutionOutcome[]> {
  const subject = await loadSubject(uow.tx, organizationId);
  const others = await findBlockedCandidates(uow.tx, subject);
  const outcomes: ResolutionOutcome[] = [];

  for (const other of others) {
    const deterministic = deterministicMatch(subject, other);
    const scored = scorePair(subject, other, config.weights);

    const isDeterministic = deterministic !== undefined;
    const effectiveScore = isDeterministic ? 1 : scored.score;

    if (!isDeterministic && effectiveScore < config.reviewThreshold) continue;

    const decision = await recordCandidate(uow, config, subject.id, other.id, {
      score: effectiveScore,
      scored,
      deterministicRule: deterministic?.rule,
      deterministicDetail: deterministic?.detail,
    });
    if (decision !== undefined) outcomes.push(decision);
  }

  return outcomes;
}

interface CandidateEvidence {
  readonly score: number;
  readonly scored: ScoreResult;
  readonly deterministicRule: string | undefined;
  readonly deterministicDetail: string | undefined;
}

async function recordCandidate(
  uow: UnitOfWork,
  config: MatchConfig,
  subjectId: string,
  otherId: string,
  evidence: CandidateEvidence,
): Promise<ResolutionOutcome | undefined> {
  // The pair is stored once however it was discovered, so resolving A finds the same
  // row as resolving B rather than raising the question twice.
  const [left, right] = subjectId < otherId ? [subjectId, otherId] : [otherId, subjectId];

  // A pair a steward has already ruled on stays ruled on until the EVIDENCE changes.
  // Without this the queue refills with the same twelve pairs and stops being read.
  const settled = await sql<{ status: string; evidence_fingerprint: string }>`
    SELECT status, evidence_fingerprint FROM party.match_candidate
     WHERE entity_type = 'ORGANIZATION' AND left_entity_id = ${left}::uuid
       AND right_entity_id = ${right}::uuid
     ORDER BY created_at DESC LIMIT 1
  `.execute(uow.tx);

  const previous = settled.rows[0];
  if (previous !== undefined) {
    const decided = ['REJECTED', 'KNOWN_DIFFERENT', 'APPROVED', 'AUTO_LINKED'].includes(
      previous.status,
    );
    if (
      decided &&
      previous.evidence_fingerprint === evidence.scored.evidenceFingerprint
    ) {
      return undefined;
    }
    if (
      !decided &&
      previous.evidence_fingerprint === evidence.scored.evidenceFingerprint
    ) {
      return undefined; // Already queued on exactly this evidence.
    }
    if (decided) {
      // The evidence moved. The old decision is superseded rather than deleted: what a
      // steward decided, and on what, is worth keeping.
      await sql`
        UPDATE party.match_candidate SET status = 'SUPERSEDED'
         WHERE entity_type = 'ORGANIZATION' AND left_entity_id = ${left}::uuid
           AND right_entity_id = ${right}::uuid AND status = ${previous.status}
      `.execute(uow.tx);
    }
  }

  const autoLink = evidence.score >= config.autoLinkThreshold;
  const status = autoLink ? 'AUTO_LINKED' : 'PENDING';
  const method =
    evidence.deterministicRule === undefined ? 'PROBABILISTIC' : 'DETERMINISTIC';

  const features =
    evidence.deterministicRule === undefined
      ? evidence.scored.features
      : [
          ...evidence.scored.features,
          {
            signal: 'deterministic_rule',
            value: 1,
            weight: 1,
            contribution: 1,
            detail: evidence.deterministicDetail ?? evidence.deterministicRule,
          },
        ];

  const id = uow.ids.next();
  await sql`
    INSERT INTO party.match_candidate
      (id, entity_type, left_entity_id, right_entity_id, score, features, method,
       deterministic_rule, blocking_keys, match_config_version, normalization_version,
       status, evidence_fingerprint, decided_at)
    VALUES (${id}, 'ORGANIZATION', ${left}::uuid, ${right}::uuid, ${evidence.score},
            ${JSON.stringify(features)}::jsonb, ${method},
            ${evidence.deterministicRule ?? null},
            ${[]}::text[], ${config.version}, ${NAME_NORMALIZATION_VERSION},
            ${status}, ${evidence.scored.evidenceFingerprint},
            ${autoLink ? sql`now()` : null})
    ON CONFLICT (entity_type, left_entity_id, right_entity_id, evidence_fingerprint)
    DO NOTHING
  `.execute(uow.tx);

  uow.emit(
    MatchCandidateRaised,
    {
      matchCandidateId: id,
      entityType: 'ORGANIZATION',
      leftEntityId: left,
      rightEntityId: right,
      score: evidence.score,
      method,
    },
    { aggregateId: id },
  );

  return {
    candidateId: id,
    otherId,
    score: evidence.score,
    status,
    method,
    deterministicRule: evidence.deterministicRule,
  };
}

export type ReviewDecision = 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'KNOWN_DIFFERENT';

/**
 * Record a steward's decision. Approving does not itself merge: the caller does that,
 * so that a merge always carries its own reason and actor rather than inheriting one
 * from a queue action.
 */
export async function decideCandidate(
  uow: UnitOfWork,
  candidateId: string,
  decision: ReviewDecision,
  reason: string,
  mergeId?: string,
): Promise<void> {
  if (reason.trim() === '') {
    throw new ValidationError(
      'A decision needs a reason. A rejection with no reason cannot be re-evaluated ' +
        'when the same pair comes back with better evidence.',
    );
  }

  const result = await sql<{ id: string }>`
    UPDATE party.match_candidate
       SET status = ${decision}, decided_at = now(),
           decided_by = ${uow.context.actor.principalId ?? null}::uuid,
           decision_reason = ${reason}, merge_id = ${mergeId ?? null}::uuid
     WHERE id = ${candidateId}::uuid AND status IN ('PENDING','DEFERRED')
    RETURNING id
  `.execute(uow.tx);

  if (result.rows.length === 0) {
    throw new ValidationError(
      `Match candidate ${candidateId} is not awaiting a decision. It has either been ` +
        `decided already or superseded by newer evidence.`,
    );
  }

  uow.emit(
    MatchCandidateDecided,
    {
      matchCandidateId: candidateId,
      entityType: 'ORGANIZATION',
      status: decision,
      mergeId: mergeId ?? null,
    },
    { aggregateId: candidateId },
  );
}
