import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { createTestDatabase, type TestDatabase } from '../support/database.js';
import { applyRealMetadata } from '../support/metadata.js';
import { testContext, testDeps } from '../support/context.js';
import { withUnitOfWork } from '../../src/kernel/unit-of-work.js';
import { syncEventRegistry, readEvents } from '../../src/modules/events/index.js';
import {
  candidateValues,
  createProduct,
  createVariant,
  detectFacetDrift,
  loadCatalogDeps,
  pimEvents,
  rebuildAllFacets,
  resolvedAttributes,
  searchVariants,
  facetCounts,
  SearchCriterionError,
  setAttributeValues,
  setVariantLifecycle,
  AttributeValueError,
  loadUnitRegistry,
  loadAttributeRegistry,
  type CatalogDeps,
} from '../../src/modules/pim/index.js';
import { seedCatalog, seedConflictingSource } from '../../tools/seed-data.js';
import type { Database } from '../../src/platform/db/index.js';

const deps = testDeps();

async function variantIdFor(db: Database, mpn: string): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    SELECT id FROM pim.variant WHERE manufacturer_part_number = ${mpn}
  `.execute(db);
  return rows[0]!.id;
}

describe('product catalogue', () => {
  let testDb: TestDatabase;
  let catalog: CatalogDeps;

  beforeAll(async () => {
    testDb = await createTestDatabase('catalog');
    await applyRealMetadata(testDb.db);
    await syncEventRegistry(testDb.db, [...pimEvents]);
    await seedCatalog(testDb.db, deps);
    await seedConflictingSource(testDb.db, deps);
    catalog = await loadCatalogDeps(testDb.db);
  }, 120_000);

  afterAll(async () => {
    await testDb.close();
  });

  describe('immediate search consistency (acceptance criterion 5)', () => {
    it('makes a product filterable the instant its create call returns', async () => {
      // No projection wait, no eventual consistency window. The facet rows are written
      // in the same transaction as the canonical rows (ADR-0013).
      const created = await withUnitOfWork(
        testDb.db,
        testContext(),
        deps,
        async (uow) => {
          const { productId } = await createProduct(
            uow,
            {
              key: 'immediate_consistency_probe',
              brandKey: 'apollo',
              productTypeKey: 'ball_valve',
              name: 'Immediate consistency probe',
              attributes: [{ attributeKey: 'body_material', value: 'HASTELLOY_C276' }],
            },
            catalog,
          );
          return createVariant(
            uow,
            {
              productId,
              manufacturerPartNumber: 'PROBE-001',
              attributes: [
                { attributeKey: 'nominal_size', value: 'NPS_2' },
                { attributeKey: 'cv', value: { value: 199, unit: '[Cv]' } },
              ],
            },
            catalog,
          );
        },
      );

      const found = await searchVariants(
        testDb.db,
        {
          criteria: [
            { attributeKey: 'body_material', kind: 'term', anyOf: ['HASTELLOY_C276'] },
          ],
        },
        catalog.attributes,
        catalog.units,
      );

      expect(found.hits.map((h) => h.variantId)).toContain(created.variantId);
    });
  });

  describe('combination filtering (acceptance criterion 4)', () => {
    it('filters by size, material, connection, pressure class and certification together', async () => {
      const result = await searchVariants(
        testDb.db,
        {
          criteria: [
            { attributeKey: 'nominal_size', kind: 'term', anyOf: ['NPS_1'] },
            { attributeKey: 'body_material', kind: 'term', anyOf: ['SS_316'] },
            { attributeKey: 'end_connection', kind: 'term', anyOf: ['SOCKET_WELD'] },
            { attributeKey: 'pressure_class', kind: 'term', anyOf: ['ASME_CLASS_300'] },
            { attributeKey: 'certifications', kind: 'term', anyOf: ['API_607'] },
          ],
        },
        catalog.attributes,
        catalog.units,
      );

      expect(result.hits).toHaveLength(1);
      expect(result.hits[0]!.manufacturerPartNumber).toBe('76F-105-01');
    });

    it('produces the same answer under either plan shape', async () => {
      const criteria = [
        { attributeKey: 'body_material', kind: 'term', anyOf: ['SS_316'] },
        { attributeKey: 'end_connection', kind: 'term', anyOf: ['SOCKET_WELD'] },
      ] as const;

      const intersect = await searchVariants(
        testDb.db,
        { criteria: [...criteria], plan: 'intersect' },
        catalog.attributes,
        catalog.units,
      );
      const aggregate = await searchVariants(
        testDb.db,
        { criteria: [...criteria], plan: 'aggregate' },
        catalog.attributes,
        catalog.units,
      );

      expect(aggregate.hits.map((h) => h.variantId).sort()).toEqual(
        intersect.hits.map((h) => h.variantId).sort(),
      );
      expect(intersect.hits.length).toBe(4);
    });

    it('resolves aliases in filter values, so source spellings work', async () => {
      const result = await searchVariants(
        testDb.db,
        { criteria: [{ attributeKey: 'body_material', kind: 'term', anyOf: ['316SS'] }] },
        catalog.attributes,
        catalog.units,
      );
      expect(result.hits.length).toBeGreaterThan(0);
    });

    it('counts remaining facet values across the restricted result set', async () => {
      const counts = await facetCounts(
        testDb.db,
        {
          criteria: [{ attributeKey: 'body_material', kind: 'term', anyOf: ['SS_316'] }],
        },
        catalog.attributes,
        catalog.units,
        ['nominal_size'],
      );
      // Counts describe what is still reachable, not the whole catalogue.
      const sizes = counts.map((c) => c.termCode);
      expect(sizes).toContain('NPS_3_4');
      expect(sizes).not.toContain('NPS_6');
    });
  });

  describe('cross-unit matching (acceptance criterion 6)', () => {
    it('matches a value entered in bar against a filter expressed in PSI', async () => {
      // 76F-104-01 was entered as 68.9 barg. Nothing converted it on the way in; the
      // normalized base value is what the index holds.
      const result = await searchVariants(
        testDb.db,
        {
          criteria: [
            {
              attributeKey: 'wog_pressure',
              kind: 'range',
              min: 990,
              max: 1010,
              unit: '[psig]',
            },
            { attributeKey: 'body_material', kind: 'term', anyOf: ['SS_316'] },
          ],
        },
        catalog.attributes,
        catalog.units,
      );

      const found = result.hits.map((h) => h.manufacturerPartNumber);
      expect(found).toContain('76F-104-01'); // entered as 68.9 barg
      expect(found).toContain('76F-105-01'); // entered as 1000 psig
    });

    it('preserves the original value and unit alongside the normalized one', async () => {
      const variantId = await variantIdFor(testDb.db, '76F-104-01');
      const attributes = await resolvedAttributes(testDb.db, variantId);
      const pressure = attributes.find((a) => a.attributeKey === 'wog_pressure')!;

      expect(pressure.originalValue).toBe('68.9');
      expect(pressure.originalUnit).toBe('bar{gauge}');
      expect(pressure.enteredRaw).toBe('68.9 barg');
      // The normalized value is pascals gauge, which is what the filter compared.
      expect(Number(pressure.numericBase)).toBeCloseTo(6_890_000, 0);
    });

    it('returns the equivalent in any unit of the same dimension on request', async () => {
      const variantId = await variantIdFor(testDb.db, '76F-104-01');
      const attributes = await resolvedAttributes(testDb.db, variantId);
      const pressure = attributes.find((a) => a.attributeKey === 'wog_pressure')!;

      const inPsi = catalog.units.fromBase(pressure.numericBase!, '[psig]');
      expect(Number(inPsi.value.toString())).toBeCloseTo(999.3, 1);
    });

    it('refuses a range filter on a pressure class', async () => {
      // The query layer's half of ADR-0016: Class 150 is a designation, so "pressure
      // class between 100 and 200" is not a question the system will answer.
      await expect(
        searchVariants(
          testDb.db,
          {
            criteria: [
              { attributeKey: 'pressure_class', kind: 'range', min: 100, max: 200 },
            ],
          },
          catalog.attributes,
          catalog.units,
        ),
      ).rejects.toThrow(SearchCriterionError);
    });

    it('refuses a range filter whose unit measures the wrong dimension', async () => {
      await expect(
        searchVariants(
          testDb.db,
          {
            criteria: [
              { attributeKey: 'wog_pressure', kind: 'range', min: 1, max: 2, unit: 'mm' },
            ],
          },
          catalog.attributes,
          catalog.units,
        ),
      ).rejects.toThrow(/measures LENGTH/);
    });
  });

  describe('inheritance (spec §27)', () => {
    it('inherits a product-level value and reports where it came from', async () => {
      const variantId = await variantIdFor(testDb.db, '76F-105-01');
      const attributes = await resolvedAttributes(testDb.db, variantId);
      const material = attributes.find((a) => a.attributeKey === 'body_material')!;

      expect(material.termCode).toBe('SS_316');
      expect(material.sourceLevel).toBe('PRODUCT');
      expect(material.sourceSystemCode).toBe('MANUAL');
    });

    it('lets a variant override an inherited value', async () => {
      // The 76F product is manually actuated; this variant is electric.
      const variantId = await variantIdFor(testDb.db, '76F-106-01-EA');
      const attributes = await resolvedAttributes(testDb.db, variantId);

      const actuation = attributes.find((a) => a.attributeKey === 'actuation_type')!;
      expect(actuation.termCode).toBe('ELECTRIC');
      expect(actuation.sourceLevel).toBe('VARIANT');

      const material = attributes.find((a) => a.attributeKey === 'body_material')!;
      expect(material.sourceLevel).toBe('PRODUCT');
    });

    it('fans a product-level change out to every variant beneath it', async () => {
      const productId = (
        await sql<{
          id: string;
        }>`SELECT id FROM pim.product WHERE key = 'bray_series_30'`.execute(testDb.db)
      ).rows[0]!.id;

      await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
        await setAttributeValues(
          uow,
          { level: 'PRODUCT', id: productId },
          [{ attributeKey: 'seal_material', value: 'FKM' }],
          catalog,
        );
      });

      const result = await searchVariants(
        testDb.db,
        { criteria: [{ attributeKey: 'seal_material', kind: 'term', anyOf: ['FKM'] }] },
        catalog.attributes,
        catalog.units,
      );
      expect(result.hits).toHaveLength(3);
    });

    it('keeps multi-valued attributes as separate rows', async () => {
      const variantId = await variantIdFor(testDb.db, '76F-105-01');
      const attributes = await resolvedAttributes(testDb.db, variantId);
      const certifications = attributes.filter(
        (a) => a.attributeKey === 'certifications',
      );
      expect(certifications.map((c) => c.termCode).sort()).toEqual([
        'API_607',
        'NACE_MR0175',
      ]);
    });
  });

  describe('survivorship and provenance (acceptance criterion 10)', () => {
    it('shows both source values, which won, and why', async () => {
      // The manufacturer catalogue says Cv 15.6; P21 says 14.9. Both are kept.
      const variantId = await variantIdFor(testDb.db, '77C-103-01');
      const candidates = await candidateValues(
        testDb.db,
        { level: 'VARIANT', id: variantId },
        'cv',
      );

      expect(candidates).toHaveLength(2);
      const sources = candidates.map((c) => c.sourceSystemCode).sort();
      expect(sources).toEqual(['MANUAL', 'P21']);

      const winner = candidates.find((c) => c.isSelected)!;
      expect(winner.sourceSystemCode).toBe('MANUAL');
      expect(winner.selectedReason).toMatch(/highest precedence/);
      expect(winner.selectedReason).toMatch(/2 candidate/);

      const loser = candidates.find((c) => !c.isSelected)!;
      expect(loser.sourceSystemCode).toBe('P21');
      // The losing value is not destroyed. It stays as evidence of what P21 said.
      expect(loser.enteredRaw).toBe('14.9');
    });

    it('lets a verified value beat a higher-precedence source', async () => {
      const variantId = await variantIdFor(testDb.db, '77C-104-01');

      await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
        await setAttributeValues(
          uow,
          { level: 'VARIANT', id: variantId },
          [
            {
              attributeKey: 'cv',
              value: { value: 31.4, unit: '[Cv]' },
              sourceSystemCode: 'MFR_CATALOG',
              verificationStatus: 'VERIFIED',
              verifiedBy: '01920000-0000-7000-8000-000000000001',
            },
          ],
          catalog,
        );
      });

      const candidates = await candidateValues(
        testDb.db,
        { level: 'VARIANT', id: variantId },
        'cv',
      );
      const winner = candidates.find((c) => c.isSelected)!;
      // MFR_CATALOG has lower precedence than MANUAL, but it is verified.
      expect(winner.sourceSystemCode).toBe('MFR_CATALOG');
      expect(winner.selectedReason).toMatch(/verified/);
    });

    it('reflects the new survivor in the projection immediately', async () => {
      const variantId = await variantIdFor(testDb.db, '77C-104-01');
      const attributes = await resolvedAttributes(testDb.db, variantId);
      expect(attributes.find((a) => a.attributeKey === 'cv')!.originalValue).toBe('31.4');
    });
  });

  describe('data quality (acceptance criterion 22)', () => {
    it('excludes a variant missing a required Cv from the publishable view', async () => {
      const { rows } = await sql<{ mpn: string }>`
        SELECT v.manufacturer_part_number AS mpn
          FROM pim.publishable_variant pv
          JOIN pim.variant v ON v.id = pv.variant_id
         WHERE pv.channel_code = 'VALVEMAN'
      `.execute(testDb.db);

      const publishable = rows.map((r) => r.mpn);
      expect(publishable).not.toContain('77C-106-01');
      expect(publishable).toContain('77C-103-01');
    });

    it('says exactly what is missing and why it was required', async () => {
      const variantId = await variantIdFor(testDb.db, '77C-106-01');
      const { rows } = await sql<{
        severity: string;
        attribute_key: string;
        message: string;
      }>`
        SELECT severity, attribute_key, message
          FROM pim.variant_quality_finding
         WHERE variant_id = ${variantId}::uuid AND channel_code = 'VALVEMAN'
         ORDER BY attribute_key NULLS LAST
      `.execute(testDb.db);

      const cv = rows.find((r) => r.attribute_key === 'cv')!;
      expect(cv.severity).toBe('BLOCKING');
      expect(cv.message).toMatch(/Flow coefficient \(Cv\) is required for ball_valve/);

      const sku = rows.find((r) => r.attribute_key === null)!;
      expect(sku.message).toMatch(/no VALVEMAN_SKU identifier/);
    });

    it('applies a conditional requirement only when its condition holds', async () => {
      // Voltage is required for an electrically actuated valve and not for a manual one.
      const electric = await variantIdFor(testDb.db, '76F-107-01-EA');
      const manual = await variantIdFor(testDb.db, '77C-103-01');

      const findings = await sql<{
        variant_id: string;
        attribute_key: string;
        message: string;
      }>`
        SELECT variant_id, attribute_key, message FROM pim.variant_quality_finding
         WHERE attribute_key = 'voltage' AND channel_code = 'INTERNAL'
      `.execute(testDb.db);

      const affected = findings.rows.map((r) => r.variant_id);
      expect(affected).toContain(electric);
      expect(affected).not.toContain(manual);

      // And the finding explains why the rule applied at all.
      const message = findings.rows.find((r) => r.variant_id === electric)!.message;
      expect(message).toMatch(/It applies here because actuation_type is one of/);
    });

    it('recovers publishability when the missing value is supplied', async () => {
      const variantId = await variantIdFor(testDb.db, '76F-107-01-EA');

      await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
        await setAttributeValues(
          uow,
          { level: 'VARIANT', id: variantId },
          [
            { attributeKey: 'voltage', value: { value: 24, unit: 'V' } },
            { attributeKey: 'fail_position', value: 'FAIL_CLOSED' },
          ],
          catalog,
        );
      });

      const { rows } = await sql<{ is_publishable: boolean }>`
        SELECT is_publishable FROM pim.variant_quality
         WHERE variant_id = ${variantId}::uuid AND channel_code = 'VALVEMAN'
      `.execute(testDb.db);
      expect(rows[0]!.is_publishable).toBe(true);
    });
  });

  describe('validation at the write boundary', () => {
    it('applies an attribute default unit explicitly, and records it', async () => {
      // A bare number is accepted only where the attribute declares a default unit,
      // and the unit is then stored rather than left implied (spec §31).
      const variantId = await variantIdFor(testDb.db, '77C-105-01');
      await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
        await setAttributeValues(
          uow,
          { level: 'VARIANT', id: variantId },
          [{ attributeKey: 'working_pressure', value: 600 }],
          catalog,
        );
      });
      const attributes = await resolvedAttributes(testDb.db, variantId);
      const pressure = attributes.find((a) => a.attributeKey === 'working_pressure')!;
      expect(pressure.originalUnit).toBe('[psig]');
      expect(pressure.enteredRaw).toBe('600 [psig]');
    });

    it('refuses a unit it cannot resolve, rather than guessing', async () => {
      const variantId = await variantIdFor(testDb.db, '77C-105-01');
      await expect(
        withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
          await setAttributeValues(
            uow,
            { level: 'VARIANT', id: variantId },
            [{ attributeKey: 'wog_pressure', value: { value: 600, unit: 'furlongs' } }],
            catalog,
          );
        }),
      ).rejects.toThrow(AttributeValueError);
    });

    it('refuses a term that does not resolve, rather than storing the raw string', async () => {
      const variantId = await variantIdFor(testDb.db, '77C-105-01');
      await expect(
        withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
          await setAttributeValues(
            uow,
            { level: 'VARIANT', id: variantId },
            [{ attributeKey: 'body_material', value: 'unobtainium' }],
            catalog,
          );
        }),
      ).rejects.toThrow(/does not resolve to a term/);
    });

    it('refuses a value outside the attribute bounds', async () => {
      const variantId = await variantIdFor(testDb.db, '77C-105-01');
      await expect(
        withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
          await setAttributeValues(
            uow,
            { level: 'VARIANT', id: variantId },
            [{ attributeKey: 'cv', value: { value: -5, unit: '[Cv]' } }],
            catalog,
          );
        }),
      ).rejects.toThrow(/below the minimum/);
    });
  });

  describe('optimistic concurrency (acceptance criterion 25)', () => {
    it('rejects a stale write instead of silently overwriting a newer one', async () => {
      const variantId = await variantIdFor(testDb.db, '8210G094');
      const startingVersion = (
        await sql<{ version: number }>`
          SELECT version FROM pim.variant WHERE id = ${variantId}::uuid
        `.execute(testDb.db)
      ).rows[0]!.version;

      // Both clients read the same version.
      await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
        await setVariantLifecycle(uow, variantId, 'NON_STOCK', startingVersion);
      });

      await expect(
        withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
          await setVariantLifecycle(uow, variantId, 'OBSOLETE', startingVersion);
        }),
      ).rejects.toThrow(/has been modified/);

      const after = await sql<{ lifecycle_status: string; version: number }>`
        SELECT lifecycle_status, version FROM pim.variant WHERE id = ${variantId}::uuid
      `.execute(testDb.db);
      // The first write stands; the second changed nothing.
      expect(after.rows[0]!.lifecycle_status).toBe('NON_STOCK');
      expect(after.rows[0]!.version).toBe(startingVersion + 1);
    });
  });

  describe('the projection is derived, not authoritative', () => {
    it('reports drift between the projection and canonical values', async () => {
      expect(await detectFacetDrift(testDb.db)).toEqual([]);

      const variantId = await variantIdFor(testDb.db, '8210G095');
      await sql`
        DELETE FROM pim.variant_facet
         WHERE variant_id = ${variantId}::uuid AND attribute_key = 'cv'
      `.execute(testDb.db);

      const drift = await detectFacetDrift(testDb.db);
      expect(drift).toContainEqual({ variantId, attributeKey: 'cv', problem: 'MISSING' });
    });

    it('rebuilds itself completely from canonical values', async () => {
      const rebuilt = await rebuildAllFacets(testDb.db);
      expect(rebuilt).toBeGreaterThan(0);
      expect(await detectFacetDrift(testDb.db)).toEqual([]);
    });
  });

  describe('events and audit (acceptance criteria 17 and 24)', () => {
    it('emits meaningful domain events for a catalogue change', async () => {
      const events = await readEvents(testDb.db, {
        after: '0',
        types: ['fsw.pim.*'],
        limit: 1000,
      });
      const types = new Set(events.map((e) => e.eventType));
      expect(types).toContain('fsw.pim.ProductCreated');
      expect(types).toContain('fsw.pim.VariantCreated');
      expect(types).toContain('fsw.pim.ProductAttributeValueChanged');
      expect(types).toContain('fsw.pim.VariantQualityEvaluated');
    });

    it('records the losing candidate as an event too, with why it lost', async () => {
      const events = await readEvents(testDb.db, {
        after: '0',
        types: ['fsw.pim.ProductAttributeValueChanged'],
        limit: 1000,
      });
      const fromP21 = events.filter(
        (e) => (e.payload as { sourceSystemCode: string }).sourceSystemCode === 'P21',
      );
      expect(fromP21.length).toBeGreaterThan(0);
      expect((fromP21[0]!.payload as { selected: boolean }).selected).toBe(false);
    });

    it('traces every catalogue write to an actor, an operation and a correlation', async () => {
      const { rows } = await sql<{
        actor_label: string;
        interface: string;
        operation: string;
        correlation_id: string;
      }>`
        SELECT actor_label, interface, operation, correlation_id
          FROM audit.change_log
         WHERE entity_schema = 'pim' AND entity_table = 'product'
         LIMIT 5
      `.execute(testDb.db);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.operation).toBe('INSERT');
        expect(row.actor_label).not.toBe('');
        expect(row.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
      }
    });
  });

  describe('metadata is loaded, not compiled in', () => {
    it('sees a newly defined attribute without a restart or a migration', async () => {
      // Simulates the configuration loader having run: metadata rows appear, and the
      // next registry load picks them up. No code changed; no DDL ran.
      await sql`
        INSERT INTO pim.attribute (key, name, description, value_type, max_length)
        VALUES ('service_notes', 'Service notes',
                'Free-text notes added after this application was built.', 'TEXT', 500)
      `.execute(testDb.db);
      await sql`
        INSERT INTO pim.product_type_attribute (product_type_key, attribute_key, requirement)
        VALUES ('ball_valve', 'service_notes', 'OPTIONAL')
      `.execute(testDb.db);

      const refreshed = {
        attributes: await loadAttributeRegistry(testDb.db),
        units: await loadUnitRegistry(testDb.db),
      };
      const variantId = await variantIdFor(testDb.db, '77C-105-01');

      await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
        await setAttributeValues(
          uow,
          { level: 'VARIANT', id: variantId },
          [
            {
              attributeKey: 'service_notes',
              value: 'Rebuild kit RK-77C fits this valve.',
            },
          ],
          refreshed,
        );
      });

      const found = await searchVariants(
        testDb.db,
        {
          criteria: [
            { attributeKey: 'service_notes', kind: 'text', contains: 'Rebuild kit' },
          ],
        },
        refreshed.attributes,
        refreshed.units,
      );
      expect(found.hits.map((h) => h.variantId)).toContain(variantId);
    });
  });
});
