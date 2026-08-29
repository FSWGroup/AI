import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { createTestDatabase, type TestDatabase } from '../support/database.js';
import { testContext, testDeps } from '../support/context.js';
import { MemoryFileSystem, MemoryObjectStore } from '../support/ingest.js';
import { syncEventRegistry } from '../../src/modules/events/index.js';
import { ALL_EVENTS } from '../../src/event-catalog.js';
import { runIngestion, type PipelineDeps } from '../../src/modules/ingest/index.js';
import {
  Prophet21Connector,
  DEFAULT_P21_MAPPINGS,
} from '../../src/modules/ingest/connectors/prophet21.js';

/**
 * Acceptance criterion 15 (spec §83): an unexpected structural change is detected and
 * the run fails safely, without shifting data into the wrong fields.
 *
 * The failure this guards against is specific and quiet. A P21 export gains a column
 * in the middle, a positional parser shifts every field one to the left, and the
 * import succeeds: credit limits become dates and nobody notices for a quarter.
 */

const LANDING = '/landing/p21';

const V1 = [
  'customer_id,customer_name,customer_type,credit_limit,date_last_modified,delete_flag',
  'C1001,Keystone Process Systems,DIRECT,50000,2026-01-02 09:15:00,N',
  'C1002,Delaware Valley Pumps,DIRECT,25000,2026-01-02 10:00:00,N',
  '',
].join('\r\n');

// A column inserted in the middle. This is the shape that breaks positional parsers.
const V2_EXTRA_COLUMN = [
  'customer_id,customer_name,customer_class,customer_type,credit_limit,date_last_modified,delete_flag',
  'C1001,Keystone Process Systems,A,DIRECT,90000,2026-02-02 09:15:00,N',
  'C1002,Delaware Valley Pumps,B,DIRECT,25000,2026-02-02 10:00:00,N',
  '',
].join('\r\n');

// The same columns in a different order, with the values moved to match. Harmless
// when parsing is by name, so it must NOT be reported as drift.
const V1_REORDERED = [
  'delete_flag,customer_name,customer_id,credit_limit,customer_type,date_last_modified',
  'N,Keystone Process Systems,C1001,50000,DIRECT,2026-01-02 09:15:00',
  'N,Delaware Valley Pumps,C1002,25000,DIRECT,2026-01-02 10:00:00',
  '',
].join('\r\n');

const V3_KEY_COLUMN_GONE = [
  'customer_name,customer_type,credit_limit,date_last_modified,delete_flag',
  'Keystone Process Systems,DIRECT,50000,2026-01-02 09:15:00,N',
  '',
].join('\r\n');

function connectorFor(fs: MemoryFileSystem): Prophet21Connector {
  return new Prophet21Connector({
    landingPath: LANDING,
    mappings: DEFAULT_P21_MAPPINGS,
    fileSystem: fs,
  });
}

describe('structural drift (AC15)', () => {
  let testDb: TestDatabase;
  let fs: MemoryFileSystem;
  let store: MemoryObjectStore;
  let deps: PipelineDeps;

  beforeAll(async () => {
    testDb = await createTestDatabase('p21drift');
    await syncEventRegistry(testDb.db, ALL_EVENTS);
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await sql`
      TRUNCATE ingest.quarantine, ingest.source_record_version, ingest.source_record,
               ingest.landed_file, ingest.schema_fingerprint, ingest.run,
               ingest.connector RESTART IDENTITY CASCADE
    `.execute(testDb.db);
    await sql`
      TRUNCATE events.event_delivery, events.domain_event RESTART IDENTITY CASCADE
    `.execute(testDb.db);
    fs = new MemoryFileSystem();
    store = new MemoryObjectStore();
    deps = { db: testDb.db, objectStore: store, ...testDeps() };
  });

  async function ingestBaseline(): Promise<void> {
    fs.set(`${LANDING}/customer_01.csv`, V1, new Date('2026-01-05T12:00:00Z'));
    const first = await runIngestion(connectorFor(fs), deps, testContext(), {
      mode: 'FULL',
      approveNewStructures: true,
    });
    expect(first.status).toBe('SUCCEEDED');
    fs.remove(`${LANDING}/customer_01.csv`);
  }

  it('refuses an unapproved structure and writes nothing from it', async () => {
    await ingestBaseline();

    fs.set(
      `${LANDING}/customer_02.csv`,
      V2_EXTRA_COLUMN,
      new Date('2026-02-05T12:00:00Z'),
    );
    const result = await runIngestion(connectorFor(fs), deps, testContext(), {
      mode: 'FULL',
    });

    expect(result.status).toBe('HALTED');
    expect(result.haltReason).toContain('customer_class');

    // Nothing from the drifted file reached the database.
    const files = await sql<{ filename: string }>`
      SELECT filename FROM ingest.landed_file ORDER BY filename
    `.execute(testDb.db);
    expect(files.rows.map((r) => r.filename)).toEqual(['customer_01.csv']);

    // And critically: the values already held are untouched. Nothing shifted.
    const records = await sql<{ source_id: string; credit_limit: string | null }>`
      SELECT source_id, payload->>'credit_limit' AS credit_limit
        FROM ingest.source_record ORDER BY source_id
    `.execute(testDb.db);
    expect(records.rows).toEqual([
      { source_id: 'C1001', credit_limit: '50000' },
      { source_id: 'C1002', credit_limit: '25000' },
    ]);

    const run = await sql<{
      status: string;
      halt_reason: string;
      watermark_after: string | null;
    }>`
      SELECT status, halt_reason, watermark_after FROM ingest.run
       WHERE id = ${result.runId}::uuid
    `.execute(testDb.db);
    expect(run.rows[0]!.status).toBe('HALTED');
    // The watermark is not advanced, so the file is re-offered once someone approves it.
    expect(run.rows[0]!.watermark_after).toBeNull();
  });

  it('records the observed structure so a reviewer has something to approve', async () => {
    await ingestBaseline();
    fs.set(
      `${LANDING}/customer_02.csv`,
      V2_EXTRA_COLUMN,
      new Date('2026-02-05T12:00:00Z'),
    );
    await runIngestion(connectorFor(fs), deps, testContext(), { mode: 'FULL' });

    // The point of detection is the review that follows it. If recording the drift
    // shared a transaction with the write that rolled back, there would be nothing here.
    const fingerprints = await sql<{
      approved_at: Date | null;
      change_summary: string;
      columns: string[];
    }>`
      SELECT approved_at, change_summary, columns FROM ingest.schema_fingerprint
       WHERE object_type = 'customer' AND approved_at IS NULL
    `.execute(testDb.db);
    expect(fingerprints.rows).toHaveLength(1);
    expect(fingerprints.rows[0]!.change_summary).toBe('Added: customer_class.');
    expect(fingerprints.rows[0]!.columns).toContain('customer_class');

    const events = await sql<{ payload: Record<string, unknown> }>`
      SELECT payload FROM events.domain_event
       WHERE event_type = 'fsw.ingest.SchemaDriftDetected'
    `.execute(testDb.db);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]!.payload['changeSummary']).toBe('Added: customer_class.');
    expect(events.rows[0]!.payload['columnCount']).toBe(7);
  });

  it('imports the new structure once it is approved, into the right fields', async () => {
    await ingestBaseline();
    fs.set(
      `${LANDING}/customer_02.csv`,
      V2_EXTRA_COLUMN,
      new Date('2026-02-05T12:00:00Z'),
    );
    await runIngestion(connectorFor(fs), deps, testContext(), { mode: 'FULL' });

    // A person looks at the change and approves it.
    const approved = await runIngestion(connectorFor(fs), deps, testContext(), {
      mode: 'FULL',
      approveNewStructures: true,
    });
    expect(approved.status).toBe('SUCCEEDED');

    const records = await sql<{
      source_id: string;
      credit_limit: string | null;
      customer_class: string | null;
      customer_type: string | null;
    }>`
      SELECT source_id,
             payload->>'credit_limit' AS credit_limit,
             payload->>'customer_class' AS customer_class,
             payload->>'customer_type' AS customer_type
        FROM ingest.source_record ORDER BY source_id
    `.execute(testDb.db);
    // Every value in the column it belongs to, despite the insertion in the middle.
    expect(records.rows[0]).toEqual({
      source_id: 'C1001',
      credit_limit: '90000',
      customer_class: 'A',
      customer_type: 'DIRECT',
    });
  });

  it('does not treat a reordered header as drift, and still lands values by name', async () => {
    await ingestBaseline();

    fs.set(`${LANDING}/customer_03.csv`, V1_REORDERED, new Date('2026-03-05T12:00:00Z'));
    const result = await runIngestion(connectorFor(fs), deps, testContext(), {
      mode: 'FULL',
    });

    // Same columns, same fingerprint: no review, no halt. Treating a reorder as drift
    // would train people to approve changes without reading them.
    expect(result.status).toBe('SUCCEEDED');
    const records = await sql<{ source_id: string; credit_limit: string | null }>`
      SELECT source_id, payload->>'credit_limit' AS credit_limit
        FROM ingest.source_record ORDER BY source_id
    `.execute(testDb.db);
    expect(records.rows).toEqual([
      { source_id: 'C1001', credit_limit: '50000' },
      { source_id: 'C1002', credit_limit: '25000' },
    ]);
  });

  it('halts rather than guessing when the identifier column disappears', async () => {
    await ingestBaseline();

    fs.set(
      `${LANDING}/customer_04.csv`,
      V3_KEY_COLUMN_GONE,
      new Date('2026-04-05T12:00:00Z'),
    );
    const result = await runIngestion(connectorFor(fs), deps, testContext(), {
      mode: 'FULL',
    });

    expect(result.status).toBe('HALTED');
    expect(result.haltReason).toContain('Removed: customer_id.');

    const records = await sql<{ count: string }>`
      SELECT count(*) AS count FROM ingest.source_record
    `.execute(testDb.db);
    expect(Number(records.rows[0]!.count)).toBe(2);
  });

  it('preserves the original file even when the run halts', async () => {
    await ingestBaseline();
    fs.set(
      `${LANDING}/customer_02.csv`,
      V2_EXTRA_COLUMN,
      new Date('2026-02-05T12:00:00Z'),
    );
    await runIngestion(connectorFor(fs), deps, testContext(), { mode: 'FULL' });

    // The bytes are stored before anything is interpreted, which is what makes a halted
    // import diagnosable without asking the source for the file again.
    const stored = await Promise.all(
      (await store.list('ingest/prophet21_files')).map((key) => store.get(key)),
    );
    expect(stored.map((buffer) => buffer.toString('latin1'))).toContain(V2_EXTRA_COLUMN);
  });
});
