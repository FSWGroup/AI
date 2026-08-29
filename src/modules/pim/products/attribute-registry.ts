/**
 * The attribute definitions, loaded from the database.
 *
 * Attributes are data (ADR-0017), so nothing about them is compiled in. This registry
 * is the read side: it knows each attribute's value type, dimension, vocabulary and
 * bounds, and it resolves the incoming shape of a value into the typed columns
 * pim.attribute_value expects.
 */
import { sql } from 'kysely';
import type { Database, DbTransaction } from '../../../platform/db/index.js';

export type ValueType =
  | 'TEXT'
  | 'BOOLEAN'
  | 'INTEGER'
  | 'DECIMAL'
  | 'DATE'
  | 'QUANTITY'
  | 'QUANTITY_RANGE'
  | 'ENUM'
  | 'NOMINAL_SIZE'
  | 'PRESSURE_CLASS'
  | 'ENTITY_REF';

export interface AttributeDefinition {
  readonly key: string;
  readonly name: string;
  readonly valueType: ValueType;
  readonly dimensionCode: string | null;
  readonly defaultUnitCode: string | null;
  readonly vocabularyKey: string | null;
  readonly entityType: string | null;
  readonly cardinality: 'SINGLE' | 'MULTI';
  readonly numericScale: number | null;
  readonly minNumeric: string | null;
  readonly maxNumeric: string | null;
  readonly minLength: number | null;
  readonly maxLength: number | null;
  readonly isFilterable: boolean;
  readonly deprecated: boolean;
}

export interface TermReference {
  readonly id: string;
  readonly code: string;
  readonly vocabularyKey: string;
  readonly label: string;
  readonly isDesignation: boolean;
}

export class UnknownAttributeError extends Error {
  constructor(key: string) {
    super(
      `Unknown attribute '${key}'. Attributes are configuration: add it to ` +
        `config/metadata/attributes and run 'npm run metadata:apply'.`,
    );
    this.name = 'UnknownAttributeError';
  }
}

export class UnknownTermError extends Error {
  constructor(vocabularyKey: string, code: string) {
    super(`Vocabulary '${vocabularyKey}' has no term '${code}'.`);
    this.name = 'UnknownTermError';
  }
}

/**
 * Immutable snapshot of the attribute metadata. Loaded per unit of work rather than
 * cached process-wide: metadata changes are rare, and a stale snapshot would let a
 * value be written against a definition that no longer holds.
 */
export class AttributeRegistry {
  readonly #byKey: ReadonlyMap<string, AttributeDefinition>;
  readonly #termsById: ReadonlyMap<string, TermReference>;
  readonly #termsByCode: ReadonlyMap<string, TermReference>;
  readonly #aliasIndex: ReadonlyMap<string, TermReference>;

  constructor(
    attributes: readonly AttributeDefinition[],
    terms: readonly TermReference[],
    aliases: readonly { normalized: string; vocabularyKey: string; termId: string }[],
  ) {
    this.#byKey = new Map(attributes.map((a) => [a.key, a]));
    this.#termsById = new Map(terms.map((t) => [t.id, t]));
    this.#termsByCode = new Map(terms.map((t) => [`${t.vocabularyKey}:${t.code}`, t]));
    const aliasIndex = new Map<string, TermReference>();
    for (const alias of aliases) {
      const term = this.#termsById.get(alias.termId);
      if (term !== undefined) {
        aliasIndex.set(`${alias.vocabularyKey}:${alias.normalized}`, term);
      }
    }
    this.#aliasIndex = aliasIndex;
  }

  get(key: string): AttributeDefinition {
    const definition = this.#byKey.get(key);
    if (definition === undefined) throw new UnknownAttributeError(key);
    return definition;
  }

  has(key: string): boolean {
    return this.#byKey.has(key);
  }

  all(): readonly AttributeDefinition[] {
    return [...this.#byKey.values()];
  }

  termById(id: string): TermReference | undefined {
    return this.#termsById.get(id);
  }

  /** Resolve a term by its code within a vocabulary. */
  term(vocabularyKey: string, code: string): TermReference {
    const term = this.#termsByCode.get(`${vocabularyKey}:${code}`);
    if (term === undefined) throw new UnknownTermError(vocabularyKey, code);
    return term;
  }

  /**
   * Resolve a term from a spelling seen in source data: exact code first, then a
   * definitive alias. Returns undefined rather than guessing -- an unresolvable value
   * is quarantined, not approximated.
   */
  resolveTerm(vocabularyKey: string, text: string): TermReference | undefined {
    const exact = this.#termsByCode.get(`${vocabularyKey}:${text}`);
    if (exact !== undefined) return exact;
    const normalized = text.replace(/[^a-zA-Z0-9/.-]/g, '').toUpperCase();
    return this.#aliasIndex.get(`${vocabularyKey}:${normalized}`);
  }
}

export async function loadAttributeRegistry(
  db: Database | DbTransaction,
): Promise<AttributeRegistry> {
  const attributes = await sql<{
    key: string;
    name: string;
    value_type: ValueType;
    dimension_code: string | null;
    default_unit_code: string | null;
    vocabulary_key: string | null;
    entity_type: string | null;
    cardinality: 'SINGLE' | 'MULTI';
    numeric_scale: number | null;
    min_numeric: string | null;
    max_numeric: string | null;
    min_length: number | null;
    max_length: number | null;
    is_filterable: boolean;
    deprecated_at: Date | null;
  }>`
    SELECT key, name, value_type, dimension_code, default_unit_code, vocabulary_key,
           entity_type, cardinality, numeric_scale, min_numeric, max_numeric,
           min_length, max_length, is_filterable, deprecated_at
      FROM pim.attribute
  `.execute(db);

  const terms = await sql<{
    id: string;
    code: string;
    vocabulary_key: string;
    label: string;
    is_designation: boolean;
  }>`
    SELECT t.id, t.code, t.vocabulary_key, t.label, v.is_designation
      FROM pim.vocabulary_term t
      JOIN pim.vocabulary v ON v.key = t.vocabulary_key
     WHERE t.deprecated_at IS NULL
  `.execute(db);

  const aliases = await sql<{
    normalized_alias: string;
    vocabulary_key: string;
    term_id: string;
  }>`
    SELECT normalized_alias, vocabulary_key, term_id
      FROM pim.vocabulary_term_alias
     WHERE asserts_equivalence
  `.execute(db);

  return new AttributeRegistry(
    attributes.rows.map((row) => ({
      key: row.key,
      name: row.name,
      valueType: row.value_type,
      dimensionCode: row.dimension_code,
      defaultUnitCode: row.default_unit_code,
      vocabularyKey: row.vocabulary_key,
      entityType: row.entity_type,
      cardinality: row.cardinality,
      numericScale: row.numeric_scale,
      minNumeric: row.min_numeric,
      maxNumeric: row.max_numeric,
      minLength: row.min_length,
      maxLength: row.max_length,
      isFilterable: row.is_filterable,
      deprecated: row.deprecated_at !== null,
    })),
    terms.rows.map((row) => ({
      id: row.id,
      code: row.code,
      vocabularyKey: row.vocabulary_key,
      label: row.label,
      isDesignation: row.is_designation,
    })),
    aliases.rows.map((row) => ({
      normalized: row.normalized_alias,
      vocabularyKey: row.vocabulary_key,
      termId: row.term_id,
    })),
  );
}
