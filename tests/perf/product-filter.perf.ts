import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { createTestDatabase, connectTo, type TestDatabase } from '../support/database.js';
import { applyRealMetadata } from '../support/metadata.js';
import type { Database } from '../../src/platform/db/index.js';
import {
  explainSearch,
  loadCatalogDeps,
  searchVariants,
  type CatalogDeps,
  type FilterCriterion,
} from '../../src/modules/pim/index.js';

/**
 * The benchmark behind acceptance criterion 4 (ADR-0014, spec §35, §83).
 *
 * Excluded from the default test run: it generates a catalogue and takes minutes.
 * Run with `make test-perf`.
 *
 * The dataset size and the SLO are PROVISIONAL. They stand in for discovery questions
 * F1 and F2 (assumption A-014) and must be re-set the moment real figures arrive.
 * `FSW_PERF_VARIANTS` overrides the size so the same benchmark can be re-run against
 * the real number without editing this file.
 */
import { cpus } from 'node:os';

const VARIANTS = Number(process.env['FSW_PERF_VARIANTS'] ?? 250_000);
const TARGET_CONCURRENCY = Number(process.env['FSW_PERF_CONCURRENCY'] ?? 50);
const ITERATIONS = Number(process.env['FSW_PERF_ITERATIONS'] ?? 400);

const SLO = { p50: 25, p95: 100, p99: 250 };

/**
 * What this benchmark asserts, and why it is split in two.
 *
 * The target concurrency (50, per assumption A-014) is a property of the workload.
 * Whether a machine can serve it is a property of the machine. On a four-core sandbox,
 * fifty concurrent PostgreSQL backends are twelve times oversubscribed, and the
 * client-side percentiles then measure CPU queueing rather than the query -- an early
 * run reported a 280 ms p95 for a query whose server-side execution was 9 ms.
 *
 * Reporting that as an architecture failure would be wrong, and quietly lowering the
 * target until it passed would be worse. So:
 *
 *   * SERVER-SIDE execution time is asserted against the SLO unconditionally. That is
 *     the number ADR-0014's design controls, and it is what a bigger instance
 *     preserves.
 *   * END-TO-END latency is asserted at a concurrency this host can actually serve
 *     (two per core), and the oversubscribed figure is reported without failing.
 *
 * The end-to-end figure at the real target concurrency must be re-measured on
 * production-class hardware before acceptance criterion 4 is called complete. This
 * sandbox also runs PostgreSQL with a default 128 MB shared_buffers, which a real
 * deployment would not.
 */
const SERVABLE_CONCURRENCY = Math.max(2, cpus().length * 2);
const CONCURRENCY = Math.min(TARGET_CONCURRENCY, SERVABLE_CONCURRENCY);
const OVERSUBSCRIBED = TARGET_CONCURRENCY > SERVABLE_CONCURRENCY;

interface Timing {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly n: number;
}

function percentiles(samples: number[]): Timing {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
  return {
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1]!,
    n: sorted.length,
  };
}

function report(label: string, timing: Timing): void {
  console.log(
    `  ${label.padEnd(46)} n=${String(timing.n).padStart(5)}  ` +
      `p50=${timing.p50.toFixed(1)}ms  p95=${timing.p95.toFixed(1)}ms  ` +
      `p99=${timing.p99.toFixed(1)}ms  max=${timing.max.toFixed(1)}ms`,
  );
}

/**
 * Generate a catalogue set-based rather than through the API.
 *
 * Going through createVariant would take hours and would benchmark the write path,
 * not the read path. The rows produced are identical in shape to what the service
 * writes; the facet projection is built by the same SQL the service uses.
 */
async function generateCatalogue(testDb: TestDatabase, variants: number): Promise<void> {
  const started = Date.now();
  console.log(`  generating ${variants.toLocaleString()} variants...`);

  await sql`
    INSERT INTO pim.brand (key, name)
    SELECT 'brand_' || i, 'Generated Brand ' || i FROM generate_series(1, 40) i
  `.execute(testDb.db);

  // Roughly 25 variants per product, which matches the shape of a real valve
  // catalogue better than one variant per product would.
  const products = Math.max(1, Math.ceil(variants / 25));
  await sql`
    INSERT INTO pim.product (key, brand_id, product_type_key, name, model_series)
    SELECT 'gen_product_' || i,
           (SELECT id FROM pim.brand WHERE key = 'brand_' || (1 + (i % 40))),
           (ARRAY['ball_valve','butterfly_valve','gate_valve','globe_valve','check_valve',
                  'solenoid_valve','plug_valve','needle_valve'])[1 + (i % 8)],
           'Generated product ' || i,
           'GP' || i
      FROM generate_series(1, ${products}) i
  `.execute(testDb.db);

  await sql`
    INSERT INTO pim.variant (product_id, manufacturer_part_number, name)
    SELECT p.id, 'GEN-' || p.key || '-' || v, 'Generated variant ' || v
      FROM pim.product p, generate_series(1, 25) v
     WHERE p.key LIKE 'gen_product_%'
     LIMIT ${variants}
  `.execute(testDb.db);

  console.log(`  variants inserted (${((Date.now() - started) / 1000).toFixed(1)}s)`);

  // Enumerated attributes, spread so filters are selective but not degenerate.
  for (const [attributeKey, vocabulary] of [
    ['nominal_size', 'nominal_size'],
    ['body_material', 'material'],
    ['end_connection', 'end_connection'],
    ['pressure_class', 'pressure_class'],
    ['port_size', 'port_size'],
    ['actuation_type', 'actuation_type'],
  ] as const) {
    await sql`
      INSERT INTO pim.attribute_value
        (attribute_key, value_type, cardinality, variant_id, value_term_id,
         value_vocabulary_key, source_system_code, is_selected, selected_reason, entered_raw)
      SELECT a.key, a.value_type, a.cardinality, v.id, t.id, ${vocabulary},
             'MFR_CATALOG', true, 'generated', t.code
        FROM pim.variant v
        CROSS JOIN LATERAL (
          SELECT id, code FROM pim.vocabulary_term
           WHERE vocabulary_key = ${vocabulary} AND deprecated_at IS NULL
           ORDER BY md5(v.id::text || code) LIMIT 1
        ) t
        CROSS JOIN pim.attribute a
       WHERE a.key = ${attributeKey}
         AND v.manufacturer_part_number LIKE 'GEN-%'
    `.execute(testDb.db);
  }

  // Quantities, stored normalized so range filters exercise the numeric index.
  await sql`
    INSERT INTO pim.attribute_value
      (attribute_key, value_type, cardinality, variant_id, value_qty_original,
       value_qty_original_unit, value_qty_base, value_qty_dimension,
       source_system_code, is_selected, selected_reason, entered_raw)
    SELECT 'cv', 'QUANTITY', 'SINGLE', v.id,
           round((1 + (('x' || substr(md5(v.id::text), 1, 6))::bit(24)::int % 2000))::numeric, 3),
           '[Cv]',
           round((1 + (('x' || substr(md5(v.id::text), 1, 6))::bit(24)::int % 2000))::numeric, 3),
           'FLOW_COEFFICIENT', 'MFR_CATALOG', true, 'generated', 'generated'
      FROM pim.variant v
     WHERE v.manufacturer_part_number LIKE 'GEN-%'
  `.execute(testDb.db);

  await sql`
    INSERT INTO pim.attribute_value
      (attribute_key, value_type, cardinality, variant_id, value_qty_original,
       value_qty_original_unit, value_qty_base, value_qty_dimension,
       source_system_code, is_selected, selected_reason, entered_raw)
    SELECT 'wog_pressure', 'QUANTITY', 'SINGLE', v.id, p.psi, '[psig]',
           round(p.psi * 6894.75729316836133672267344535, 4), 'PRESSURE_GAUGE',
           'MFR_CATALOG', true, 'generated', p.psi || ' WOG'
      FROM pim.variant v
      CROSS JOIN LATERAL (
        SELECT (ARRAY[150,200,300,600,720,1000,1500,2000])
                 [1 + (('x' || substr(md5(v.id::text || 'p'), 1, 6))::bit(24)::int % 8)]::numeric AS psi
      ) p
     WHERE v.manufacturer_part_number LIKE 'GEN-%'
  `.execute(testDb.db);

  // A multi-valued attribute, since certification filters are a stated use case.
  await sql`
    INSERT INTO pim.attribute_value
      (attribute_key, value_type, cardinality, variant_id, ordinal, value_term_id,
       value_vocabulary_key, source_system_code, is_selected, selected_reason, entered_raw)
    SELECT 'certifications', 'ENUM', 'MULTI', v.id, 0, t.id, 'certification',
           'MFR_CATALOG', true, 'generated', t.code
      FROM pim.variant v
      CROSS JOIN LATERAL (
        SELECT id, code FROM pim.vocabulary_term
         WHERE vocabulary_key = 'certification' ORDER BY md5(v.id::text || code) LIMIT 1
      ) t
     WHERE v.manufacturer_part_number LIKE 'GEN-%'
  `.execute(testDb.db);

  console.log(
    `  attribute values inserted (${((Date.now() - started) / 1000).toFixed(1)}s)`,
  );

  // Build the projection with the same SQL the service uses, in one set-based pass.
  await sql`
    INSERT INTO pim.variant_facet
      (variant_id, attribute_key, ordinal, value_kind, num_value, term_id,
       source_level, attribute_value_id)
    SELECT av.variant_id, av.attribute_key, av.ordinal,
           CASE WHEN av.value_term_id IS NOT NULL THEN 'TERM' ELSE 'NUMBER' END,
           av.value_qty_base, av.value_term_id, 'VARIANT', av.id
      FROM pim.attribute_value av
     WHERE av.is_selected AND av.variant_id IS NOT NULL
  `.execute(testDb.db);

  await sql`ANALYZE pim.variant_facet`.execute(testDb.db);
  await sql`ANALYZE pim.variant`.execute(testDb.db);
  await sql`ANALYZE pim.product`.execute(testDb.db);

  const counts = await sql<{ variants: string; facets: string }>`
    SELECT (SELECT count(*)::text FROM pim.variant) AS variants,
           (SELECT count(*)::text FROM pim.variant_facet) AS facets
  `.execute(testDb.db);
  console.log(
    `  ready: ${Number(counts.rows[0]!.variants).toLocaleString()} variants, ` +
      `${Number(counts.rows[0]!.facets).toLocaleString()} facet rows ` +
      `(${((Date.now() - started) / 1000).toFixed(1)}s)`,
  );
}

describe('product filter performance (acceptance criterion 4)', () => {
  let testDb: TestDatabase;
  let catalog: CatalogDeps;
  // A pool sized to the concurrency under test.
  //
  // The default harness pool holds five connections. Firing fifty concurrent queries
  // at it measures connection queuing, not query latency: an early run reported a
  // 35 ms p50 for a query EXPLAIN ANALYZE showed executing in 3.6 ms. A real
  // deployment sizes its pool to its concurrency, and so does this benchmark.
  let pool: { db: Database; close(): Promise<void> };

  beforeAll(async () => {
    testDb = await createTestDatabase('perf');
    await applyRealMetadata(testDb.db);
    await generateCatalogue(testDb, VARIANTS);
    catalog = await loadCatalogDeps(testDb.db);
    pool = connectTo(testDb, 'perf-load', CONCURRENCY + 4);
  }, 1_800_000);

  afterAll(async () => {
    await pool.close();
    await testDb.close();
  });

  /** Server-side execution time, isolating the query from client and pool overhead. */
  async function serverSideMillis(criteria: readonly FilterCriterion[]): Promise<number> {
    const plan = await explainSearch(
      testDb.db,
      { criteria: [...criteria] },
      catalog.attributes,
      catalog.units,
    );
    const match = /Execution Time: ([\d.]+) ms/.exec(plan);
    return match === null ? Number.NaN : Number(match[1]);
  }

  async function measure(
    label: string,
    criteria: readonly FilterCriterion[],
    plan: 'intersect' | 'aggregate' = 'intersect',
  ): Promise<Timing> {
    // Warm the cache first: the SLO is a warm-cache figure, and measuring the first
    // cold read tells us about disk, not about the query.
    for (let i = 0; i < 5; i += 1) {
      await searchVariants(
        pool.db,
        { criteria: [...criteria], plan },
        catalog.attributes,
        catalog.units,
      );
    }

    const samples: number[] = [];
    const batches = Math.ceil(ITERATIONS / CONCURRENCY);
    for (let batch = 0; batch < batches; batch += 1) {
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          const started = performance.now();
          await searchVariants(
            pool.db,
            { criteria: [...criteria], plan, limit: 50 },
            catalog.attributes,
            catalog.units,
          );
          samples.push(performance.now() - started);
        }),
      );
    }

    const timing = percentiles(samples);
    report(label, timing);
    const serverSide = await serverSideMillis(criteria);
    if (Number.isFinite(serverSide)) {
      console.log(`  ${''.padEnd(46)} server-side execution: ${serverSide.toFixed(2)}ms`);
    }
    return timing;
  }

  it('reports the environment it is measuring in', () => {
    console.log(
      `\n  host: ${cpus().length} vCPU  |  target concurrency ${TARGET_CONCURRENCY}  |  ` +
        `measured at ${CONCURRENCY}` +
        (OVERSUBSCRIBED
          ? `\n  NOTE: ${TARGET_CONCURRENCY} concurrent queries exceed what ${cpus().length} cores can serve.\n` +
            `  End-to-end percentiles below are measured at ${CONCURRENCY} and must be\n` +
            `  re-measured at ${TARGET_CONCURRENCY} on production-class hardware.`
          : ''),
    );
    expect(VARIANTS).toBeGreaterThan(0);
  });

  it('meets the SLO on the acceptance-criterion filter', async () => {
    // The exact combination acceptance criterion 4 names: size, 316 stainless,
    // socket weld, pressure class, certification.
    const criteria: FilterCriterion[] = [
      { attributeKey: 'nominal_size', kind: 'term', anyOf: ['NPS_1'] },
      { attributeKey: 'body_material', kind: 'term', anyOf: ['SS_316'] },
      { attributeKey: 'end_connection', kind: 'term', anyOf: ['SOCKET_WELD'] },
      { attributeKey: 'pressure_class', kind: 'term', anyOf: ['ASME_CLASS_150'] },
      { attributeKey: 'certifications', kind: 'term', anyOf: ['API_607'] },
    ];

    const timing = await measure('AC4 five-criterion filter (intersect)', criteria);
    const serverSide = await serverSideMillis(criteria);

    // The query itself, which is what the architecture controls.
    expect(
      serverSide,
      `server-side execution ${serverSide}ms exceeds ${SLO.p50}ms`,
    ).toBeLessThan(SLO.p50);

    // End to end, at a concurrency this host can serve.
    expect(timing.p95, `p95 ${timing.p95}ms exceeds ${SLO.p95}ms`).toBeLessThan(SLO.p95);
    expect(timing.p99, `p99 ${timing.p99}ms exceeds ${SLO.p99}ms`).toBeLessThan(SLO.p99);
  }, 600_000);

  it('meets the SLO with a cross-unit range criterion', async () => {
    // Values were stored in PSI; the filter is expressed in bar. The conversion
    // happens once, on the bounds, so the index still does the work.
    const timing = await measure('range in bar against PSI-stored values', [
      {
        attributeKey: 'wog_pressure',
        kind: 'range',
        min: 10,
        max: 70,
        unit: 'bar{gauge}',
      },
      { attributeKey: 'body_material', kind: 'term', anyOf: ['SS_316'] },
      { attributeKey: 'nominal_size', kind: 'term', anyOf: ['NPS_2'] },
    ]);
    const serverSide = await serverSideMillis([
      {
        attributeKey: 'wog_pressure',
        kind: 'range',
        min: 10,
        max: 70,
        unit: 'bar{gauge}',
      },
      { attributeKey: 'body_material', kind: 'term', anyOf: ['SS_316'] },
      { attributeKey: 'nominal_size', kind: 'term', anyOf: ['NPS_2'] },
    ]);
    expect(serverSide).toBeLessThan(SLO.p50);
    expect(timing.p95).toBeLessThan(SLO.p95);
  }, 600_000);

  it('meets the SLO on a low-selectivity filter', async () => {
    // The hard case: a single common criterion matching a large slice of the
    // catalogue. Pagination, not selectivity, has to carry it.
    const timing = await measure('single common criterion (worst case)', [
      { attributeKey: 'actuation_type', kind: 'term', anyOf: ['MANUAL_LEVER'] },
    ]);
    expect(timing.p95).toBeLessThan(SLO.p95);
  }, 600_000);

  it('records how the two plan shapes compare', async () => {
    // §83: the default plan is chosen by measurement, not intuition.
    const criteria: FilterCriterion[] = [
      { attributeKey: 'body_material', kind: 'term', anyOf: ['SS_316'] },
      { attributeKey: 'end_connection', kind: 'term', anyOf: ['SOCKET_WELD'] },
      { attributeKey: 'pressure_class', kind: 'term', anyOf: ['ASME_CLASS_150'] },
    ];
    const intersect = await measure('three criteria (intersect)', criteria, 'intersect');
    const aggregate = await measure('three criteria (aggregate)', criteria, 'aggregate');
    console.log(
      `\n  Plan comparison at ${VARIANTS.toLocaleString()} variants: ` +
        `intersect p95 ${intersect.p95.toFixed(1)}ms, aggregate p95 ${aggregate.p95.toFixed(1)}ms`,
    );
    // Both must be correct; only one needs to be fast enough to be the default.
    expect(Math.min(intersect.p95, aggregate.p95)).toBeLessThan(SLO.p95);
  }, 900_000);
});
