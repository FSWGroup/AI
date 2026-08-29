import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Type } from '@sinclair/typebox';
import { sql } from 'kysely';
import { createTestDatabase, type TestDatabase } from '../support/database.js';
import { defineEvent, syncEventRegistry } from '../../src/modules/events/index.js';

describe('event definitions (ADR-0009)', () => {
  it('refuses a payload property that looks like personal data', () => {
    // This is the constraint that lets an immutable ledger coexist with a lawful
    // erasure obligation: erasing the canonical person erases them everywhere,
    // because no consumer ever received their PII through the ledger.
    expect(() =>
      defineEvent({
        type: 'fsw.kernel.ContactAddedBadly',
        version: 1,
        module: 'kernel',
        aggregateType: 'Contact',
        description: 'Carries an email address, which events must not do.',
        payload: Type.Object({ contactId: Type.String(), email: Type.String() }),
      }),
    ).toThrow(/looks like personal data/);
  });

  it('refuses personal data nested inside an object or an array', () => {
    expect(() =>
      defineEvent({
        type: 'fsw.kernel.NestedPiiA',
        version: 1,
        module: 'kernel',
        aggregateType: 'Contact',
        description: 'Nested personal data.',
        payload: Type.Object({
          contact: Type.Object({ id: Type.String(), first_name: Type.String() }),
        }),
      }),
    ).toThrow(/looks like personal data/);

    expect(() =>
      defineEvent({
        type: 'fsw.kernel.NestedPiiB',
        version: 1,
        module: 'kernel',
        aggregateType: 'Contact',
        description: 'Personal data inside an array.',
        payload: Type.Object({
          people: Type.Array(Type.Object({ id: Type.String(), phone: Type.String() })),
        }),
      }),
    ).toThrow(/looks like personal data/);
  });

  it('allows a reviewed exception to be declared explicitly', () => {
    const definition = defineEvent({
      type: 'fsw.kernel.SupplierEmailDomainChanged',
      version: 1,
      module: 'kernel',
      aggregateType: 'Supplier',
      description:
        'A supplier organisation changed its web domain. Not personal data: it ' +
        'identifies a company, not a natural person.',
      payload: Type.Object({
        supplierId: Type.String(),
        emailDomain: Type.String({ 'x-fsw-pii-reviewed': true }),
      }),
    });
    expect(definition.type).toBe('fsw.kernel.SupplierEmailDomainChanged');
  });

  it('enforces the event naming convention', () => {
    expect(() =>
      defineEvent({
        type: 'productCreated',
        version: 1,
        module: 'pim',
        aggregateType: 'Product',
        description: 'Wrong shape.',
        payload: Type.Object({}),
      }),
    ).toThrow(/must match fsw/);
  });

  it('rejects a duplicate definition of the same type and version', () => {
    const input = {
      type: 'fsw.kernel.DefinedTwice',
      version: 1,
      module: 'kernel',
      aggregateType: 'Thing',
      description: 'First definition.',
      payload: Type.Object({ id: Type.String() }),
    } as const;
    defineEvent(input);
    expect(() => defineEvent(input)).toThrow(/already defined/);
  });

  it('rejects a version below 1', () => {
    expect(() =>
      defineEvent({
        type: 'fsw.kernel.BadVersion',
        version: 0,
        module: 'kernel',
        aggregateType: 'Thing',
        description: 'Versions start at 1.',
        payload: Type.Object({}),
      }),
    ).toThrow(/version must be an integer/);
  });
});

describe('event registry synchronisation (ADR-0009)', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase('eventreg');
  });
  afterAll(async () => {
    await testDb.close();
  });

  it('registers definitions and reports an in-place schema change as incompatible', async () => {
    const v1 = defineEvent({
      type: 'fsw.kernel.Evolving',
      version: 1,
      module: 'kernel',
      aggregateType: 'Thing',
      description: 'Original shape.',
      payload: Type.Object({ id: Type.String() }),
    });

    const first = await syncEventRegistry(testDb.db, [v1]);
    expect(first.incompatible).toEqual([]);

    // Same type and version, different payload: exactly what ADR-0009 forbids.
    // A breaking change creates a new version; it never rewrites a published one.
    const mutated = { ...v1, payload: Type.Object({ id: Type.Number() }) };
    const second = await syncEventRegistry(testDb.db, [mutated]);
    expect(second.incompatible).toEqual(['fsw.kernel.Evolving@1']);

    const { rows } = await sql<{ json_schema: { properties: { id: { type: string } } } }>`
      SELECT json_schema FROM events.event_type_version
       WHERE event_type = 'fsw.kernel.Evolving' AND schema_version = 1
    `.execute(testDb.db);
    // The stored schema is untouched.
    expect(rows[0]!.json_schema.properties.id.type).toBe('string');
  });

  it('registers a new version alongside the old one', async () => {
    const v2 = defineEvent({
      type: 'fsw.kernel.Evolving',
      version: 2,
      module: 'kernel',
      aggregateType: 'Thing',
      description: 'Second shape, added alongside version 1.',
      payload: Type.Object({
        id: Type.String(),
        addedField: Type.Optional(Type.String()),
      }),
    });
    await syncEventRegistry(testDb.db, [v2]);

    const { rows } = await sql<{ schema_version: number }>`
      SELECT schema_version FROM events.event_type_version
       WHERE event_type = 'fsw.kernel.Evolving' ORDER BY schema_version
    `.execute(testDb.db);
    expect(rows.map((r) => r.schema_version)).toEqual([1, 2]);
  });
});
