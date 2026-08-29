/**
 * Writing attribute values, and choosing between them (ADR-0011, ADR-0013).
 *
 * Every write is a CANDIDATE attributed to a source, never a direct update of a
 * canonical value. A human editing in the admin UI writes a candidate from the
 * `MANUAL` source; survivorship then runs and normally picks it, because MANUAL
 * outranks every automated source. It wins through the same mechanism as everything
 * else, which is what keeps provenance complete and merges reversible.
 */
import { sql } from 'kysely';
import type { DbTransaction } from '../../../platform/db/index.js';
import { Decimal, roundToScale, type UnitRegistry } from '../units/conversion.js';
import type { AttributeRegistry, AttributeDefinition } from './attribute-registry.js';

export type OwnerLevel = 'LINE' | 'FAMILY' | 'PRODUCT' | 'VARIANT';

export interface ValueOwner {
  readonly level: OwnerLevel;
  readonly id: string;
}

/**
 * A value as a caller supplies it: loosely typed on purpose, because it arrives from
 * an API body, a connector mapping, or a seed file. It is validated into a typed row
 * before it reaches the database.
 */
export interface AttributeValueInput {
  readonly attributeKey: string;
  readonly owner: ValueOwner;
  /** Scalars for most types; `{ value, unit }` for quantities; `{ min, max, unit }` for ranges. */
  readonly value: unknown;
  readonly ordinal?: number;
  readonly sourceSystemCode: string;
  readonly sourceRecordId?: string | undefined;
  readonly sourceField?: string | undefined;
  readonly sourceUpdatedAt?: Date | undefined;
  readonly confidence?: number | undefined;
  readonly verificationStatus?: 'UNVERIFIED' | 'VERIFIED' | 'DISPUTED' | 'REJECTED';
  readonly verifiedBy?: string | undefined;
  readonly validFrom?: string | undefined;
  readonly validTo?: string | undefined;
  /** Exactly what the source said. Defaults to a rendering of `value`. */
  readonly enteredRaw?: string | undefined;
}

export class AttributeValueError extends Error {
  readonly attributeKey: string;
  constructor(attributeKey: string, message: string) {
    super(`Attribute '${attributeKey}': ${message}`);
    this.name = 'AttributeValueError';
    this.attributeKey = attributeKey;
  }
}

interface QuantityInput {
  value: unknown;
  unit?: unknown;
}

interface RangeInput {
  min: unknown;
  max: unknown;
  unit?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The typed shape a value takes in pim.attribute_value. */
export interface PreparedValue {
  readonly valueText: string | null;
  readonly valueBoolean: boolean | null;
  readonly valueNumeric: string | null;
  readonly valueDate: string | null;
  readonly valueTermId: string | null;
  readonly valueVocabularyKey: string | null;
  readonly valueEntityId: string | null;
  readonly valueEntityType: string | null;
  readonly qtyOriginal: string | null;
  readonly qtyOriginalUnit: string | null;
  readonly qtyBase: string | null;
  readonly qtyDimension: string | null;
  readonly qtyMaxOriginal: string | null;
  readonly qtyMaxBase: string | null;
  readonly enteredRaw: string;
}

function decimalFrom(raw: unknown, attribute: AttributeDefinition): Decimal {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      throw new AttributeValueError(attribute.key, 'value is not a finite number');
    }
    return new Decimal(raw);
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      return new Decimal(raw.trim());
    } catch {
      throw new AttributeValueError(attribute.key, `'${raw}' is not a number`);
    }
  }
  throw new AttributeValueError(attribute.key, 'expected a numeric value');
}

function checkBounds(value: Decimal, attribute: AttributeDefinition): void {
  if (attribute.minNumeric !== null && value.lessThan(attribute.minNumeric)) {
    throw new AttributeValueError(
      attribute.key,
      `${value.toString()} is below the minimum ${attribute.minNumeric}`,
    );
  }
  if (attribute.maxNumeric !== null && value.greaterThan(attribute.maxNumeric)) {
    throw new AttributeValueError(
      attribute.key,
      `${value.toString()} is above the maximum ${attribute.maxNumeric}`,
    );
  }
}

/**
 * Validate and normalize one incoming value against its definition.
 *
 * Quantities keep what was entered AND a normalized base value, so a filter expressed
 * in PSI matches a value entered in bar. A quantity with no unit is a validation
 * failure, never an assumption -- unless the attribute declares a default unit, in
 * which case the default is applied explicitly and recorded.
 */
export function prepareValue(
  input: AttributeValueInput,
  attributes: AttributeRegistry,
  units: UnitRegistry,
): PreparedValue {
  const attribute = attributes.get(input.attributeKey);
  if (attribute.deprecated) {
    throw new AttributeValueError(
      attribute.key,
      'is deprecated and no longer accepts values',
    );
  }

  const empty: PreparedValue = {
    valueText: null,
    valueBoolean: null,
    valueNumeric: null,
    valueDate: null,
    valueTermId: null,
    valueVocabularyKey: null,
    valueEntityId: null,
    valueEntityType: null,
    qtyOriginal: null,
    qtyOriginalUnit: null,
    qtyBase: null,
    qtyDimension: null,
    qtyMaxOriginal: null,
    qtyMaxBase: null,
    enteredRaw: input.enteredRaw ?? renderRaw(input.value),
  };

  switch (attribute.valueType) {
    case 'TEXT': {
      if (typeof input.value !== 'string' || input.value === '') {
        throw new AttributeValueError(attribute.key, 'expected a non-empty string');
      }
      if (attribute.minLength !== null && input.value.length < attribute.minLength) {
        throw new AttributeValueError(
          attribute.key,
          `is shorter than the minimum length ${attribute.minLength}`,
        );
      }
      if (attribute.maxLength !== null && input.value.length > attribute.maxLength) {
        throw new AttributeValueError(
          attribute.key,
          `is longer than the maximum length ${attribute.maxLength}`,
        );
      }
      return { ...empty, valueText: input.value };
    }

    case 'BOOLEAN': {
      if (typeof input.value !== 'boolean') {
        throw new AttributeValueError(attribute.key, 'expected true or false');
      }
      return { ...empty, valueBoolean: input.value };
    }

    case 'INTEGER': {
      const value = decimalFrom(input.value, attribute);
      if (!value.isInteger()) {
        throw new AttributeValueError(
          attribute.key,
          `${value.toString()} is not an integer`,
        );
      }
      checkBounds(value, attribute);
      return { ...empty, valueNumeric: value.toString() };
    }

    case 'DECIMAL': {
      const value = roundToScale(
        decimalFrom(input.value, attribute),
        attribute.numericScale,
      );
      checkBounds(value, attribute);
      return { ...empty, valueNumeric: value.toString() };
    }

    case 'DATE': {
      if (typeof input.value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.value)) {
        throw new AttributeValueError(attribute.key, 'expected a date as YYYY-MM-DD');
      }
      return { ...empty, valueDate: input.value };
    }

    case 'ENUM':
    case 'NOMINAL_SIZE':
    case 'PRESSURE_CLASS': {
      const vocabularyKey = attribute.vocabularyKey!;
      if (typeof input.value !== 'string' || input.value === '') {
        throw new AttributeValueError(
          attribute.key,
          `expected a term code from vocabulary '${vocabularyKey}'`,
        );
      }
      const term = attributes.resolveTerm(vocabularyKey, input.value);
      if (term === undefined) {
        throw new AttributeValueError(
          attribute.key,
          `'${input.value}' does not resolve to a term in vocabulary '${vocabularyKey}'. ` +
            `Add it, or add an alias for it, rather than storing an unrecognised string.`,
        );
      }
      return { ...empty, valueTermId: term.id, valueVocabularyKey: vocabularyKey };
    }

    case 'QUANTITY': {
      const { value: rawValue, unit } = readQuantity(input.value, attribute);
      const magnitude = roundToScale(
        decimalFrom(rawValue, attribute),
        attribute.numericScale,
      );
      checkBounds(magnitude, attribute);
      const unitCode = resolveUnit(unit, attribute, units);
      const base = units.toBase(magnitude, unitCode);
      if (base.dimension !== attribute.dimensionCode) {
        throw new AttributeValueError(
          attribute.key,
          `unit '${unitCode}' measures ${base.dimension}, but this attribute is ` +
            `${attribute.dimensionCode}`,
        );
      }
      return {
        ...empty,
        qtyOriginal: magnitude.toString(),
        qtyOriginalUnit: unitCode,
        qtyBase: base.value.toString(),
        qtyDimension: base.dimension,
        enteredRaw: input.enteredRaw ?? `${magnitude.toString()} ${unitCode}`,
      };
    }

    case 'QUANTITY_RANGE': {
      if (!isRecord(input.value)) {
        throw new AttributeValueError(attribute.key, 'expected { min, max, unit }');
      }
      const range = input.value as unknown as RangeInput;
      const unitCode = resolveUnit(range.unit, attribute, units);
      const min = roundToScale(decimalFrom(range.min, attribute), attribute.numericScale);
      const max = roundToScale(decimalFrom(range.max, attribute), attribute.numericScale);
      if (min.greaterThan(max)) {
        throw new AttributeValueError(
          attribute.key,
          `range minimum ${min.toString()} is above its maximum ${max.toString()}`,
        );
      }
      checkBounds(min, attribute);
      checkBounds(max, attribute);
      const baseMin = units.toBase(min, unitCode);
      const baseMax = units.toBase(max, unitCode);
      return {
        ...empty,
        qtyOriginal: min.toString(),
        qtyMaxOriginal: max.toString(),
        qtyOriginalUnit: unitCode,
        qtyBase: baseMin.value.toString(),
        qtyMaxBase: baseMax.value.toString(),
        qtyDimension: baseMin.dimension,
        enteredRaw:
          input.enteredRaw ?? `${min.toString()}..${max.toString()} ${unitCode}`,
      };
    }

    case 'ENTITY_REF': {
      if (typeof input.value !== 'string' || input.value === '') {
        throw new AttributeValueError(attribute.key, 'expected an entity identifier');
      }
      return {
        ...empty,
        valueEntityId: input.value,
        valueEntityType: attribute.entityType,
      };
    }

    default: {
      const unhandled: never = attribute.valueType;
      throw new Error(`Unhandled value type ${String(unhandled)}`);
    }
  }
}

function readQuantity(value: unknown, attribute: AttributeDefinition): QuantityInput {
  if (isRecord(value)) return value as unknown as QuantityInput;
  // A bare number is accepted only when the attribute declares a default unit, and
  // even then the unit is recorded explicitly rather than left implied.
  if (attribute.defaultUnitCode !== null)
    return { value, unit: attribute.defaultUnitCode };
  throw new AttributeValueError(
    attribute.key,
    'expected { value, unit }. A bare number is a validation failure where units ' +
      'matter, not something to guess at (spec §31).',
  );
}

function resolveUnit(
  unit: unknown,
  attribute: AttributeDefinition,
  units: UnitRegistry,
): string {
  if (unit === undefined || unit === null || unit === '') {
    if (attribute.defaultUnitCode !== null) return attribute.defaultUnitCode;
    throw new AttributeValueError(
      attribute.key,
      'a unit is required and none was supplied',
    );
  }
  if (typeof unit !== 'string') {
    throw new AttributeValueError(attribute.key, 'unit must be a string');
  }
  const resolved = units.resolve(unit);
  if (resolved === undefined) {
    throw new AttributeValueError(
      attribute.key,
      `'${unit}' does not resolve to a known unit. Units are configuration: add it to ` +
        `config/metadata/units.yaml rather than converting by hand.`,
    );
  }
  return resolved.code;
}

function renderRaw(value: unknown): string {
  if (typeof value === 'string') return value;
  if (isRecord(value)) return JSON.stringify(value);
  return String(value);
}

const OWNER_COLUMN: Record<OwnerLevel, string> = {
  LINE: 'product_line_id',
  FAMILY: 'product_family_id',
  PRODUCT: 'product_id',
  VARIANT: 'variant_id',
};

/** Insert one candidate value. Returns its identifier. */
export async function insertAttributeValue(
  tx: DbTransaction,
  input: AttributeValueInput,
  prepared: PreparedValue,
  attributes: AttributeRegistry,
  actorId: string | null,
): Promise<string> {
  const attribute = attributes.get(input.attributeKey);
  const ownerColumn = OWNER_COLUMN[input.owner.level];

  const result = await sql<{ id: string }>`
    INSERT INTO pim.attribute_value (
      attribute_key, value_type, cardinality, ${sql.raw(ownerColumn)},
      value_text, value_boolean, value_numeric, value_date,
      value_term_id, value_vocabulary_key, value_entity_id, value_entity_type,
      value_qty_original, value_qty_original_unit, value_qty_base, value_qty_dimension,
      value_qty_max_original, value_qty_max_base,
      entered_raw, ordinal,
      source_system_code, source_record_id, source_field, source_updated_at,
      confidence, verification_status, verified_by, verified_at,
      valid_from, valid_to, created_by
    ) VALUES (
      ${attribute.key}, ${attribute.valueType}, ${attribute.cardinality}, ${input.owner.id},
      ${prepared.valueText}, ${prepared.valueBoolean}, ${prepared.valueNumeric}::numeric,
      ${prepared.valueDate}::date,
      ${prepared.valueTermId}::uuid, ${prepared.valueVocabularyKey},
      ${prepared.valueEntityId}::uuid, ${prepared.valueEntityType},
      ${prepared.qtyOriginal}::numeric, ${prepared.qtyOriginalUnit},
      ${prepared.qtyBase}::numeric, ${prepared.qtyDimension},
      ${prepared.qtyMaxOriginal}::numeric, ${prepared.qtyMaxBase}::numeric,
      ${prepared.enteredRaw}, ${input.ordinal ?? 0},
      ${input.sourceSystemCode}, ${input.sourceRecordId ?? null}::uuid,
      ${input.sourceField ?? null}, ${input.sourceUpdatedAt ?? null}::timestamptz,
      ${input.confidence ?? 1}::numeric, ${input.verificationStatus ?? 'UNVERIFIED'},
      ${input.verifiedBy ?? null}::uuid,
      ${input.verificationStatus === 'VERIFIED' ? sql`now()` : null},
      ${input.validFrom ?? sql`CURRENT_DATE`}::date, ${input.validTo ?? null}::date,
      ${actorId}::uuid
    )
    RETURNING id
  `.execute(tx);

  return result.rows[0]!.id;
}

/**
 * Recompute which candidate wins, for the given owners and attributes (ADR-0011).
 *
 * Precedence: a verified value first, then source priority (lower wins), then
 * confidence, then how recently the source itself said it, then ingestion order. The
 * reason is stored in plain language, because acceptance criterion 10 asks the system
 * to explain *why* a value won, not merely which one did.
 *
 * Losing candidates are never deleted. They stay queryable as evidence of what each
 * source asserted.
 */
export async function recomputeSelection(
  tx: DbTransaction,
  ownerKeys: readonly string[],
  attributeKeys?: readonly string[],
): Promise<number> {
  if (ownerKeys.length === 0) return 0;
  const attributeFilter = attributeKeys ?? null;

  // Clear first: the exclusion constraint permits only one selected value per period,
  // so a new winner cannot be marked while the old one still holds the slot.
  await sql`
    UPDATE pim.attribute_value
       SET is_selected = false, selected_reason = NULL, selected_at = NULL
     WHERE owner_key = ANY(${ownerKeys}::text[])
       AND (${attributeFilter}::text[] IS NULL OR attribute_key = ANY(${attributeFilter}::text[]))
       AND is_selected
  `.execute(tx);

  const result = await sql<{ id: string }>`
    WITH candidates AS (
      SELECT av.id,
             av.owner_key,
             av.attribute_key,
             av.ordinal,
             av.source_system_code,
             av.verification_status,
             ss.default_priority,
             count(*) OVER (PARTITION BY av.owner_key, av.attribute_key, av.ordinal) AS candidate_count,
             row_number() OVER (
               PARTITION BY av.owner_key, av.attribute_key, av.ordinal
               ORDER BY (av.verification_status = 'VERIFIED') DESC,
                        ss.default_priority ASC,
                        av.confidence DESC,
                        av.source_updated_at DESC NULLS LAST,
                        av.ingested_at DESC,
                        av.id DESC
             ) AS rank
        FROM pim.attribute_value av
        JOIN kernel.source_system ss ON ss.code = av.source_system_code
       WHERE av.owner_key = ANY(${ownerKeys}::text[])
         AND (${attributeFilter}::text[] IS NULL
              OR av.attribute_key = ANY(${attributeFilter}::text[]))
         AND av.verification_status <> 'REJECTED'
         AND av.valid_from <= CURRENT_DATE
         AND (av.valid_to IS NULL OR av.valid_to > CURRENT_DATE)
    )
    UPDATE pim.attribute_value av
       SET is_selected = true,
           selected_at = now(),
           selected_reason = CASE
             WHEN c.candidate_count = 1
               THEN format('only candidate (source %s)', c.source_system_code)
             WHEN c.verification_status = 'VERIFIED'
               THEN format('verified value from %s, chosen over %s other candidate(s)',
                           c.source_system_code, c.candidate_count - 1)
             ELSE format('source %s has the highest precedence (%s) of %s candidate(s)',
                         c.source_system_code, c.default_priority, c.candidate_count)
           END
      FROM candidates c
     WHERE av.id = c.id AND c.rank = 1
    RETURNING av.id
  `.execute(tx);

  return result.rows.length;
}
