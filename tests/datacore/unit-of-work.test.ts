import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Type } from '@sinclair/typebox';
import { sql } from 'kysely';
import { createTestDatabase, type TestDatabase } from '../support/database.js';
import { testContext, testDeps } from '../support/context.js';
import { withUnitOfWork } from '../../src/kernel/unit-of-work.js';
import {
  defineEvent,
  syncEventRegistry,
  readEvents,
} from '../../src/modules/events/index.js';
import { classifyFields } from '../../src/modules/audit/index.js';

const WidgetCreated = defineEvent({
  type: 'fsw.kernel.WidgetCreated',
  version: 1,
  module: 'kernel',
  aggregateType: 'Widget',
  description: 'A test aggregate was created. Exists only to exercise the data core.',
  payload: Type.Object({
    widgetId: Type.String({ format: 'uuid' }),
    label: Type.String({ minLength: 1 }),
  }),
});

const WidgetRelabelled = defineEvent({
  type: 'fsw.kernel.WidgetRelabelled',
  version: 1,
  module: 'kernel',
  aggregateType: 'Widget',
  description: 'A test aggregate was relabelled.',
  payload: Type.Object({
    widgetId: Type.String({ format: 'uuid' }),
    from: Type.String(),
    to: Type.String(),
  }),
});

describe('UnitOfWork: audit and events in one transaction (ADR-0008, ADR-0021)', () => {
  let testDb: TestDatabase;
  const deps = testDeps();

  beforeAll(async () => {
    testDb = await createTestDatabase('uow');
    await syncEventRegistry(testDb.db, [WidgetCreated, WidgetRelabelled]);
    classifyFields('kernel', 'widget', { api_secret: 'SECRET', owner_email: 'PII' });
  });
  afterAll(async () => {
    await testDb.close();
  });

  it('writes an audit entry and a domain event for one logical change', async () => {
    const widgetId = deps.ids.next();
    const context = testContext({ reason: 'demonstrating the data core' });

    await withUnitOfWork(testDb.db, context, deps, async (uow) => {
      uow.audit({
        schema: 'kernel',
        table: 'widget',
        entityId: widgetId,
        operation: 'INSERT',
        after: { id: widgetId, label: 'first' },
      });
      uow.emit(WidgetCreated, { widgetId, label: 'first' }, { aggregateId: widgetId });
    });

    const audit = await sql<Record<string, unknown>>`
      SELECT * FROM audit.change_log WHERE entity_id = ${widgetId}
    `.execute(testDb.db);
    expect(audit.rows).toHaveLength(1);
    const entry = audit.rows[0]!;
    expect(entry['operation']).toBe('INSERT');
    expect(entry['actor_label']).toBe('test.user@fsw.group');
    expect(entry['interface']).toBe('TEST');
    expect(entry['reason']).toBe('demonstrating the data core');
    expect(entry['correlation_id']).toBe(context.correlationId);

    const events = await readEvents(testDb.db, {
      aggregate: { type: 'Widget', id: widgetId },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('fsw.kernel.WidgetCreated');
    expect(events[0]!.payload).toEqual({ widgetId, label: 'first' });
    expect(events[0]!.correlationId).toBe(context.correlationId);
  });

  it('rolls back the audit entry and the event when the work throws', async () => {
    const widgetId = deps.ids.next();
    await expect(
      withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
        uow.audit({
          schema: 'kernel',
          table: 'widget',
          entityId: widgetId,
          operation: 'INSERT',
          after: { id: widgetId },
        });
        uow.emit(WidgetCreated, { widgetId, label: 'doomed' }, { aggregateId: widgetId });
        throw new Error('business rule violated');
      }),
    ).rejects.toThrow('business rule violated');

    const audit =
      await sql`SELECT 1 FROM audit.change_log WHERE entity_id = ${widgetId}`.execute(
        testDb.db,
      );
    expect(audit.rows).toHaveLength(0);
    const events = await readEvents(testDb.db, {
      aggregate: { type: 'Widget', id: widgetId },
    });
    expect(events).toHaveLength(0);
  });

  it('records exactly which fields changed on an update', async () => {
    const widgetId = deps.ids.next();
    await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
      uow.audit({
        schema: 'kernel',
        table: 'widget',
        entityId: widgetId,
        operation: 'UPDATE',
        before: { id: widgetId, label: 'before', colour: 'red', size: 3 },
        after: { id: widgetId, label: 'after', colour: 'red', size: 4 },
      });
    });
    const { rows } = await sql<{ changed_fields: string[] }>`
      SELECT changed_fields FROM audit.change_log WHERE entity_id = ${widgetId}
    `.execute(testDb.db);
    expect(rows[0]!.changed_fields).toEqual(['label', 'size']);
  });

  it('redacts secret-classified fields but keeps PII for the erasure job to scrub', async () => {
    const widgetId = deps.ids.next();
    await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
      uow.audit({
        schema: 'kernel',
        table: 'widget',
        entityId: widgetId,
        operation: 'INSERT',
        after: {
          id: widgetId,
          api_secret: 'super-secret-value',
          owner_email: 'buyer@acme-pharma.example',
          label: 'visible',
        },
      });
    });
    const { rows } = await sql<{ after: Record<string, unknown> }>`
      SELECT after FROM audit.change_log WHERE entity_id = ${widgetId}
    `.execute(testDb.db);
    const after = rows[0]!.after;
    expect(after['api_secret']).toBe('[redacted]');
    expect(after['label']).toBe('visible');
    // PII is retained: audit is where "who changed this contact" is answered. It is
    // removed by an erasure request, not by redaction (ADR-0027).
    expect(after['owner_email']).toBe('buyer@acme-pharma.example');
  });

  it('redacts unclassified fields whose names look like secrets', async () => {
    const widgetId = deps.ids.next();
    await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
      uow.audit({
        schema: 'kernel',
        table: 'never_classified',
        entityId: widgetId,
        operation: 'INSERT',
        after: { webhook_signing_key: 'leak', refresh_token: 'leak', label: 'fine' },
      });
    });
    const { rows } = await sql<{ after: Record<string, unknown> }>`
      SELECT after FROM audit.change_log WHERE entity_id = ${widgetId}
    `.execute(testDb.db);
    expect(rows[0]!.after['webhook_signing_key']).toBe('[redacted]');
    expect(rows[0]!.after['refresh_token']).toBe('[redacted]');
    expect(rows[0]!.after['label']).toBe('fine');
  });

  it('preserves emission order within a transaction', async () => {
    const widgetId = deps.ids.next();
    await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
      uow.emit(WidgetCreated, { widgetId, label: 'a' }, { aggregateId: widgetId });
      uow.emit(
        WidgetRelabelled,
        { widgetId, from: 'a', to: 'b' },
        { aggregateId: widgetId },
      );
      uow.emit(
        WidgetRelabelled,
        { widgetId, from: 'b', to: 'c' },
        { aggregateId: widgetId },
      );
    });
    const events = await readEvents(testDb.db, {
      aggregate: { type: 'Widget', id: widgetId },
    });
    expect(events.map((e) => e.eventType)).toEqual([
      'fsw.kernel.WidgetCreated',
      'fsw.kernel.WidgetRelabelled',
      'fsw.kernel.WidgetRelabelled',
    ]);
    expect(events.map((e) => (e.payload as { to?: string }).to)).toEqual([
      undefined,
      'b',
      'c',
    ]);
  });

  it('rejects a payload that does not match its registered schema, at emission', async () => {
    const widgetId = deps.ids.next();
    await expect(
      withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
        uow.emit(WidgetCreated, { widgetId, label: '' } as never, {
          aggregateId: widgetId,
        });
      }),
    ).rejects.toThrow(/does not match its schema/);
  });

  it('cannot emit an event type that was never registered', async () => {
    await expect(
      sql`
        INSERT INTO events.domain_event
          (sequence, event_type, schema_version, aggregate_type, aggregate_id,
           occurred_at, actor_type, actor_label, correlation_id, source, payload)
        VALUES (999999, 'fsw.kernel.NeverRegistered', 1, 'Widget', 'x',
                now(), 'SYSTEM', 'test', gen_random_uuid(), 'test', '{}'::jsonb)
      `.execute(testDb.db),
    ).rejects.toThrow(/foreign key|event_type/i);
  });
});
