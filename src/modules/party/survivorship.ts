/**
 * The survivorship engine (ADR-0011, spec §11, §51, acceptance criterion 10).
 *
 * Given the candidate values for one field, choose a winner, say why in language a
 * person reading a provenance panel can use, and materialize the result into the
 * canonical column — all inside the caller's transaction.
 *
 * Three properties this file exists to guarantee:
 *
 *   * **Deterministic.** The same candidates and the same rule always produce the same
 *     winner. Ties are broken by candidate identifier, which is monotonic, so "first
 *     one the database happened to return" never decides anything.
 *   * **Non-destructive.** Losing candidates keep their rows. Re-evaluating after a
 *     rule change produces a new selection and a new reason and destroys nothing.
 *   * **Explainable.** Every selection carries a reason naming the rule that made it
 *     and the fact that decided it, not just "priority".
 */
import { sql } from 'kysely';
import type { DbTransaction } from '../../platform/db/index.js';
import type { UnitOfWork } from '../../kernel/unit-of-work.js';
import {
  ENTITY_TABLE,
  quoteColumn,
  type EntityType,
  type FieldRegistry,
  type MasteredField,
} from './fields.js';

export type Strategy = 'PRIORITY' | 'RECENCY' | 'PRIORITY_THEN_RECENCY' | 'MOST_COMPLETE';

export interface SurvivorshipRule {
  readonly entityType: EntityType;
  readonly fieldKey: string | undefined;
  readonly strategy: Strategy;
  readonly preferVerified: boolean;
  readonly allowAbsenceToWin: boolean;
  readonly minConfidence: number;
  readonly sourcePriority: readonly string[];
  readonly version: number;
}

export interface FieldOwnership {
  readonly entityType: EntityType;
  readonly fieldKey: string;
  readonly operatingCompany: string | undefined;
  readonly owningSourceCode: string;
  readonly isExclusive: boolean;
  readonly allowManualOverride: boolean;
}

export interface Candidate {
  readonly id: string;
  readonly fieldKey: string;
  readonly valueText: string | null;
  readonly assertsAbsence: boolean;
  readonly sourceSystemCode: string;
  readonly sourceRecordId: string | null;
  readonly sourceField: string | null;
  readonly sourceUpdatedAt: Date | null;
  readonly ingestedAt: Date;
  readonly confidence: number;
  readonly verificationStatus: 'UNVERIFIED' | 'VERIFIED' | 'DISPUTED' | 'REJECTED';
  readonly isSelected: boolean;
}

/** Everything the engine needs, loaded once per unit of work. */
export interface SurvivorshipDeps {
  readonly fields: FieldRegistry;
  readonly rules: RuleSet;
  readonly sourcePriority: ReadonlyMap<string, number>;
  readonly ownership: readonly FieldOwnership[];
}

export class RuleSet {
  readonly #byScope: ReadonlyMap<string, SurvivorshipRule>;

  constructor(rules: readonly SurvivorshipRule[]) {
    this.#byScope = new Map(
      rules.map((rule) => [`${rule.entityType}:${rule.fieldKey ?? '*'}`, rule]),
    );
  }

  /** The rule in force for a field: its own, or its entity type's default. */
  for(entityType: EntityType, fieldKey: string): SurvivorshipRule {
    const specific = this.#byScope.get(`${entityType}:${fieldKey}`);
    if (specific !== undefined) return specific;
    const fallback = this.#byScope.get(`${entityType}:*`);
    if (fallback !== undefined) return fallback;
    throw new Error(
      `No survivorship rule for ${entityType}.${fieldKey} and no default for ` +
        `${entityType}. Every entity type must have a default rule, so that a value ` +
        `is never selected by an unwritten convention.`,
    );
  }
}

export async function loadSurvivorshipDeps(
  tx: DbTransaction,
  fields: FieldRegistry,
): Promise<SurvivorshipDeps> {
  const [ruleRows, sourceRows, ownershipRows] = await Promise.all([
    sql<{
      entity_type: EntityType;
      field_key: string | null;
      strategy: Strategy;
      prefer_verified: boolean;
      allow_absence_to_win: boolean;
      min_confidence: string;
      source_priority: string[];
      version: number;
    }>`SELECT * FROM party.survivorship_rule`.execute(tx),
    sql<{ code: string; default_priority: number }>`
      SELECT code, default_priority FROM kernel.source_system
    `.execute(tx),
    sql<{
      entity_type: EntityType;
      field_key: string;
      operating_company: string | null;
      owning_source_code: string;
      is_exclusive: boolean;
      allow_manual_override: boolean;
    }>`
      SELECT entity_type, field_key, operating_company, owning_source_code,
             is_exclusive, allow_manual_override
        FROM party.field_ownership
       WHERE effective_to IS NULL AND effective_from <= CURRENT_DATE
    `.execute(tx),
  ]);

  return {
    fields,
    rules: new RuleSet(
      ruleRows.rows.map((row) => ({
        entityType: row.entity_type,
        fieldKey: row.field_key ?? undefined,
        strategy: row.strategy,
        preferVerified: row.prefer_verified,
        allowAbsenceToWin: row.allow_absence_to_win,
        minConfidence: Number(row.min_confidence),
        sourcePriority: row.source_priority,
        version: row.version,
      })),
    ),
    sourcePriority: new Map(
      sourceRows.rows.map((row) => [row.code, row.default_priority]),
    ),
    ownership: ownershipRows.rows.map((row) => ({
      entityType: row.entity_type,
      fieldKey: row.field_key,
      operatingCompany: row.operating_company ?? undefined,
      owningSourceCode: row.owning_source_code,
      isExclusive: row.is_exclusive,
      allowManualOverride: row.allow_manual_override,
    })),
  };
}

/**
 * Where a source sits in the order for one rule.
 *
 * Listed sources come first, in the order the rule lists them. Anything unlisted falls
 * back to the registry's default priority, offset past the listed ones — so adding a
 * source system does not require editing every rule, and an unlisted source never
 * silently outranks a listed one.
 */
function priorityOf(
  sourceCode: string,
  rule: SurvivorshipRule,
  defaults: ReadonlyMap<string, number>,
): number {
  const listed = rule.sourcePriority.indexOf(sourceCode);
  if (listed >= 0) return listed;
  return rule.sourcePriority.length + (defaults.get(sourceCode) ?? 1000);
}

interface Decision {
  readonly winner: Candidate | undefined;
  readonly reason: string;
}

/**
 * Choose a winner. Pure: no database, no clock, no identifiers — which is what makes
 * the rule semantics testable without a fixture for every combination.
 */
export function selectWinner(
  candidates: readonly Candidate[],
  rule: SurvivorshipRule,
  defaults: ReadonlyMap<string, number>,
  ownership: FieldOwnership | undefined,
): Decision {
  if (candidates.length === 0) {
    return { winner: undefined, reason: 'No candidate values.' };
  }

  const excluded: string[] = [];
  let eligible = candidates.filter((candidate) => {
    if (candidate.verificationStatus === 'REJECTED') {
      excluded.push(`${candidate.sourceSystemCode} (rejected)`);
      return false;
    }
    if (candidate.confidence < rule.minConfidence) {
      excluded.push(
        `${candidate.sourceSystemCode} (confidence below ${rule.minConfidence})`,
      );
      return false;
    }
    if (candidate.assertsAbsence && !rule.allowAbsenceToWin) {
      excluded.push(`${candidate.sourceSystemCode} (asserts no value)`);
      return false;
    }
    return true;
  });

  // Ownership is a business agreement, not a preference: an owned field is decided by
  // its owner, and everyone else is recorded but cannot win.
  let ownershipNote = '';
  if (ownership !== undefined && ownership.isExclusive) {
    const allowed = new Set([ownership.owningSourceCode]);
    if (ownership.allowManualOverride) allowed.add('MANUAL');
    const owned = eligible.filter((c) => allowed.has(c.sourceSystemCode));
    if (owned.length > 0) {
      eligible = owned;
      ownershipNote =
        ` ${ownership.owningSourceCode} owns this field, so other sources were ` +
        `recorded but could not win.`;
    }
  }

  if (eligible.length === 0) {
    const why = excluded.length > 0 ? ` Excluded: ${excluded.join(', ')}.` : '';
    return { winner: undefined, reason: `No eligible candidate.${why}` };
  }

  const ranked = [...eligible].sort((a, b) => compare(a, b, rule, defaults));
  const winner = ranked[0]!;
  const runnerUp = ranked[1];

  return {
    winner,
    reason: explain(winner, runnerUp, rule, defaults, eligible.length) + ownershipNote,
  };
}

function compare(
  a: Candidate,
  b: Candidate,
  rule: SurvivorshipRule,
  defaults: ReadonlyMap<string, number>,
): number {
  if (rule.preferVerified) {
    const verified = rankVerified(b) - rankVerified(a);
    if (verified !== 0) return verified;
  }

  const byPriority = (): number =>
    priorityOf(a.sourceSystemCode, rule, defaults) -
    priorityOf(b.sourceSystemCode, rule, defaults);

  // Recency is the source's own idea of when the value changed, falling back to when
  // we saw it. Using our ingestion time first would make a full re-import of an old
  // export look like fresh news.
  const byRecency = (): number => effectiveTime(b) - effectiveTime(a);

  const byCompleteness = (): number =>
    (b.valueText?.length ?? 0) - (a.valueText?.length ?? 0);

  let result = 0;
  switch (rule.strategy) {
    case 'PRIORITY':
      result = byPriority() || byRecency();
      break;
    case 'RECENCY':
      result = byRecency() || byPriority();
      break;
    case 'PRIORITY_THEN_RECENCY':
      result = byPriority() || byRecency();
      break;
    case 'MOST_COMPLETE':
      result = byCompleteness() || byPriority() || byRecency();
      break;
  }
  if (result !== 0) return result;

  const byConfidence = b.confidence - a.confidence;
  if (byConfidence !== 0) return byConfidence;

  // The last tiebreak, and the reason this function is deterministic. Candidate
  // identifiers are UUIDv7, so this is stable and roughly creation-ordered.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function rankVerified(candidate: Candidate): number {
  switch (candidate.verificationStatus) {
    case 'VERIFIED':
      return 2;
    case 'UNVERIFIED':
      return 1;
    case 'DISPUTED':
      return 0;
    case 'REJECTED':
      return -1;
  }
}

function effectiveTime(candidate: Candidate): number {
  return (candidate.sourceUpdatedAt ?? candidate.ingestedAt).getTime();
}

/**
 * Say why this candidate won, in terms of the fact that actually decided it.
 *
 * "Priority" is not an explanation a data steward can act on. "P21 outranks PIPEDRIVE
 * for this field" is.
 */
function explain(
  winner: Candidate,
  runnerUp: Candidate | undefined,
  rule: SurvivorshipRule,
  defaults: ReadonlyMap<string, number>,
  eligibleCount: number,
): string {
  if (runnerUp === undefined) {
    return (
      `${winner.sourceSystemCode} is the only eligible source for this field ` +
      `(rule ${rule.strategy}, version ${rule.version}).`
    );
  }

  const others = eligibleCount - 1;
  const context =
    ` Chosen over ${others} other candidate${others === 1 ? '' : 's'} ` +
    `(rule ${rule.strategy}, version ${rule.version}).`;

  if (rule.preferVerified && rankVerified(winner) !== rankVerified(runnerUp)) {
    return (
      `${winner.sourceSystemCode}'s value is ${winner.verificationStatus.toLowerCase()} ` +
      `and ${runnerUp.sourceSystemCode}'s is ${runnerUp.verificationStatus.toLowerCase()}, ` +
      `and this rule prefers verified values.${context}`
    );
  }

  const winnerPriority = priorityOf(winner.sourceSystemCode, rule, defaults);
  const runnerPriority = priorityOf(runnerUp.sourceSystemCode, rule, defaults);

  if (
    rule.strategy === 'MOST_COMPLETE' &&
    (winner.valueText?.length ?? 0) !== (runnerUp.valueText?.length ?? 0)
  ) {
    return `${winner.sourceSystemCode} supplied the most complete value.${context}`;
  }

  if (rule.strategy !== 'RECENCY' && winnerPriority !== runnerPriority) {
    return (
      `${winner.sourceSystemCode} outranks ${runnerUp.sourceSystemCode} for this ` +
      `field.${context}`
    );
  }

  if (effectiveTime(winner) !== effectiveTime(runnerUp)) {
    const when = (winner.sourceUpdatedAt ?? winner.ingestedAt).toISOString();
    const basis = winner.sourceUpdatedAt === null ? 'we saw it' : 'the source changed it';
    return `${winner.sourceSystemCode}'s value is the most recent — ${basis} ${when}.${context}`;
  }

  if (winner.confidence !== runnerUp.confidence) {
    return (
      `${winner.sourceSystemCode}'s value carries the higher confidence ` +
      `(${winner.confidence} against ${runnerUp.confidence}).${context}`
    );
  }

  return (
    `${winner.sourceSystemCode} and ${runnerUp.sourceSystemCode} are indistinguishable ` +
    `under this rule; the older candidate was kept so the choice is stable.${context}`
  );
}

export interface EvaluationResult {
  readonly fieldKey: string;
  readonly winnerId: string | undefined;
  readonly previousWinnerId: string | undefined;
  readonly valueChanged: boolean;
  readonly value: string | null;
  readonly previousValue: string | null;
  readonly reason: string;
}

/**
 * Re-evaluate fields for one entity and materialize the results.
 *
 * The canonical column write and the candidate selection flags happen in the caller's
 * transaction, so a reader never sees a column that disagrees with its own provenance.
 */
export async function evaluateFields(
  uow: UnitOfWork,
  deps: SurvivorshipDeps,
  entityType: EntityType,
  entityId: string,
  fieldKeys: readonly string[],
): Promise<readonly EvaluationResult[]> {
  if (fieldKeys.length === 0) return [];

  const rows = await sql<{
    id: string;
    field_key: string;
    value_text: string | null;
    asserts_absence: boolean;
    source_system_code: string;
    source_record_id: string | null;
    source_field: string | null;
    source_updated_at: Date | null;
    ingested_at: Date;
    confidence: string;
    verification_status: Candidate['verificationStatus'];
    is_selected: boolean;
  }>`
    SELECT id, field_key, value_text, asserts_absence, source_system_code,
           source_record_id, source_field, source_updated_at, ingested_at,
           confidence, verification_status, is_selected
      FROM party.field_candidate
     WHERE entity_type = ${entityType} AND entity_id = ${entityId}::uuid
       AND field_key = ANY(${[...fieldKeys]}::text[])
  `.execute(uow.tx);

  const byField = new Map<string, Candidate[]>();
  for (const row of rows.rows) {
    const candidate: Candidate = {
      id: row.id,
      fieldKey: row.field_key,
      valueText: row.value_text,
      assertsAbsence: row.asserts_absence,
      sourceSystemCode: row.source_system_code,
      sourceRecordId: row.source_record_id,
      sourceField: row.source_field,
      sourceUpdatedAt: row.source_updated_at,
      ingestedAt: row.ingested_at,
      confidence: Number(row.confidence),
      verificationStatus: row.verification_status,
      isSelected: row.is_selected,
    };
    const list = byField.get(row.field_key);
    if (list === undefined) byField.set(row.field_key, [candidate]);
    else list.push(candidate);
  }

  const results: EvaluationResult[] = [];
  const updates = new Map<MasteredField, string | null>();

  for (const fieldKey of fieldKeys) {
    const field = deps.fields.get(entityType, fieldKey);
    const candidates = byField.get(fieldKey) ?? [];
    const rule = deps.rules.for(entityType, fieldKey);
    const ownership = deps.ownership.find(
      (own) => own.entityType === entityType && own.fieldKey === fieldKey,
    );

    const previous = candidates.find((candidate) => candidate.isSelected);
    const { winner, reason } = selectWinner(
      candidates,
      rule,
      deps.sourcePriority,
      ownership,
    );

    const previousValue =
      previous?.assertsAbsence === true ? null : (previous?.valueText ?? null);
    const value = winner?.assertsAbsence === true ? null : (winner?.valueText ?? null);

    if (previous?.id !== winner?.id || previous?.valueText !== winner?.valueText) {
      // Clear first, then set: the partial unique index allows only one selected
      // candidate per field, and a bug here should fail rather than corrupt.
      await sql`
        UPDATE party.field_candidate
           SET is_selected = false, selected_reason = NULL
         WHERE entity_type = ${entityType} AND entity_id = ${entityId}::uuid
           AND field_key = ${fieldKey} AND is_selected
      `.execute(uow.tx);

      if (winner !== undefined) {
        await sql`
          UPDATE party.field_candidate
             SET is_selected = true, selected_reason = ${reason},
                 evaluated_at = now(), rule_version = ${rule.version}
           WHERE id = ${winner.id}::uuid
        `.execute(uow.tx);
      }
      updates.set(field, value);
    } else if (winner !== undefined) {
      // Same winner: refresh the reason and rule version, because a rule change that
      // does not change the outcome still changed why the outcome holds.
      await sql`
        UPDATE party.field_candidate
           SET selected_reason = ${reason}, evaluated_at = now(),
               rule_version = ${rule.version}
         WHERE id = ${winner.id}::uuid
      `.execute(uow.tx);
    }

    results.push({
      fieldKey,
      winnerId: winner?.id,
      previousWinnerId: previous?.id,
      valueChanged: previousValue !== value,
      value,
      previousValue,
      reason,
    });
  }

  await materialize(uow, entityType, entityId, updates);
  return results;
}

/**
 * Write the selected values into the canonical columns.
 *
 * One UPDATE per entity rather than one per field, and the column names come from the
 * registry (validated in migration 0016 against the catalogue, and re-checked by
 * `quoteColumn`). The value is cast to the column's own type by PostgreSQL, so a
 * candidate that is not a valid date fails here rather than being stored as a
 * plausible-looking string somewhere else.
 */
async function materialize(
  uow: UnitOfWork,
  entityType: EntityType,
  entityId: string,
  updates: ReadonlyMap<MasteredField, string | null>,
): Promise<void> {
  if (updates.size === 0) return;

  const table = ENTITY_TABLE[entityType];
  const assignments = [...updates].map(
    ([field, value]) =>
      sql`${sql.raw(quoteColumn(field.columnName))} = ${value}::text::${sql.raw(
        columnCastFor(field),
      )}`,
  );

  await sql`
    UPDATE ${sql.raw(`party.${table}`)}
       SET ${sql.join(assignments, sql`, `)},
           version = version + 1,
           updated_at = now(),
           updated_by = ${uow.context.actor.principalId ?? null}::uuid
     WHERE id = ${entityId}::uuid
  `.execute(uow.tx);
}

function columnCastFor(field: MasteredField): string {
  switch (field.valueType) {
    case 'UUID_REF':
      return 'uuid';
    case 'DATE':
      return 'date';
    case 'BOOLEAN':
      return 'boolean';
    case 'NUMERIC':
      return 'numeric';
    case 'TEXT':
    case 'ENUM':
      return 'text';
  }
}
