import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { createTestDatabase, type TestDatabase } from '../support/database.js';
import { METADATA_DIR } from '../support/metadata.js';
import {
  readMetadata,
  applyMetadata,
  planMetadata,
  MetadataValidationError,
  BreakingMetadataChangeError,
} from '../../src/modules/pim/index.js';

/**
 * Acceptance criterion 3, metadata half (ADR-0017).
 *
 * Create a product type the application has never heard of, with attributes that did
 * not exist when it was built, using a vocabulary that did not exist either. No source
 * code changes. No hand-written migration. No runtime DDL.
 *
 * The test asserts the absence of a migration explicitly, because "no migration" is
 * the part of the criterion that is easiest to satisfy by accident and hardest to
 * notice breaking.
 */
describe('metadata is configuration, not code (acceptance criterion 3)', () => {
  let testDb: TestDatabase;
  let workDir: string;

  beforeAll(async () => {
    testDb = await createTestDatabase('metaload');
  });
  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'fsw-metadata-'));
    // Start from the shipped configuration, so additions are additions rather than a
    // wholesale replacement that would deprecate everything else.
    await cp(METADATA_DIR, workDir, { recursive: true });
  });

  async function cleanup(): Promise<void> {
    await rm(workDir, { recursive: true, force: true });
  }

  async function write(relativePath: string, contents: string): Promise<void> {
    const full = join(workDir, relativePath);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, contents, 'utf8');
  }

  async function migrationCount(): Promise<number> {
    const { rows } = await sql<{ count: string }>`
      SELECT count(*)::text AS count FROM kernel.schema_migration
    `.execute(testDb.db);
    return Number(rows[0]!.count);
  }

  async function tableCount(): Promise<number> {
    const { rows } = await sql<{ count: string }>`
      SELECT count(*)::text AS count FROM information_schema.tables
       WHERE table_schema IN ('pim', 'kernel', 'events', 'audit')
    `.execute(testDb.db);
    return Number(rows[0]!.count);
  }

  it('creates an unknown product type with new attributes and no schema change', async () => {
    const migrationsBefore = await migrationCount();
    const tablesBefore = await tableCount();

    // A product type nobody anticipated, using a vocabulary and attributes that did
    // not exist when this application was compiled.
    await write(
      'vocabularies/cryogenic.yaml',
      `key: insulation_type
name: Insulation type
description: Thermal insulation arrangement on a cryogenic valve.
terms:
  - { code: VACUUM_JACKETED, label: Vacuum jacketed, sortOrdinal: 10, aliases: [{ alias: "VJ" }] }
  - { code: FOAM_INSULATED,  label: Foam insulated,  sortOrdinal: 20 }
  - { code: UNINSULATED,     label: Uninsulated,     sortOrdinal: 30 }
`,
    );
    await write(
      'attributes/cryogenic.yaml',
      `attributes:
  - key: insulation_type
    name: Insulation type
    description: Thermal insulation arrangement.
    valueType: ENUM
    vocabulary: insulation_type
  - key: extended_bonnet_length
    name: Extended bonnet length
    description: Length of the extended bonnet that keeps the packing out of the cold zone.
    valueType: QUANTITY
    dimension: LENGTH
    defaultUnit: "[in_i]"
    numericScale: 3
    minNumeric: "0"
  - key: boil_off_rate
    name: Boil-off rate
    description: Rate at which cryogenic fluid vaporises through the valve assembly.
    valueType: QUANTITY
    dimension: FLOW_VOLUMETRIC
    defaultUnit: "L/min"
    numericScale: 4
    minNumeric: "0"
`,
    );
    await write(
      'product-types/cryogenic.yaml',
      `productTypes:
  - key: cryogenic_globe_valve
    name: Cryogenic globe valve
    description: Globe valve for cryogenic service, with an extended bonnet.
    parent: globe_valve
    attributes:
      - { attribute: insulation_type, requirement: REQUIRED, level: VARIANT, sortOrder: 10 }
      - { attribute: temperature_min, requirement: REQUIRED, level: VARIANT, sortOrder: 20 }
      - attribute: extended_bonnet_length
        requirement: REQUIRED
        level: VARIANT
        sortOrder: 30
        condition: { all: [{ attr: insulation_type, op: ne, value: UNINSULATED }] }
        conditionNote: >-
          An uninsulated cryogenic valve has no extended bonnet to measure, so the
          dimension is required only when insulation is present.
      - { attribute: boil_off_rate, requirement: OPTIONAL, level: VARIANT, sortOrder: 40 }
`,
    );

    const parsed = await readMetadata(workDir);
    const result = await applyMetadata(testDb.db, parsed, { actor: 'ac3-test' });

    expect(result.applied).toBe(true);
    expect(result.breaking).toEqual([]);

    // No migration ran, and no table, column, index or view was created.
    expect(await migrationCount()).toBe(migrationsBefore);
    expect(await tableCount()).toBe(tablesBefore);

    const productType = await sql<{ key: string; parent_key: string | null }>`
      SELECT key, parent_key FROM pim.product_type WHERE key = 'cryogenic_globe_valve'
    `.execute(testDb.db);
    expect(productType.rows[0]).toEqual({
      key: 'cryogenic_globe_valve',
      parent_key: 'globe_valve',
    });

    const attributes = await sql<{
      key: string;
      value_type: string;
      dimension_code: string | null;
    }>`
      SELECT key, value_type, dimension_code FROM pim.attribute
       WHERE key IN ('insulation_type', 'extended_bonnet_length', 'boil_off_rate')
       ORDER BY key
    `.execute(testDb.db);
    expect(attributes.rows).toEqual([
      { key: 'boil_off_rate', value_type: 'QUANTITY', dimension_code: 'FLOW_VOLUMETRIC' },
      { key: 'extended_bonnet_length', value_type: 'QUANTITY', dimension_code: 'LENGTH' },
      { key: 'insulation_type', value_type: 'ENUM', dimension_code: null },
    ]);

    const conditional = await sql<{ attribute_key: string; condition: unknown }>`
      SELECT attribute_key, condition FROM pim.product_type_attribute
       WHERE product_type_key = 'cryogenic_globe_valve' AND condition IS NOT NULL
    `.execute(testDb.db);
    expect(conditional.rows).toHaveLength(1);
    expect(conditional.rows[0]!.attribute_key).toBe('extended_bonnet_length');

    await cleanup();
  });

  it('is idempotent', async () => {
    const parsed = await readMetadata(workDir);
    const first = await applyMetadata(testDb.db, parsed, { actor: 'test' });
    const second = await applyMetadata(testDb.db, parsed, { actor: 'test' });
    expect(second.changes).toEqual([]);
    expect(second.unchanged).toBe(true);
    expect(first.contentHash).toBe(second.contentHash);
    await cleanup();
  });

  it('reports a plan without writing anything', async () => {
    await write(
      'attributes/planned.yaml',
      `attributes:
  - key: planned_only
    name: Planned only
    description: Exists to prove a dry run writes nothing.
    valueType: TEXT
`,
    );
    const parsed = await readMetadata(workDir);
    const plan = await planMetadata(testDb.db, parsed, { actor: 'test' });

    expect(plan.applied).toBe(false);
    expect(plan.changes.some((c) => c.key === 'planned_only')).toBe(true);

    const { rows } = await sql`
      SELECT 1 FROM pim.attribute WHERE key = 'planned_only'
    `.execute(testDb.db);
    expect(rows).toHaveLength(0);
    await cleanup();
  });

  it('refuses a change that would reinterpret existing values', async () => {
    await write(
      'attributes/reinterpret.yaml',
      `attributes:
  - key: reinterpret_me
    name: Reinterpret me
    description: Starts as text.
    valueType: TEXT
`,
    );
    await applyMetadata(testDb.db, await readMetadata(workDir), { actor: 'test' });

    // Pretend values exist, which is what makes the change destructive rather than
    // merely a redefinition. (pim.attribute_value arrives in the next phase; the
    // loader consults it through to_regclass, so this stands in for it.)
    await sql`
      CREATE TABLE IF NOT EXISTS pim.attribute_value (
        id uuid PRIMARY KEY DEFAULT kernel.uuid_generate_v7(),
        attribute_key text NOT NULL
      )
    `.execute(testDb.db);
    await sql`
      INSERT INTO pim.attribute_value (attribute_key) VALUES ('reinterpret_me')
    `.execute(testDb.db);

    await write(
      'attributes/reinterpret.yaml',
      `attributes:
  - key: reinterpret_me
    name: Reinterpret me
    description: Now claims to be a pressure.
    valueType: QUANTITY
    dimension: PRESSURE_GAUGE
`,
    );
    const changed = await readMetadata(workDir);

    await expect(applyMetadata(testDb.db, changed, { actor: 'test' })).rejects.toThrow(
      BreakingMetadataChangeError,
    );

    // Still text: the refusal left nothing half-applied.
    const { rows } = await sql<{ value_type: string }>`
      SELECT value_type FROM pim.attribute WHERE key = 'reinterpret_me'
    `.execute(testDb.db);
    expect(rows[0]!.value_type).toBe('TEXT');

    // Explicit consent applies it and bumps the definition version.
    const forced = await applyMetadata(testDb.db, changed, {
      actor: 'test',
      allowBreaking: true,
    });
    expect(forced.breaking).toHaveLength(1);
    const after = await sql<{ value_type: string; definition_version: number }>`
      SELECT value_type, definition_version FROM pim.attribute WHERE key = 'reinterpret_me'
    `.execute(testDb.db);
    expect(after.rows[0]!.value_type).toBe('QUANTITY');
    expect(after.rows[0]!.definition_version).toBe(2);

    await sql`DROP TABLE pim.attribute_value`.execute(testDb.db);
    await cleanup();
  });

  it('deprecates rather than deletes when something leaves the configuration', async () => {
    await write(
      'attributes/temporary.yaml',
      `attributes:
  - key: temporary_attribute
    name: Temporary
    description: Will be removed from configuration.
    valueType: TEXT
`,
    );
    await applyMetadata(testDb.db, await readMetadata(workDir), { actor: 'test' });

    await rm(join(workDir, 'attributes/temporary.yaml'));
    const result = await applyMetadata(testDb.db, await readMetadata(workDir), {
      actor: 'test',
    });

    expect(
      result.changes.some(
        (c) => c.kind === 'DEPRECATE' && c.key === 'temporary_attribute',
      ),
    ).toBe(true);

    // The row survives, because values recorded against it remain meaningful.
    const { rows } = await sql<{ key: string; deprecated_at: Date | null }>`
      SELECT key, deprecated_at FROM pim.attribute WHERE key = 'temporary_attribute'
    `.execute(testDb.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deprecated_at).not.toBeNull();
    await cleanup();
  });

  it('rejects an ENUM attribute pointed at a designation vocabulary', async () => {
    // The ADR-0016 guard, at the configuration layer: Class 150 must not be reachable
    // as an ordinary comparable enum value.
    await write(
      'attributes/bad-enum.yaml',
      `attributes:
  - key: sneaky_class
    name: Sneaky class
    description: An ENUM pointed at the pressure class vocabulary.
    valueType: ENUM
    vocabulary: pressure_class
`,
    );
    await expect(readMetadata(workDir)).rejects.toThrow(MetadataValidationError);
    try {
      await readMetadata(workDir);
    } catch (error) {
      expect((error as MetadataValidationError).problems.join('\n')).toMatch(
        /designation vocabulary.*Use valueType PRESSURE_CLASS/s,
      );
    }
    await cleanup();
  });

  it('rejects a rule that can never fire', async () => {
    await write(
      'product-types/impossible.yaml',
      `productTypes:
  - key: impossible_type
    name: Impossible
    description: Declares a rule about an attribute it does not have.
    attributes:
      - attribute: body_material
        requirement: REQUIRED
        condition: { all: [{ attr: signal_type, op: eq, value: HART }] }
        conditionNote: This product type has no signal_type, so the rule can never fire.
`,
    );
    await expect(readMetadata(workDir)).rejects.toThrow(/does not have/);
    await cleanup();
  });

  it('rejects a condition without an explanation', async () => {
    await write(
      'product-types/unexplained.yaml',
      `productTypes:
  - key: unexplained_type
    name: Unexplained
    description: Has a condition with no note.
    attributes:
      - { attribute: actuation_type, requirement: OPTIONAL }
      - attribute: voltage
        requirement: REQUIRED
        condition: { all: [{ attr: actuation_type, op: eq, value: ELECTRIC }] }
`,
    );
    await expect(readMetadata(workDir)).rejects.toThrow(/conditionNote/);
    await cleanup();
  });

  it('rejects a non-equivalence alias with no note explaining what it does mean', async () => {
    await write(
      'vocabularies/sloppy.yaml',
      `key: sloppy
name: Sloppy
description: An alias that hedges without saying why.
terms:
  - code: THING
    label: Thing
    aliases:
      - { alias: "maybe-thing", assertsEquivalence: false }
`,
    );
    await expect(readMetadata(workDir)).rejects.toThrow(/must carry a note/);
    await cleanup();
  });
});
