/**
 * Asserting candidate values (ADR-0011).
 *
 * This is the only way a mastered field changes. There is deliberately no function
 * anywhere that writes `party.organization.legal_name` directly, including for a human
 * editing in the admin UI: that edit is a candidate attributed to MANUAL, with an
 * actor and a reason, and survivorship then runs.
 *
 * It is worth being blunt about why, because the indirection looks gratuitous until
 * you need it. If a merge overwrote canonical columns, an unmerge would have to
 * reconstruct the previous state from audit logs — which the specification forbids as
 * an implementation of unmerge, and rightly: an audit log is evidence, not a backup.
 */
import { sql } from 'kysely';
import type { UnitOfWork } from '../../kernel/unit-of-work.js';
import { ValidationError } from '../../platform/errors.js';
import type { EntityType, FieldRegistry } from './fields.js';

export type VerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'DISPUTED' | 'REJECTED';

export interface CandidateInput {
  readonly fieldKey: string;
  /**
   * The value the source asserts. `null` means the source is SILENT about this field
   * and no candidate is written. To record a source positively asserting that there
   * is no value, set `assertsAbsence` — a CRM that clears a phone number is making a
   * claim, and conflating that with silence loses it.
   */
  readonly value?: string | null | undefined;
  readonly assertsAbsence?: boolean;
  readonly sourceSystemCode: string;
  readonly sourceRecordId?: string | undefined;
  readonly sourceField?: string | undefined;
  readonly sourceUpdatedAt?: Date | undefined;
  readonly confidence?: number;
  readonly verificationStatus?: VerificationStatus;
  readonly verifiedBy?: string | undefined;
  /** Required on a MANUAL candidate: why a person is asserting this. */
  readonly reason?: string | undefined;
}

/**
 * Record what a source says about one or more fields.
 *
 * Returns the field keys actually touched, which is what the caller passes to
 * `evaluateFields` — re-evaluating fields nobody asserted is wasted work and produces
 * confusing "nothing changed" reasons.
 */
export async function assertCandidates(
  uow: UnitOfWork,
  fields: FieldRegistry,
  entityType: EntityType,
  entityId: string,
  candidates: readonly CandidateInput[],
): Promise<readonly string[]> {
  const touched: string[] = [];

  for (const candidate of candidates) {
    const field = fields.get(entityType, candidate.fieldKey);
    if (!field.isMastered) {
      throw new ValidationError(
        `'${candidate.fieldKey}' is not mastered from sources, so a candidate value ` +
          `for it would never be used.`,
      );
    }

    const assertsAbsence = candidate.assertsAbsence === true;
    const value = assertsAbsence ? null : (candidate.value ?? null);

    // Silence is not a claim. A source that simply has no column for a field must not
    // leave a row saying it asserted nothing, because the divergence report would then
    // show a disagreement that no source is actually having.
    if (value === null && !assertsAbsence) continue;

    if (candidate.sourceSystemCode === 'MANUAL' && (candidate.reason ?? '') === '') {
      throw new ValidationError(
        `A manual value needs a reason. It is recorded on the candidate and shown ` +
          `beside the value, so that "why is this the name?" has an answer six months ` +
          `from now.`,
      );
    }

    const confidence = candidate.confidence ?? 1;
    if (confidence < 0 || confidence > 1) {
      throw new ValidationError(`Confidence must be between 0 and 1, not ${confidence}.`);
    }

    const status = candidate.verificationStatus ?? 'UNVERIFIED';

    await sql`
      INSERT INTO party.field_candidate
        (id, entity_type, entity_id, field_key, value_text, asserts_absence,
         source_system_code, source_record_id, source_field, source_updated_at,
         confidence, verification_status, verified_at, verified_by,
         actor_principal_id, reason)
      VALUES (${uow.ids.next()}, ${entityType}, ${entityId}::uuid, ${candidate.fieldKey},
              ${value}, ${assertsAbsence}, ${candidate.sourceSystemCode},
              ${candidate.sourceRecordId ?? null}::uuid, ${candidate.sourceField ?? null},
              ${candidate.sourceUpdatedAt ?? null}::timestamptz, ${confidence}, ${status},
              ${status === 'VERIFIED' ? sql`now()` : null},
              ${candidate.verifiedBy ?? null}::uuid,
              ${uow.context.actor.principalId ?? null}::uuid, ${candidate.reason ?? null})
      ON CONFLICT (entity_type, entity_id, field_key, source_system_code,
                   coalesce(source_record_id, '00000000-0000-0000-0000-000000000000'::uuid),
                   coalesce(source_field, ''))
      DO UPDATE SET
        value_text = EXCLUDED.value_text,
        asserts_absence = EXCLUDED.asserts_absence,
        source_updated_at = EXCLUDED.source_updated_at,
        ingested_at = now(),
        confidence = EXCLUDED.confidence,
        verification_status = EXCLUDED.verification_status,
        verified_at = EXCLUDED.verified_at,
        verified_by = EXCLUDED.verified_by,
        actor_principal_id = EXCLUDED.actor_principal_id,
        reason = EXCLUDED.reason
    `.execute(uow.tx);

    touched.push(candidate.fieldKey);
  }

  return [...new Set(touched)];
}

export interface ProvenanceEntry {
  readonly candidateId: string;
  readonly fieldKey: string;
  readonly value: string | null;
  readonly assertsAbsence: boolean;
  readonly sourceSystemCode: string;
  readonly sourceRecordId: string | null;
  readonly sourceField: string | null;
  readonly sourceUpdatedAt: Date | null;
  readonly ingestedAt: Date;
  readonly confidence: number;
  readonly verificationStatus: VerificationStatus;
  readonly isSelected: boolean;
  readonly selectedReason: string | null;
  readonly ruleVersion: number | null;
  readonly reason: string | null;
}

/**
 * Answer "why does this field have this value" — the winner first, then everything
 * that lost, with where each came from. Acceptance criterion 10 is this query plus a
 * screen that renders it.
 */
export async function readProvenance(
  uow: UnitOfWork,
  entityType: EntityType,
  entityId: string,
  fieldKey?: string,
): Promise<readonly ProvenanceEntry[]> {
  const result = await sql<{
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
    verification_status: VerificationStatus;
    is_selected: boolean;
    selected_reason: string | null;
    rule_version: number | null;
    reason: string | null;
  }>`
    SELECT id, field_key, value_text, asserts_absence, source_system_code,
           source_record_id, source_field, source_updated_at, ingested_at, confidence,
           verification_status, is_selected, selected_reason, rule_version, reason
      FROM party.field_candidate
     WHERE entity_type = ${entityType} AND entity_id = ${entityId}::uuid
       AND (${fieldKey ?? null}::text IS NULL OR field_key = ${fieldKey ?? null})
     ORDER BY field_key, is_selected DESC, ingested_at DESC
  `.execute(uow.tx);

  return result.rows.map((row) => ({
    candidateId: row.id,
    fieldKey: row.field_key,
    value: row.value_text,
    assertsAbsence: row.asserts_absence,
    sourceSystemCode: row.source_system_code,
    sourceRecordId: row.source_record_id,
    sourceField: row.source_field,
    sourceUpdatedAt: row.source_updated_at,
    ingestedAt: row.ingested_at,
    confidence: Number(row.confidence),
    verificationStatus: row.verification_status,
    isSelected: row.is_selected,
    selectedReason: row.selected_reason,
    ruleVersion: row.rule_version,
    reason: row.reason,
  }));
}
