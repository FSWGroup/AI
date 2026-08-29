/**
 * The mastered-field registry (ADR-0011).
 *
 * Loaded from `party.mastered_field` rather than hard-coded, so there is one
 * declaration of which columns are survivorship outputs. Loaded per unit of work
 * rather than cached process-wide: a stale snapshot would let a value be written
 * against a definition that no longer holds.
 */
import { sql } from 'kysely';
import type { Database, DbTransaction } from '../../platform/db/index.js';

export type EntityType = 'ORGANIZATION' | 'SITE' | 'LOCATION' | 'PERSON';
export type FieldValueType =
  'TEXT' | 'ENUM' | 'UUID_REF' | 'DATE' | 'BOOLEAN' | 'NUMERIC';
export type Classification = 'PUBLIC' | 'INTERNAL' | 'PII' | 'SECRET';

export interface MasteredField {
  readonly entityType: EntityType;
  readonly fieldKey: string;
  readonly columnName: string;
  readonly valueType: FieldValueType;
  readonly classification: Classification;
  readonly description: string;
  readonly isMastered: boolean;
}

/** Which table each entity type materializes into. Frozen, not derived from input. */
export const ENTITY_TABLE: Readonly<Record<EntityType, string>> = Object.freeze({
  ORGANIZATION: 'organization',
  SITE: 'site',
  LOCATION: 'location',
  PERSON: 'person',
});

export class UnknownFieldError extends Error {
  constructor(entityType: string, fieldKey: string) {
    super(
      `'${fieldKey}' is not a mastered field of ${entityType}. Mastered fields are ` +
        `declared in party.mastered_field; adding one means adding a column, which ` +
        `means a migration (ADR-0011).`,
    );
    this.name = 'UnknownFieldError';
  }
}

export class FieldRegistry {
  readonly #byEntityAndKey: ReadonlyMap<string, MasteredField>;

  constructor(fields: readonly MasteredField[]) {
    this.#byEntityAndKey = new Map(
      fields.map((field) => [`${field.entityType}:${field.fieldKey}`, field]),
    );
  }

  get(entityType: EntityType, fieldKey: string): MasteredField {
    const field = this.#byEntityAndKey.get(`${entityType}:${fieldKey}`);
    if (field === undefined) throw new UnknownFieldError(entityType, fieldKey);
    return field;
  }

  has(entityType: EntityType, fieldKey: string): boolean {
    return this.#byEntityAndKey.has(`${entityType}:${fieldKey}`);
  }

  forEntity(entityType: EntityType): readonly MasteredField[] {
    return [...this.#byEntityAndKey.values()].filter(
      (field) => field.entityType === entityType && field.isMastered,
    );
  }
}

export async function loadFieldRegistry(
  db: Database | DbTransaction,
): Promise<FieldRegistry> {
  const result = await sql<{
    entity_type: EntityType;
    field_key: string;
    column_name: string;
    value_type: FieldValueType;
    classification: Classification;
    description: string;
    is_mastered: boolean;
  }>`
    SELECT entity_type, field_key, column_name, value_type, classification,
           description, is_mastered
      FROM party.mastered_field
     ORDER BY entity_type, sort_ordinal, field_key
  `.execute(db);

  return new FieldRegistry(
    result.rows.map((row) => ({
      entityType: row.entity_type,
      fieldKey: row.field_key,
      columnName: row.column_name,
      valueType: row.value_type,
      classification: row.classification,
      description: row.description,
      isMastered: row.is_mastered,
    })),
  );
}

/**
 * Quote a column name from the registry for use in SQL.
 *
 * The name comes from a migration-seeded registry, never from a request, and the
 * migration verifies every entry against the catalogue. This is belt and braces on
 * top of that: an identifier that is not a plain lowercase name is refused rather
 * than escaped, because there is no legitimate reason for one to appear here.
 */
export function quoteColumn(columnName: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(columnName)) {
    throw new Error(
      `Refusing to use '${columnName}' as a column name. Mastered field columns are ` +
        `plain lowercase identifiers; anything else means the registry has been ` +
        `tampered with.`,
    );
  }
  return `"${columnName}"`;
}
