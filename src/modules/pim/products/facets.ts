/**
 * The search projection (ADR-0013, ADR-0014).
 *
 * `pim.variant_facet` holds the RESOLVED EFFECTIVE value for each variant after
 * inheritance, so faceted filtering is a set of index scans rather than a recursive
 * join at query time.
 *
 * It is refreshed inside the SAME TRANSACTION as the canonical change, which is what
 * makes a newly committed product immediately filterable (acceptance criterion 5). It
 * is also fully rebuildable from `pim.attribute_value`, so a bug here costs
 * performance, never correctness.
 */
import { sql } from 'kysely';
import type { Database, DbTransaction } from '../../../platform/db/index.js';

/**
 * Which variants are affected by a change at a given level. An attribute value set on
 * a product line fans out to every variant beneath it; the rebuild is set-based, not
 * row-by-row, so a family with ten thousand variants is one statement.
 */
export async function affectedVariantIds(
  tx: DbTransaction,
  owner: { level: 'LINE' | 'FAMILY' | 'PRODUCT' | 'VARIANT'; id: string },
): Promise<string[]> {
  if (owner.level === 'VARIANT') return [owner.id];

  const result = await sql<{ id: string }>`
    SELECT v.id
      FROM pim.variant v
      JOIN pim.product p ON p.id = v.product_id
      LEFT JOIN pim.product_family f ON f.id = p.product_family_id
     WHERE CASE ${owner.level}
             WHEN 'PRODUCT' THEN p.id = ${owner.id}::uuid
             WHEN 'FAMILY'  THEN f.id = ${owner.id}::uuid
             WHEN 'LINE'    THEN f.product_line_id = ${owner.id}::uuid
             ELSE false
           END
       AND v.deleted_at IS NULL
  `.execute(tx);

  return result.rows.map((r) => r.id);
}

/**
 * Recompute facet rows for the given variants from canonical values.
 *
 * Inheritance is resolved here rather than at query time: for each attribute the most
 * specific level that has a selected value wins, VARIANT over PRODUCT over FAMILY over
 * LINE. `source_level` records which level supplied the value, so the API can return
 * the resolved value together with its provenance (spec §27).
 */
export async function refreshVariantFacets(
  tx: DbTransaction,
  variantIds: readonly string[],
): Promise<number> {
  if (variantIds.length === 0) return 0;

  await sql`
    DELETE FROM pim.variant_facet WHERE variant_id = ANY(${variantIds}::uuid[])
  `.execute(tx);

  const result = await sql<{ variant_id: string }>`
    WITH scope AS (
      SELECT v.id AS variant_id,
             v.product_id,
             p.product_family_id,
             f.product_line_id
        FROM pim.variant v
        JOIN pim.product p ON p.id = v.product_id
        LEFT JOIN pim.product_family f ON f.id = p.product_family_id
       WHERE v.id = ANY(${variantIds}::uuid[])
         AND v.deleted_at IS NULL
    ),
    candidates AS (
      -- Columns are listed explicitly rather than using av.*: pim.attribute_value has
      -- its own variant_id (the owner, often null for a product-level value), and
      -- splatting it alongside the target variant makes every later reference
      -- ambiguous -- silently for the planner, loudly at runtime.
      SELECT s.variant_id       AS target_variant_id,
             av.id              AS attribute_value_id,
             av.attribute_key,
             av.ordinal,
             av.value_type,
             av.owner_level,
             av.value_numeric,
             av.value_boolean,
             av.value_text,
             av.value_date,
             av.value_term_id,
             av.value_entity_id,
             av.value_qty_base,
             av.value_qty_max_base,
             CASE av.owner_level
               WHEN 'VARIANT' THEN 4
               WHEN 'PRODUCT' THEN 3
               WHEN 'FAMILY'  THEN 2
               WHEN 'LINE'    THEN 1
             END AS specificity
        FROM scope s
        JOIN pim.attribute_value av
          ON av.is_selected
         AND (av.variant_id        = s.variant_id
           OR av.product_id        = s.product_id
           OR av.product_family_id = s.product_family_id
           OR av.product_line_id   = s.product_line_id)
    ),
    effective AS (
      SELECT DISTINCT ON (target_variant_id, attribute_key, ordinal) *
        FROM candidates
       ORDER BY target_variant_id, attribute_key, ordinal, specificity DESC
    )
    INSERT INTO pim.variant_facet (
      variant_id, attribute_key, ordinal, value_kind,
      num_value, num_min, num_max, term_id, bool_value, text_value, entity_id,
      source_level, attribute_value_id
    )
    SELECT
      e.target_variant_id,
      e.attribute_key,
      e.ordinal,
      CASE e.value_type
        WHEN 'TEXT'           THEN 'TEXT'
        WHEN 'BOOLEAN'        THEN 'BOOLEAN'
        WHEN 'INTEGER'        THEN 'NUMBER'
        WHEN 'DECIMAL'        THEN 'NUMBER'
        -- Dates are indexed as ISO-8601 text, which sorts and range-compares
        -- correctly. No date attribute currently needs a numeric range filter; when
        -- one does, this gains a typed column rather than a cast.
        WHEN 'DATE'           THEN 'TEXT'
        WHEN 'QUANTITY'       THEN 'NUMBER'
        WHEN 'QUANTITY_RANGE' THEN 'RANGE'
        WHEN 'ENTITY_REF'     THEN 'ENTITY'
        ELSE 'TERM'
      END,
      -- Quantities are indexed by their NORMALIZED BASE value, which is what makes a
      -- filter expressed in PSI match a value entered in bar.
      CASE e.value_type
        WHEN 'INTEGER'  THEN e.value_numeric
        WHEN 'DECIMAL'  THEN e.value_numeric
        WHEN 'QUANTITY' THEN e.value_qty_base
      END,
      CASE WHEN e.value_type = 'QUANTITY_RANGE' THEN e.value_qty_base END,
      CASE WHEN e.value_type = 'QUANTITY_RANGE' THEN e.value_qty_max_base END,
      e.value_term_id,
      e.value_boolean,
      CASE e.value_type
        WHEN 'TEXT' THEN e.value_text
        WHEN 'DATE' THEN to_char(e.value_date, 'YYYY-MM-DD')
      END,
      e.value_entity_id,
      e.owner_level,
      e.attribute_value_id
      FROM effective e
    RETURNING variant_id
  `.execute(tx);

  return result.rows.length;
}

/**
 * Rebuild every facet row from canonical values, in batches.
 *
 * The runbook operation behind ADR-0013's "the facet table is derived and
 * rebuildable". Also the repair for any drift the reconciliation check reports.
 */
export async function rebuildAllFacets(
  db: Database,
  options: { batchSize?: number; onProgress?: (done: number) => void } = {},
): Promise<number> {
  const batchSize = options.batchSize ?? 2000;
  let done = 0;
  let after = '00000000-0000-0000-0000-000000000000';

  for (;;) {
    const batch = await db.transaction().execute(async (tx) => {
      const ids = await sql<{ id: string }>`
        SELECT id FROM pim.variant
         WHERE id > ${after}::uuid AND deleted_at IS NULL
         ORDER BY id LIMIT ${batchSize}
      `.execute(tx);
      if (ids.rows.length === 0) return [];
      await refreshVariantFacets(
        tx,
        ids.rows.map((r) => r.id),
      );
      return ids.rows.map((r) => r.id);
    });

    if (batch.length === 0) break;
    after = batch[batch.length - 1]!;
    done += batch.length;
    options.onProgress?.(done);
    if (batch.length < batchSize) break;
  }

  return done;
}

export interface FacetDrift {
  readonly variantId: string;
  readonly attributeKey: string;
  readonly problem: 'MISSING' | 'STALE' | 'ORPHANED';
}

/**
 * Compare the projection against canonical values and report disagreement.
 *
 * Runs as a scheduled reconciliation over a sample, and in full before a release.
 * Drift is a defect, not a tolerance: any row returned here means the projection and
 * the canonical store disagree about what a product is.
 */
export async function detectFacetDrift(
  db: Database,
  options: { limit?: number } = {},
): Promise<FacetDrift[]> {
  const limit = options.limit ?? 100;

  const result = await sql<{
    variant_id: string;
    attribute_key: string;
    problem: FacetDrift['problem'];
  }>`
    WITH scope AS (
      SELECT v.id AS variant_id, v.product_id, p.product_family_id, f.product_line_id
        FROM pim.variant v
        JOIN pim.product p ON p.id = v.product_id
        LEFT JOIN pim.product_family f ON f.id = p.product_family_id
       WHERE v.deleted_at IS NULL
    ),
    expected AS (
      SELECT DISTINCT ON (s.variant_id, av.attribute_key, av.ordinal)
             s.variant_id, av.attribute_key, av.ordinal, av.id AS attribute_value_id
        FROM scope s
        JOIN pim.attribute_value av
          ON av.is_selected
         AND (av.variant_id = s.variant_id OR av.product_id = s.product_id
           OR av.product_family_id = s.product_family_id
           OR av.product_line_id = s.product_line_id)
       ORDER BY s.variant_id, av.attribute_key, av.ordinal,
                CASE av.owner_level WHEN 'VARIANT' THEN 4 WHEN 'PRODUCT' THEN 3
                                    WHEN 'FAMILY' THEN 2 ELSE 1 END DESC
    )
    SELECT variant_id, attribute_key, problem FROM (
      SELECT e.variant_id, e.attribute_key,
             CASE WHEN f.variant_id IS NULL THEN 'MISSING' ELSE 'STALE' END AS problem
        FROM expected e
        LEFT JOIN pim.variant_facet f
          ON f.variant_id = e.variant_id AND f.attribute_key = e.attribute_key
         AND f.ordinal = e.ordinal
       WHERE f.variant_id IS NULL OR f.attribute_value_id <> e.attribute_value_id
      UNION ALL
      SELECT f.variant_id, f.attribute_key, 'ORPHANED' AS problem
        FROM pim.variant_facet f
        LEFT JOIN expected e
          ON e.variant_id = f.variant_id AND e.attribute_key = f.attribute_key
         AND e.ordinal = f.ordinal
       WHERE e.variant_id IS NULL
    ) drift
     LIMIT ${limit}
  `.execute(db);

  return result.rows.map((row) => ({
    variantId: row.variant_id,
    attributeKey: row.attribute_key,
    problem: row.problem,
  }));
}
