/**
 * Faceted product filtering in PostgreSQL (ADR-0014).
 *
 * Filters run against `pim.variant_facet`, which already holds resolved, normalized,
 * inheritance-applied values. An N-criterion filter compiles to an N-way intersection
 * over partial indexes.
 *
 * Two plan shapes are implemented — INTERSECT and a single-pass aggregate — because
 * §83 requires the choice to be made by measurement rather than by intuition. The
 * benchmark compares them; the default is recorded in docs/testing.md with its plan.
 *
 * Range criteria always compare NORMALIZED BASE values, so a filter expressed in PSI
 * matches a value entered in bar (acceptance criterion 6).
 */
import { sql } from 'kysely';
import type { RawBuilder } from 'kysely';
import type { Database, DbTransaction } from '../../../platform/db/index.js';
import type { AttributeRegistry } from './attribute-registry.js';
import type { UnitRegistry } from '../units/conversion.js';
import { Decimal } from '../units/conversion.js';

export interface TermCriterion {
  readonly attributeKey: string;
  readonly kind: 'term';
  /** Term codes, or term identifiers. Matching any of them satisfies the criterion. */
  readonly anyOf: readonly string[];
}

export interface RangeCriterion {
  readonly attributeKey: string;
  readonly kind: 'range';
  readonly min?: number | string | undefined;
  readonly max?: number | string | undefined;
  /** The unit the bounds are expressed in. Defaults to the attribute's display unit. */
  readonly unit?: string | undefined;
}

export interface BooleanCriterion {
  readonly attributeKey: string;
  readonly kind: 'boolean';
  readonly value: boolean;
}

export interface TextCriterion {
  readonly attributeKey: string;
  readonly kind: 'text';
  readonly contains: string;
}

export interface PresenceCriterion {
  readonly attributeKey: string;
  readonly kind: 'present';
}

export type FilterCriterion =
  TermCriterion | RangeCriterion | BooleanCriterion | TextCriterion | PresenceCriterion;

export type PlanShape = 'join' | 'intersect' | 'aggregate';

/**
 * The default plan shape, chosen by measurement (§83), not intuition — and a
 * cautionary tale about which measurement.
 *
 * At 25,000 variants the reorderable `join` shape won both comparisons, sometimes by
 * a factor of two. At 250,000 variants it lost badly: 326 ms p95 against INTERSECT's
 * 122 ms on the same three-criterion filter. The 25,000-row result was real and
 * completely misleading, which is exactly the trap §35 warns about when it refuses to
 * accept "realistic" as an unquantified word.
 *
 * So the default is INTERSECT, chosen on the 250,000-variant measurement. All three
 * shapes remain implemented and are asserted to return identical results, because the
 * comparison has to stay runnable: the right answer changed once with scale and will
 * change again with hardware, and a benchmark nobody can re-run is an opinion.
 *
 * Measured figures and the environment they came from are in docs/testing.md.
 */
export const DEFAULT_PLAN: PlanShape = 'intersect';

export interface SearchOptions {
  readonly criteria: readonly FilterCriterion[];
  readonly productTypeKey?: string | undefined;
  readonly limit?: number | undefined;
  /** Opaque cursor: the last variant id of the previous page. */
  readonly after?: string | undefined;
  readonly plan?: PlanShape | undefined;
}

export interface SearchHit {
  readonly variantId: string;
  readonly productId: string;
  readonly manufacturerPartNumber: string | null;
  readonly productName: string;
}

export interface SearchResult {
  readonly hits: readonly SearchHit[];
  readonly nextCursor: string | undefined;
  readonly plan: PlanShape;
}

export class SearchCriterionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchCriterionError';
  }
}

const MAX_LIMIT = 500;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Translate one criterion into a predicate over `pim.variant_facet`.
 *
 * Attribute keys are looked up in the registry, never interpolated, so an unknown
 * attribute is an error rather than a query fragment.
 */
function predicateFor(
  criterion: FilterCriterion,
  attributes: AttributeRegistry,
  units: UnitRegistry,
): RawBuilder<unknown> {
  const attribute = attributes.get(criterion.attributeKey);
  if (!attribute.isFilterable) {
    throw new SearchCriterionError(
      `Attribute '${attribute.key}' is not marked filterable. Set isFilterable in ` +
        `config/metadata rather than querying it ad hoc.`,
    );
  }

  switch (criterion.kind) {
    case 'term': {
      if (attribute.vocabularyKey === null) {
        throw new SearchCriterionError(
          `Attribute '${attribute.key}' is ${attribute.valueType}, not an enumerated type; ` +
            `a term filter does not apply to it.`,
        );
      }
      const ids = criterion.anyOf.map((value) => {
        const term = attributes.resolveTerm(attribute.vocabularyKey!, value);
        if (term === undefined) {
          throw new SearchCriterionError(
            `'${value}' is not a term in vocabulary '${attribute.vocabularyKey}'.`,
          );
        }
        return term.id;
      });
      return sql`f.attribute_key = ${attribute.key} AND f.term_id = ANY(${ids}::uuid[])`;
    }

    case 'range': {
      if (criterion.min === undefined && criterion.max === undefined) {
        throw new SearchCriterionError(
          `Range filter on '${attribute.key}' needs at least one bound.`,
        );
      }
      const isQuantity =
        attribute.valueType === 'QUANTITY' || attribute.valueType === 'QUANTITY_RANGE';
      if (
        !isQuantity &&
        attribute.valueType !== 'INTEGER' &&
        attribute.valueType !== 'DECIMAL'
      ) {
        throw new SearchCriterionError(
          `Attribute '${attribute.key}' is ${attribute.valueType}; a range filter needs a ` +
            `numeric or quantity attribute. A pressure class is a designation, not a ` +
            `pressure (ADR-0016).`,
        );
      }

      // Bounds are converted into the attribute's base unit before they touch the
      // index, which is the whole mechanism behind cross-unit matching.
      const toBase = (bound: number | string): string => {
        if (!isQuantity) return new Decimal(bound).toString();
        const unitCode = criterion.unit ?? attribute.defaultUnitCode;
        if (unitCode === null || unitCode === undefined) {
          throw new SearchCriterionError(
            `Range filter on '${attribute.key}' needs a unit, and the attribute declares ` +
              `no default.`,
          );
        }
        const unit = units.resolve(unitCode);
        if (unit === undefined) {
          throw new SearchCriterionError(`'${unitCode}' is not a known unit.`);
        }
        if (unit.dimension !== attribute.dimensionCode) {
          throw new SearchCriterionError(
            `Unit '${unit.code}' measures ${unit.dimension}, but '${attribute.key}' is ` +
              `${attribute.dimensionCode}.`,
          );
        }
        return units.toBase(bound, unit.code).value.toString();
      };

      const min = criterion.min === undefined ? null : toBase(criterion.min);
      const max = criterion.max === undefined ? null : toBase(criterion.max);

      if (attribute.valueType === 'QUANTITY_RANGE') {
        // A product's stated range must overlap the requested range.
        return sql`
          f.attribute_key = ${attribute.key}
          AND (${max}::numeric IS NULL OR f.num_min <= ${max}::numeric)
          AND (${min}::numeric IS NULL OR f.num_max >= ${min}::numeric)
        `;
      }
      return sql`
        f.attribute_key = ${attribute.key}
        AND (${min}::numeric IS NULL OR f.num_value >= ${min}::numeric)
        AND (${max}::numeric IS NULL OR f.num_value <= ${max}::numeric)
      `;
    }

    case 'boolean':
      return sql`f.attribute_key = ${attribute.key} AND f.bool_value = ${criterion.value}`;

    case 'text':
      return sql`f.attribute_key = ${attribute.key} AND f.text_value ILIKE ${'%' + criterion.contains + '%'}`;

    case 'present':
      return sql`f.attribute_key = ${attribute.key}`;

    default: {
      const unhandled: never = criterion;
      throw new Error(`Unhandled criterion ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * Build the set of matching variant ids under the requested plan shape.
 *
 * All three shapes must return the same set; the benchmark asserts that and compares
 * their cost. Keeping the three side by side is what makes the choice reviewable —
 * "we measured" is only meaningful if the alternative is still runnable.
 */
function matchedVariants(
  criteria: readonly FilterCriterion[],
  plan: PlanShape,
  attributes: AttributeRegistry,
  units: UnitRegistry,
): RawBuilder<unknown> {
  if (criteria.length === 0) {
    return sql`SELECT v.id AS variant_id FROM pim.variant v WHERE v.deleted_at IS NULL`;
  }

  const predicates = criteria.map((criterion) => ({
    sql: predicateFor(criterion, attributes, units),
    // A MULTI-valued attribute can match several rows for one variant, so its branch
    // must de-duplicate. INTERSECT does that implicitly; a join does not.
    multi: attributes.get(criterion.attributeKey).cardinality === 'MULTI',
  }));

  if (plan === 'intersect') {
    return sql.join(
      predicates.map(
        (p) => sql`SELECT f.variant_id FROM pim.variant_facet f WHERE ${p.sql}`,
      ),
      sql` INTERSECT `,
    );
  }

  if (plan === 'aggregate') {
    return sql`
      SELECT f.variant_id
        FROM pim.variant_facet f
       WHERE ${sql.join(
         predicates.map((p) => sql`(${p.sql})`),
         sql` OR `,
       )}
       GROUP BY f.variant_id
      HAVING count(DISTINCT CASE ${sql.join(
        predicates.map((p, i) => sql`WHEN (${p.sql}) THEN ${i}`),
        sql` `,
      )} END) = ${predicates.length}
    `;
  }

  // 'join': inner joins between per-criterion subqueries. Inner joins are freely
  // reorderable, so the planner drives from whichever branch its statistics say is
  // smallest and probes the rest by index — which is the whole point.
  const branches = predicates.map(
    (p, i) => sql`
      (SELECT ${p.multi ? sql`DISTINCT` : sql``} f.variant_id
         FROM pim.variant_facet f WHERE ${p.sql}) AS ${sql.raw(`s${i}`)}
    `,
  );
  const joins = branches
    .slice(1)
    .map(
      (branch, i) =>
        sql` JOIN ${branch} ON ${sql.raw(`s${i + 1}`)}.variant_id = s0.variant_id`,
    );

  return sql`
    SELECT s0.variant_id FROM ${branches[0]!}${sql.join(joins, sql``)}
  `;
}

export async function searchVariants(
  db: Database | DbTransaction,
  options: SearchOptions,
  attributes: AttributeRegistry,
  units: UnitRegistry,
): Promise<SearchResult> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), MAX_LIMIT);
  const plan = options.plan ?? DEFAULT_PLAN;
  const after = options.after ?? ZERO_UUID;
  const matched = matchedVariants(options.criteria, plan, attributes, units);

  const result = await sql<{
    id: string;
    product_id: string;
    manufacturer_part_number: string | null;
    product_name: string;
  }>`
    WITH matched AS (${matched})
    SELECT v.id, v.product_id, v.manufacturer_part_number, p.name AS product_name
      FROM matched m
      JOIN pim.variant v ON v.id = m.variant_id
      JOIN pim.product p ON p.id = v.product_id
     WHERE v.deleted_at IS NULL
       AND p.deleted_at IS NULL
       AND v.id > ${after}::uuid
       AND (${options.productTypeKey ?? null}::text IS NULL
            OR p.product_type_key = ${options.productTypeKey ?? null})
     ORDER BY v.id
     LIMIT ${limit}
  `.execute(db);

  const hits = result.rows.map((row) => ({
    variantId: row.id,
    productId: row.product_id,
    manufacturerPartNumber: row.manufacturer_part_number,
    productName: row.product_name,
  }));

  return {
    hits,
    nextCursor: hits.length === limit ? hits[hits.length - 1]!.variantId : undefined,
    plan,
  };
}

export interface FacetCount {
  readonly attributeKey: string;
  readonly termId: string | null;
  readonly termCode: string | null;
  readonly label: string | null;
  readonly count: number;
}

/**
 * Counts per candidate value across the *already restricted* result set, so the
 * numbers a user sees describe what is still reachable rather than the whole
 * catalogue.
 */
export async function facetCounts(
  db: Database | DbTransaction,
  options: SearchOptions,
  attributes: AttributeRegistry,
  units: UnitRegistry,
  forAttributes: readonly string[],
): Promise<FacetCount[]> {
  const matched = matchedVariants(
    options.criteria,
    options.plan ?? DEFAULT_PLAN,
    attributes,
    units,
  );

  const result = await sql<{
    attribute_key: string;
    term_id: string | null;
    term_code: string | null;
    label: string | null;
    count: string;
  }>`
    WITH matched AS (${matched})
    SELECT f.attribute_key, f.term_id, t.code AS term_code, t.label, count(*)::text AS count
      FROM matched m
      JOIN pim.variant_facet f ON f.variant_id = m.variant_id
      LEFT JOIN pim.vocabulary_term t ON t.id = f.term_id
     WHERE f.attribute_key = ANY(${[...forAttributes]}::text[])
     GROUP BY f.attribute_key, f.term_id, t.code, t.label, t.sort_ordinal
     ORDER BY f.attribute_key, t.sort_ordinal NULLS LAST, count(*) DESC
  `.execute(db);

  return result.rows.map((row) => ({
    attributeKey: row.attribute_key,
    termId: row.term_id,
    termCode: row.term_code,
    label: row.label,
    count: Number(row.count),
  }));
}

/** The query plan for a filter, for the benchmark and for diagnosing a slow query. */
export async function explainSearch(
  db: Database,
  options: SearchOptions,
  attributes: AttributeRegistry,
  units: UnitRegistry,
): Promise<string> {
  const matched = matchedVariants(
    options.criteria,
    options.plan ?? DEFAULT_PLAN,
    attributes,
    units,
  );

  const result = await sql<{ 'QUERY PLAN': string }>`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    WITH matched AS (${matched})
    SELECT v.id FROM matched m JOIN pim.variant v ON v.id = m.variant_id
     WHERE v.deleted_at IS NULL ORDER BY v.id LIMIT ${options.limit ?? 50}
  `.execute(db);

  return result.rows.map((r) => r['QUERY PLAN']).join('\n');
}
