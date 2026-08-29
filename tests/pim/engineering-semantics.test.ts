import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { createTestDatabase, type TestDatabase } from '../support/database.js';
import { applyRealMetadata } from '../support/metadata.js';
import {
  loadUnitRegistry,
  NotAQuantityError,
  UnknownUnitError,
  type UnitRegistry,
} from '../../src/modules/pim/index.js';

/**
 * Acceptance criterion 7, and the requirement in this specification with physical
 * consequences (ADR-0016).
 *
 * ASME Class 150 is not 150 PSI. It is a pressure-temperature rating designation:
 * a Class 150 carbon-steel flange is rated around 285 psig at ambient and well under
 * 150 psig at 750 F. NPS 1 is not 25.4 mm: NPS 1 pipe has an outside diameter of
 * 1.315 in.
 *
 * These tests prove the guarantees by attempting the wrong thing and requiring it to
 * fail -- in the type system, in the conversion service, and in the database.
 */
describe('engineering designations are not measurements (acceptance criterion 7)', () => {
  let testDb: TestDatabase;
  let units: UnitRegistry;

  beforeAll(async () => {
    testDb = await createTestDatabase('engsem');
    await applyRealMetadata(testDb.db);
    units = await loadUnitRegistry(testDb.db);
  });
  afterAll(async () => {
    await testDb.close();
  });

  describe('pressure class', () => {
    it('cannot be converted to a pressure', () => {
      expect(() => units.get('ASME_CLASS_150')).toThrow(NotAQuantityError);
      expect(() => units.toBase('1', 'ASME_CLASS_150')).toThrow(NotAQuantityError);
      expect(() => units.convert('150', 'ASME_CLASS_150', '[psig]')).toThrow(
        NotAQuantityError,
      );
    });

    it('explains why, rather than failing obscurely', () => {
      // A developer who tries this deserves to learn something, not to see
      // "unknown unit".
      try {
        units.get('ASME_CLASS_150');
        expect.unreachable('conversion should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NotAQuantityError);
        expect((error as Error).message).toMatch(/pressure class designation/);
        expect((error as Error).message).toMatch(/not a measurement/);
        expect((error as Error).message).toMatch(/working-pressure or WOG/);
      }
    });

    it('is stored as a designation with no numeric pressure anywhere on it', async () => {
      const { rows } = await sql<{
        code: string;
        designation: string | null;
        reference_standard: string | null;
        sort_ordinal: string | null;
      }>`
        SELECT t.code, t.designation, t.reference_standard, t.sort_ordinal
          FROM pim.vocabulary_term t
         WHERE t.vocabulary_key = 'pressure_class' AND t.code = 'ASME_CLASS_150'
      `.execute(testDb.db);

      const term = rows[0]!;
      expect(term.designation).toBe('150');
      expect(term.reference_standard).toBe('ASME B16.34');
      // sort_ordinal exists for ordering. It is not a pressure and there is no column
      // on a term that could hold one: no unit, no dimension, no quantity.
      expect(term.sort_ordinal).toBe('150');

      const columns = await sql<{ column_name: string }>`
        SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'pim' AND table_name = 'vocabulary_term'
      `.execute(testDb.db);
      const names = columns.rows.map((r) => r.column_name);
      expect(names).not.toContain('unit_code');
      expect(names).not.toContain('dimension_code');
      expect(names).not.toContain('quantity_value');
    });

    it('is a distinct attribute value type from any pressure quantity', async () => {
      const { rows } = await sql<{
        key: string;
        value_type: string;
        dimension_code: string | null;
        vocabulary_key: string | null;
      }>`
        SELECT key, value_type, dimension_code, vocabulary_key
          FROM pim.attribute WHERE key IN ('pressure_class', 'wog_pressure')
         ORDER BY key
      `.execute(testDb.db);

      const [pressureClass, wog] = rows;
      expect(pressureClass!.value_type).toBe('PRESSURE_CLASS');
      expect(pressureClass!.dimension_code).toBeNull();
      expect(pressureClass!.vocabulary_key).toBe('pressure_class');

      expect(wog!.value_type).toBe('QUANTITY');
      expect(wog!.dimension_code).toBe('PRESSURE_GAUGE');
      expect(wog!.vocabulary_key).toBeNull();
    });

    it('cannot be defined as an attribute that carries a dimension', async () => {
      // The database refuses the shape, so no code path can produce it.
      await expect(
        sql`
          INSERT INTO pim.attribute (key, name, description, value_type, vocabulary_key, dimension_code)
          VALUES ('bad_class', 'Bad', 'A pressure class pretending to be a measurement.',
                  'PRESSURE_CLASS', 'pressure_class', 'PRESSURE_GAUGE')
        `.execute(testDb.db),
      ).rejects.toThrow(/quantity_requires_dimension/);
    });

    it('cannot be pointed at by an attribute of the wrong designation kind', async () => {
      await expect(
        sql`
          INSERT INTO pim.attribute (key, name, description, value_type, vocabulary_key)
          VALUES ('bad_size', 'Bad', 'A nominal size attribute using a pressure class vocabulary.',
                  'NOMINAL_SIZE', 'pressure_class')
        `.execute(testDb.db),
      ).rejects.toThrow(/foreign key|attribute_vocabulary/i);
    });
  });

  describe('nominal size', () => {
    it('cannot be converted to a length', () => {
      expect(() => units.get('NPS_1')).toThrow(NotAQuantityError);
      expect(() => units.convert('1', 'NPS_1', 'mm')).toThrow(NotAQuantityError);
    });

    it('is not 25.4 mm, and the system has no way to claim that it is', async () => {
      const { rows } = await sql<{
        code: string;
        size_system: string | null;
        designation: string | null;
        sort_ordinal: string | null;
      }>`
        SELECT code, size_system, designation, sort_ordinal
          FROM pim.vocabulary_term
         WHERE vocabulary_key = 'nominal_size' AND code = 'NPS_1'
      `.execute(testDb.db);

      const term = rows[0]!;
      expect(term.size_system).toBe('NPS');
      expect(term.designation).toBe('1');
      // The ordinal is an ordering aid drawn from the DN correspondence. It is not a
      // measurement: NPS 1 pipe has an outside diameter of 1.315 in, not 25 mm.
      expect(term.sort_ordinal).toBe('25');

      // face_to_face and bore_diameter are real lengths. nominal_size is not.
      const attributes = await sql<{
        key: string;
        value_type: string;
        dimension_code: string | null;
      }>`
        SELECT key, value_type, dimension_code FROM pim.attribute
         WHERE key IN ('nominal_size', 'face_to_face', 'bore_diameter') ORDER BY key
      `.execute(testDb.db);
      const byKey = new Map(attributes.rows.map((r) => [r.key, r]));
      expect(byKey.get('nominal_size')!.value_type).toBe('NOMINAL_SIZE');
      expect(byKey.get('nominal_size')!.dimension_code).toBeNull();
      expect(byKey.get('face_to_face')!.value_type).toBe('QUANTITY');
      expect(byKey.get('face_to_face')!.dimension_code).toBe('LENGTH');
      expect(byKey.get('bore_diameter')!.dimension_code).toBe('LENGTH');
    });

    it('keeps NPS and DN as separate designations rather than equating them', async () => {
      // NPS 1 and DN 25 correspond by convention. They are not the same designation,
      // and the system does not pretend otherwise.
      const { rows } = await sql<{ code: string; size_system: string }>`
        SELECT code, size_system FROM pim.vocabulary_term
         WHERE vocabulary_key = 'nominal_size' AND code IN ('NPS_1', 'DN_25')
         ORDER BY code
      `.execute(testDb.db);
      expect(rows.map((r) => r.code)).toEqual(['DN_25', 'NPS_1']);
      expect(rows.map((r) => r.size_system)).toEqual(['DN', 'NPS']);
    });

    it('does not confuse the half-inch and twelve-inch designations', async () => {
      // The alias '1/2' must not normalize to the same lookup key as '12'. Getting
      // this wrong turns a half-inch valve into a twelve-inch one.
      const { rows } = await sql<{ normalized_alias: string; code: string }>`
        SELECT a.normalized_alias, t.code
          FROM pim.vocabulary_term_alias a
          JOIN pim.vocabulary_term t ON t.id = a.term_id
         WHERE a.vocabulary_key = 'nominal_size'
           AND a.normalized_alias IN ('1/2', '12')
         ORDER BY a.normalized_alias
      `.execute(testDb.db);
      expect(rows).toEqual([
        { normalized_alias: '1/2', code: 'NPS_1_2' },
        { normalized_alias: '12', code: 'NPS_12' },
      ]);
    });
  });

  describe('the guard as a whole', () => {
    it('treats every designation vocabulary as unconvertible', async () => {
      const { rows } = await sql<{ code: string }>`
        SELECT t.code FROM pim.vocabulary_term t
          JOIN pim.vocabulary v ON v.key = t.vocabulary_key
         WHERE v.is_designation
      `.execute(testDb.db);
      expect(rows.length).toBeGreaterThan(30);
      for (const row of rows) {
        expect(() => units.get(row.code), `${row.code} must not convert`).toThrow(
          NotAQuantityError,
        );
      }
    });

    it('still reports an ordinary typo as an unknown unit', () => {
      // The designation guard must not swallow every failure.
      expect(() => units.get('psgi')).toThrow(UnknownUnitError);
    });
  });
});
