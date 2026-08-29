/**
 * Apply validated metadata to the database (ADR-0017).
 *
 * Idempotent: applying the same configuration twice changes nothing. Additive by
 * default: an attribute or term that disappears from configuration is deprecated,
 * never deleted, because values already recorded against it remain meaningful.
 *
 * Destructive changes -- narrowing an attribute's value type, changing its dimension
 * or vocabulary, or tightening MULTI to SINGLE while values exist -- are refused
 * unless explicitly allowed, because they silently reinterpret data that is already
 * in the system.
 */
import { sql } from 'kysely';
import type { Database, DbTransaction } from '../../../platform/db/index.js';
import { normalizeAlias } from '../units/conversion.js';
import type { ParsedMetadata } from './reader.js';

/**
 * Several spellings of one alias can normalize to the same lookup key -- `1/2` and
 * `1/2"` both become `1/2`. Keeping both in configuration is useful documentation of
 * what source data looks like, but the database stores lookup keys, so the loader
 * keeps the first of each normalized form. Aliases that normalize to nothing at all
 * (a bare quote mark, say) are dropped: they would match everything.
 */
function dedupeByNormalizedForm<T>(
  items: readonly T[],
  aliasOf: (item: T) => string,
): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const item of items) {
    const normalized = normalizeAlias(aliasOf(item));
    if (normalized === '' || seen.has(normalized)) continue;
    seen.add(normalized);
    kept.push(item);
  }
  return kept;
}

export type ChangeKind = 'INSERT' | 'UPDATE' | 'DEPRECATE' | 'ORPHAN';

export interface MetadataChange {
  readonly kind: ChangeKind;
  readonly entity: string;
  readonly key: string;
  readonly detail?: string;
}

export interface MetadataApplyReport {
  readonly changes: readonly MetadataChange[];
  readonly breaking: readonly string[];
  readonly contentHash: string;
  readonly applied: boolean;
  readonly unchanged: boolean;
  readonly versionId: string | undefined;
}

export interface MetadataApplyOptions {
  readonly actor: string;
  /** Permit changes that reinterpret existing values. Requires a migration plan. */
  readonly allowBreaking?: boolean;
  /** Validate and report without writing. */
  readonly dryRun?: boolean;
  readonly note?: string;
}

export class BreakingMetadataChangeError extends Error {
  readonly breaking: readonly string[];
  constructor(breaking: readonly string[]) {
    super(
      `Refusing to apply metadata: these changes would reinterpret data that already ` +
        `exists.\n${breaking.map((b) => `  - ${b}`).join('\n')}\n\n` +
        `If this is intended, plan the data migration first, then re-run with ` +
        `--allow-breaking.`,
    );
    this.name = 'BreakingMetadataChangeError';
    this.breaking = breaking;
  }
}

/**
 * How many values already reference an attribute. Guarded with to_regclass so this
 * works before pim.attribute_value exists (it arrives in the next phase) and after.
 */
async function attributeValueCount(
  tx: DbTransaction,
  attributeKey: string,
): Promise<number> {
  const exists = await sql<{ present: string | null }>`
    SELECT to_regclass('pim.attribute_value')::text AS present
  `.execute(tx);
  if (exists.rows[0]?.present === null || exists.rows[0]?.present === undefined) return 0;
  const counted = await sql<{ count: string }>`
    SELECT count(*)::text AS count FROM pim.attribute_value WHERE attribute_key = ${attributeKey}
  `.execute(tx);
  return Number(counted.rows[0]?.count ?? '0');
}

export async function applyMetadata(
  db: Database,
  parsed: ParsedMetadata,
  options: MetadataApplyOptions,
): Promise<MetadataApplyReport> {
  return db.transaction().execute(async (tx) => {
    const changes: MetadataChange[] = [];
    const breaking: string[] = [];

    const alreadyApplied = await sql<{ content_hash: string }>`
      SELECT content_hash FROM pim.metadata_version ORDER BY applied_at DESC LIMIT 1
    `.execute(tx);
    const unchanged = alreadyApplied.rows[0]?.content_hash === parsed.contentHash;

    await applyDimensions(tx, parsed, changes);
    await applyUnits(tx, parsed, changes);
    await applyVocabularies(tx, parsed, changes);
    await applyTerms(tx, parsed, changes);
    await applyAttributes(tx, parsed, changes, breaking);
    await applyProductTypes(tx, parsed, changes);
    await applyProductTypeAttributes(tx, parsed, changes);

    if (breaking.length > 0 && options.allowBreaking !== true) {
      throw new BreakingMetadataChangeError(breaking);
    }

    if (options.dryRun === true) {
      // Roll the transaction back by throwing a sentinel the caller unwraps.
      throw new DryRunComplete({
        changes,
        breaking,
        contentHash: parsed.contentHash,
        applied: false,
        unchanged,
        versionId: undefined,
      });
    }

    const summary = summarise(changes);
    const inserted = await sql<{ id: string }>`
      INSERT INTO pim.metadata_version (applied_by, content_hash, file_count, summary, note)
      VALUES (
        ${options.actor}, ${parsed.contentHash}, ${parsed.fileCount},
        ${JSON.stringify(summary)}::jsonb, ${options.note ?? null}
      )
      RETURNING id
    `.execute(tx);

    return {
      changes,
      breaking,
      contentHash: parsed.contentHash,
      applied: true,
      unchanged,
      versionId: inserted.rows[0]?.id,
    };
  });
}

/** Thrown to roll back a dry run. Not an error condition; the caller unwraps it. */
export class DryRunComplete extends Error {
  readonly report: MetadataApplyReport;
  constructor(report: MetadataApplyReport) {
    super('metadata dry run complete');
    this.name = 'DryRunComplete';
    this.report = report;
  }
}

/** Run a dry run and return the report rather than throwing. */
export async function planMetadata(
  db: Database,
  parsed: ParsedMetadata,
  options: MetadataApplyOptions,
): Promise<MetadataApplyReport> {
  try {
    return await applyMetadata(db, parsed, {
      ...options,
      dryRun: true,
      allowBreaking: true,
    });
  } catch (error) {
    if (error instanceof DryRunComplete) return error.report;
    throw error;
  }
}

function summarise(changes: readonly MetadataChange[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const change of changes) {
    const key = `${change.entity}.${change.kind.toLowerCase()}`;
    summary[key] = (summary[key] ?? 0) + 1;
  }
  return summary;
}

async function applyDimensions(
  tx: DbTransaction,
  parsed: ParsedMetadata,
  changes: MetadataChange[],
): Promise<void> {
  for (const dimension of parsed.dimensions) {
    const result = await sql<{ inserted: boolean }>`
      INSERT INTO pim.quantity_dimension (code, name, description)
      VALUES (${dimension.code}, ${dimension.name}, ${dimension.description})
      ON CONFLICT (code) DO UPDATE
        SET name = EXCLUDED.name, description = EXCLUDED.description
      WHERE pim.quantity_dimension.name IS DISTINCT FROM EXCLUDED.name
         OR pim.quantity_dimension.description IS DISTINCT FROM EXCLUDED.description
      RETURNING (xmax = 0) AS inserted
    `.execute(tx);
    const row = result.rows[0];
    if (row !== undefined) {
      changes.push({
        kind: row.inserted ? 'INSERT' : 'UPDATE',
        entity: 'dimension',
        key: dimension.code,
      });
    }
  }
}

async function applyUnits(
  tx: DbTransaction,
  parsed: ParsedMetadata,
  changes: MetadataChange[],
): Promise<void> {
  for (const unit of parsed.units) {
    const result = await sql<{ inserted: boolean }>`
      INSERT INTO pim.unit
        (code, dimension_code, name, symbol, factor_to_base, offset_to_base, is_base, sort_order)
      VALUES (
        ${unit.code}, ${unit.dimension}, ${unit.name}, ${unit.symbol},
        ${unit.factorToBase}::numeric, ${unit.offsetToBase ?? '0'}::numeric,
        ${unit.isBase ?? false}, ${unit.sortOrder ?? 100}
      )
      ON CONFLICT (code) DO UPDATE SET
        dimension_code = EXCLUDED.dimension_code,
        name = EXCLUDED.name,
        symbol = EXCLUDED.symbol,
        factor_to_base = EXCLUDED.factor_to_base,
        offset_to_base = EXCLUDED.offset_to_base,
        is_base = EXCLUDED.is_base,
        sort_order = EXCLUDED.sort_order
      WHERE pim.unit.dimension_code IS DISTINCT FROM EXCLUDED.dimension_code
         OR pim.unit.name IS DISTINCT FROM EXCLUDED.name
         OR pim.unit.symbol IS DISTINCT FROM EXCLUDED.symbol
         OR pim.unit.factor_to_base IS DISTINCT FROM EXCLUDED.factor_to_base
         OR pim.unit.offset_to_base IS DISTINCT FROM EXCLUDED.offset_to_base
         OR pim.unit.is_base IS DISTINCT FROM EXCLUDED.is_base
         OR pim.unit.sort_order IS DISTINCT FROM EXCLUDED.sort_order
      RETURNING (xmax = 0) AS inserted
    `.execute(tx);
    const row = result.rows[0];
    if (row !== undefined) {
      changes.push({
        kind: row.inserted ? 'INSERT' : 'UPDATE',
        entity: 'unit',
        key: unit.code,
        ...(row.inserted ? {} : { detail: 'definition changed' }),
      });
    }

    // Aliases are a set, so replace rather than merge: removing one from
    // configuration must remove it from the database.
    await sql`DELETE FROM pim.unit_alias WHERE unit_code = ${unit.code}`.execute(tx);
    for (const alias of dedupeByNormalizedForm(unit.aliases ?? [], (a) => a)) {
      await sql`
        INSERT INTO pim.unit_alias (unit_code, alias) VALUES (${unit.code}, ${alias})
        ON CONFLICT DO NOTHING
      `.execute(tx);
    }
  }
}

async function applyVocabularies(
  tx: DbTransaction,
  parsed: ParsedMetadata,
  changes: MetadataChange[],
): Promise<void> {
  for (const vocabulary of parsed.vocabularies) {
    const result = await sql<{ inserted: boolean }>`
      INSERT INTO pim.vocabulary (key, name, description, is_designation, designation_kind)
      VALUES (
        ${vocabulary.key}, ${vocabulary.name}, ${vocabulary.description},
        ${vocabulary.isDesignation ?? false}, ${vocabulary.designationKind ?? null}
      )
      ON CONFLICT (key) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        is_designation = EXCLUDED.is_designation,
        designation_kind = EXCLUDED.designation_kind
      RETURNING (xmax = 0) AS inserted
    `.execute(tx);
    if (result.rows[0]?.inserted === true) {
      changes.push({ kind: 'INSERT', entity: 'vocabulary', key: vocabulary.key });
    }
  }
}

async function applyTerms(
  tx: DbTransaction,
  parsed: ParsedMetadata,
  changes: MetadataChange[],
): Promise<void> {
  for (const vocabulary of parsed.vocabularies) {
    // First pass without parents, so a term may reference a sibling defined later.
    for (const term of vocabulary.terms) {
      const result = await sql<{ inserted: boolean }>`
        INSERT INTO pim.vocabulary_term
          (vocabulary_key, code, label, description, sort_ordinal,
           size_system, designation, reference_standard, deprecated_at)
        VALUES (
          ${vocabulary.key}, ${term.code}, ${term.label}, ${term.description ?? null},
          ${term.sortOrdinal ?? null}::numeric, ${term.sizeSystem ?? null},
          ${term.designation ?? null}, ${term.referenceStandard ?? null},
          ${term.deprecated === true ? sql`now()` : null}
        )
        ON CONFLICT (vocabulary_key, code) DO UPDATE SET
          label = EXCLUDED.label,
          description = EXCLUDED.description,
          sort_ordinal = EXCLUDED.sort_ordinal,
          size_system = EXCLUDED.size_system,
          designation = EXCLUDED.designation,
          reference_standard = EXCLUDED.reference_standard,
          deprecated_at = EXCLUDED.deprecated_at
        RETURNING (xmax = 0) AS inserted
      `.execute(tx);
      if (result.rows[0]?.inserted === true) {
        changes.push({
          kind: 'INSERT',
          entity: 'term',
          key: `${vocabulary.key}.${term.code}`,
        });
      }
    }

    // Second pass wires up parents.
    for (const term of vocabulary.terms) {
      await sql`
        UPDATE pim.vocabulary_term child
           SET parent_id = ${
             term.parent === undefined
               ? sql`NULL`
               : sql`(SELECT id FROM pim.vocabulary_term
                       WHERE vocabulary_key = ${vocabulary.key} AND code = ${term.parent})`
           }
         WHERE child.vocabulary_key = ${vocabulary.key} AND child.code = ${term.code}
      `.execute(tx);
    }

    // Aliases are replaced as a set.
    for (const term of vocabulary.terms) {
      await sql`
        DELETE FROM pim.vocabulary_term_alias a
         USING pim.vocabulary_term t
         WHERE a.term_id = t.id
           AND t.vocabulary_key = ${vocabulary.key}
           AND t.code = ${term.code}
      `.execute(tx);
      for (const alias of dedupeByNormalizedForm(term.aliases ?? [], (a) => a.alias)) {
        await sql`
          INSERT INTO pim.vocabulary_term_alias
            (term_id, vocabulary_key, alias, source_system_code, asserts_equivalence,
             confidence, note)
          SELECT t.id, ${vocabulary.key}, ${alias.alias}, ${alias.sourceSystem ?? null},
                 ${alias.assertsEquivalence ?? true}, ${alias.confidence ?? 1}::numeric,
                 ${alias.note ?? null}
            FROM pim.vocabulary_term t
           WHERE t.vocabulary_key = ${vocabulary.key} AND t.code = ${term.code}
        `.execute(tx);
      }
    }

    // Terms present in the database but absent from configuration are deprecated,
    // never deleted: values already recorded against them remain meaningful.
    const codes = vocabulary.terms.map((t) => t.code);
    const deprecated = await sql<{ code: string }>`
      UPDATE pim.vocabulary_term
         SET deprecated_at = now()
       WHERE vocabulary_key = ${vocabulary.key}
         AND NOT (code = ANY (${codes}::text[]))
         AND deprecated_at IS NULL
      RETURNING code
    `.execute(tx);
    for (const row of deprecated.rows) {
      changes.push({
        kind: 'DEPRECATE',
        entity: 'term',
        key: `${vocabulary.key}.${row.code}`,
        detail: 'absent from configuration',
      });
    }
  }
}

async function applyAttributes(
  tx: DbTransaction,
  parsed: ParsedMetadata,
  changes: MetadataChange[],
  breaking: string[],
): Promise<void> {
  const existing = await sql<{
    key: string;
    value_type: string;
    dimension_code: string | null;
    vocabulary_key: string | null;
    cardinality: string;
    definition_version: number;
  }>`
    SELECT key, value_type, dimension_code, vocabulary_key, cardinality, definition_version
      FROM pim.attribute
  `.execute(tx);
  const existingByKey = new Map(existing.rows.map((r) => [r.key, r]));

  for (const attribute of parsed.attributes) {
    const previous = existingByKey.get(attribute.key);
    let definitionVersion = 1;

    if (previous !== undefined) {
      const reinterpretations: string[] = [];
      if (previous.value_type !== attribute.valueType) {
        reinterpretations.push(
          `value type ${previous.value_type} -> ${attribute.valueType}`,
        );
      }
      if ((previous.dimension_code ?? undefined) !== attribute.dimension) {
        reinterpretations.push(
          `dimension ${previous.dimension_code ?? 'none'} -> ${attribute.dimension ?? 'none'}`,
        );
      }
      if ((previous.vocabulary_key ?? undefined) !== attribute.vocabulary) {
        reinterpretations.push(
          `vocabulary ${previous.vocabulary_key ?? 'none'} -> ${attribute.vocabulary ?? 'none'}`,
        );
      }
      if (
        previous.cardinality === 'MULTI' &&
        (attribute.cardinality ?? 'SINGLE') === 'SINGLE'
      ) {
        reinterpretations.push('cardinality MULTI -> SINGLE');
      }

      if (reinterpretations.length > 0) {
        definitionVersion = previous.definition_version + 1;
        const valueCount = await attributeValueCount(tx, attribute.key);
        if (valueCount > 0) {
          breaking.push(
            `attribute '${attribute.key}': ${reinterpretations.join(', ')} ` +
              `(${valueCount} existing value(s) would be reinterpreted)`,
          );
        }
        changes.push({
          kind: 'UPDATE',
          entity: 'attribute',
          key: attribute.key,
          detail: reinterpretations.join(', '),
        });
      }
    }

    const result = await sql<{ inserted: boolean }>`
      INSERT INTO pim.attribute (
        key, name, description, value_type, dimension_code, default_unit_code,
        vocabulary_key, entity_type, cardinality, numeric_scale, min_numeric,
        max_numeric, min_length, max_length, is_filterable, is_comparable, channels,
        deprecated_at, superseded_by_key, definition_version, updated_at
      ) VALUES (
        ${attribute.key}, ${attribute.name}, ${attribute.description},
        ${attribute.valueType}, ${attribute.dimension ?? null},
        ${attribute.defaultUnit ?? null}, ${attribute.vocabulary ?? null},
        ${attribute.entityType ?? null}, ${attribute.cardinality ?? 'SINGLE'},
        ${attribute.numericScale ?? null}, ${attribute.minNumeric ?? null}::numeric,
        ${attribute.maxNumeric ?? null}::numeric, ${attribute.minLength ?? null},
        ${attribute.maxLength ?? null}, ${attribute.isFilterable ?? true},
        ${attribute.isComparable ?? true}, ${attribute.channels ?? []}::text[],
        ${attribute.deprecated === true ? sql`now()` : null},
        ${attribute.supersededBy ?? null}, ${definitionVersion}, now()
      )
      ON CONFLICT (key) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        value_type = EXCLUDED.value_type,
        dimension_code = EXCLUDED.dimension_code,
        default_unit_code = EXCLUDED.default_unit_code,
        vocabulary_key = EXCLUDED.vocabulary_key,
        entity_type = EXCLUDED.entity_type,
        cardinality = EXCLUDED.cardinality,
        numeric_scale = EXCLUDED.numeric_scale,
        min_numeric = EXCLUDED.min_numeric,
        max_numeric = EXCLUDED.max_numeric,
        min_length = EXCLUDED.min_length,
        max_length = EXCLUDED.max_length,
        is_filterable = EXCLUDED.is_filterable,
        is_comparable = EXCLUDED.is_comparable,
        channels = EXCLUDED.channels,
        deprecated_at = EXCLUDED.deprecated_at,
        superseded_by_key = EXCLUDED.superseded_by_key,
        definition_version = GREATEST(pim.attribute.definition_version, EXCLUDED.definition_version),
        updated_at = now()
      RETURNING (xmax = 0) AS inserted
    `.execute(tx);
    if (result.rows[0]?.inserted === true) {
      changes.push({ kind: 'INSERT', entity: 'attribute', key: attribute.key });
    }
  }

  const keys = parsed.attributes.map((a) => a.key);
  const deprecated = await sql<{ key: string }>`
    UPDATE pim.attribute
       SET deprecated_at = now(), updated_at = now()
     WHERE NOT (key = ANY (${keys}::text[])) AND deprecated_at IS NULL
    RETURNING key
  `.execute(tx);
  for (const row of deprecated.rows) {
    changes.push({
      kind: 'DEPRECATE',
      entity: 'attribute',
      key: row.key,
      detail: 'absent from configuration',
    });
  }
}

async function applyProductTypes(
  tx: DbTransaction,
  parsed: ParsedMetadata,
  changes: MetadataChange[],
): Promise<void> {
  for (const productType of parsed.productTypes) {
    const result = await sql<{ inserted: boolean }>`
      INSERT INTO pim.product_type
        (key, name, description, etim_class, etim_release, deprecated_at, updated_at)
      VALUES (
        ${productType.key}, ${productType.name}, ${productType.description},
        ${productType.etimClass ?? null}, ${productType.etimRelease ?? null},
        ${productType.deprecated === true ? sql`now()` : null}, now()
      )
      ON CONFLICT (key) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        etim_class = EXCLUDED.etim_class,
        etim_release = EXCLUDED.etim_release,
        deprecated_at = EXCLUDED.deprecated_at,
        updated_at = now()
      RETURNING (xmax = 0) AS inserted
    `.execute(tx);
    if (result.rows[0]?.inserted === true) {
      changes.push({ kind: 'INSERT', entity: 'product_type', key: productType.key });
    }
  }

  // Parents in a second pass, so declaration order in the file does not matter.
  for (const productType of parsed.productTypes) {
    await sql`
      UPDATE pim.product_type
         SET parent_key = ${productType.parent ?? null}
       WHERE key = ${productType.key}
    `.execute(tx);
  }

  const keys = parsed.productTypes.map((p) => p.key);
  const deprecated = await sql<{ key: string }>`
    UPDATE pim.product_type
       SET deprecated_at = now(), updated_at = now()
     WHERE NOT (key = ANY (${keys}::text[])) AND deprecated_at IS NULL
    RETURNING key
  `.execute(tx);
  for (const row of deprecated.rows) {
    changes.push({
      kind: 'DEPRECATE',
      entity: 'product_type',
      key: row.key,
      detail: 'absent from configuration',
    });
  }
}

async function applyProductTypeAttributes(
  tx: DbTransaction,
  parsed: ParsedMetadata,
  changes: MetadataChange[],
): Promise<void> {
  for (const productType of parsed.productTypes) {
    const entries = productType.attributes ?? [];
    const attributeKeys = entries.map((e) => e.attribute);

    const removed = await sql<{ attribute_key: string }>`
      DELETE FROM pim.product_type_attribute
       WHERE product_type_key = ${productType.key}
         AND NOT (attribute_key = ANY (${attributeKeys}::text[]))
      RETURNING attribute_key
    `.execute(tx);
    for (const row of removed.rows) {
      changes.push({
        kind: 'UPDATE',
        entity: 'product_type_attribute',
        key: `${productType.key}.${row.attribute_key}`,
        detail: 'no longer applies to this product type',
      });
    }

    for (const entry of entries) {
      const result = await sql<{ inserted: boolean }>`
        INSERT INTO pim.product_type_attribute
          (product_type_key, attribute_key, requirement, level, sort_order,
           condition, condition_note)
        VALUES (
          ${productType.key}, ${entry.attribute}, ${entry.requirement ?? 'OPTIONAL'},
          ${entry.level ?? 'ANY'}, ${entry.sortOrder ?? 100},
          ${entry.condition === undefined ? null : JSON.stringify(entry.condition)}::jsonb,
          ${entry.conditionNote ?? null}
        )
        ON CONFLICT (product_type_key, attribute_key) DO UPDATE SET
          requirement = EXCLUDED.requirement,
          level = EXCLUDED.level,
          sort_order = EXCLUDED.sort_order,
          condition = EXCLUDED.condition,
          condition_note = EXCLUDED.condition_note
        RETURNING (xmax = 0) AS inserted
      `.execute(tx);
      if (result.rows[0]?.inserted === true) {
        changes.push({
          kind: 'INSERT',
          entity: 'product_type_attribute',
          key: `${productType.key}.${entry.attribute}`,
        });
      }
    }
  }
}
