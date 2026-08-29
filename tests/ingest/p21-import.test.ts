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
 * Acceptance criterion 14 (spec §83): a representative Prophet 21 export is ingested
 * with file identity, record identity, source values, mapping version and lineage
 * preserved, and re-ingesting the same file creates no duplicate business facts.
 *
 * The fixtures are synthetic. No real customer data is committed to this repository.
 */

const LANDING = '/landing/p21';

const CUSTOMERS_V1 = [
  'customer_id,customer_name,customer_type,credit_limit,date_last_modified,delete_flag',
  'C1001,Keystone Process Systems,DIRECT,50000,2026-01-02 09:15:00,N',
  'C1002,"Delaware Valley Pumps, Inc.",DIRECT,25000,2026-01-02 10:00:00,N',
  'C1003,Bucks County Water Authority,MUNICIPAL,N/A,2026-01-03 08:30:00,N',
  '',
].join('\r\n');

// Same records, one changed field. Structure identical.
const CUSTOMERS_V2 = CUSTOMERS_V1.replace('DIRECT,25000', 'DIRECT,40000');

function connectorFor(fs: MemoryFileSystem): Prophet21Connector {
  return new Prophet21Connector({
    landingPath: LANDING,
    mappings: DEFAULT_P21_MAPPINGS,
    fileSystem: fs,
    mappingVersion: 3,
    parserVersion: 2,
  });
}

describe('Prophet 21 file import (AC14)', () => {
  let testDb: TestDatabase;
  let fs: MemoryFileSystem;
  let store: MemoryObjectStore;
  let deps: PipelineDeps;

  beforeAll(async () => {
    testDb = await createTestDatabase('p21import');
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

  it('preserves file identity, record identity, source values and lineage', async () => {
    fs.set(`${LANDING}/customer_20260105.csv`, CUSTOMERS_V1);

    const result = await runIngestion(connectorFor(fs), deps, testContext(), {
      mode: 'FULL',
      approveNewStructures: true,
    });

    expect(result.status).toBe('SUCCEEDED');
    expect(result.counters.added).toBe(3);
    expect(result.counters.rejected).toBe(0);

    const files = await sql<{
      id: string;
      filename: string;
      sha256: string;
      encoding: string;
      source_timezone: string;
      object_type: string;
      row_count: number;
      object_ref: string;
      parser_version: number;
    }>`SELECT * FROM ingest.landed_file`.execute(testDb.db);
    expect(files.rows).toHaveLength(1);
    const file = files.rows[0]!;
    expect(file.filename).toBe('customer_20260105.csv');
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(file.encoding).toBe('windows-1252');
    expect(file.source_timezone).toBe('America/New_York');
    expect(file.object_type).toBe('customer');
    expect(file.row_count).toBe(3);
    expect(file.parser_version).toBe(2);

    // The original bytes are preserved before anything is interpreted, byte for byte.
    const preserved = await store.get(file.object_ref);
    expect(preserved.toString('latin1')).toBe(CUSTOMERS_V1);

    const records = await sql<{
      source_id: string;
      payload: Record<string, string | null>;
      mapping_version: number;
      parser_version: number;
      landed_file_id: string;
      source_updated_at: Date;
    }>`
      SELECT source_id, payload, mapping_version, parser_version, landed_file_id,
             source_updated_at
        FROM ingest.source_record
       WHERE source_system_code = 'P21' AND object_type = 'customer'
       ORDER BY source_id
    `.execute(testDb.db);
    expect(records.rows.map((r) => r.source_id)).toEqual(['C1001', 'C1002', 'C1003']);

    const second = records.rows[1]!;
    // Source values exactly as the source gave them: the comma inside the quoted name
    // survives, and nothing is normalised at this stage.
    expect(second.payload['customer_name']).toBe('Delaware Valley Pumps, Inc.');
    expect(second.payload['credit_limit']).toBe('25000');
    // 'N/A' is the declared null token for this export, so it is absence, not the text.
    expect(records.rows[2]!.payload['credit_limit']).toBeNull();
    // Lineage: which mapping interpreted it, which parser, which file it came from.
    expect(second.mapping_version).toBe(3);
    expect(second.parser_version).toBe(2);
    expect(second.landed_file_id).toBe(file.id);

    // The naive export timestamp is interpreted in the declared source zone, not UTC.
    // 2026-01-02 10:00 in America/New_York is 15:00Z.
    expect(second.source_updated_at.toISOString()).toBe('2026-01-02T15:00:00.000Z');

    const versions = await sql<{ count: string }>`
      SELECT count(*) AS count FROM ingest.source_record_version
    `.execute(testDb.db);
    expect(Number(versions.rows[0]!.count)).toBe(3);
  });

  it('creates no duplicate business facts when the same export is presented again', async () => {
    fs.set(`${LANDING}/customer_20260105.csv`, CUSTOMERS_V1);
    await runIngestion(connectorFor(fs), deps, testContext(), {
      mode: 'FULL',
      approveNewStructures: true,
    });

    const second = await runIngestion(connectorFor(fs), deps, testContext(), {
      mode: 'FULL',
    });

    expect(second.status).toBe('SUCCEEDED');
    expect(second.filesSkipped).toBe(1);
    expect(second.counters.added).toBe(0);
    expect(second.counters.changed).toBe(0);

    const counts = await sql<{ records: string; versions: string; files: string }>`
      SELECT (SELECT count(*) FROM ingest.source_record) AS records,
             (SELECT count(*) FROM ingest.source_record_version) AS versions,
             (SELECT count(*) FROM ingest.landed_file) AS files
    `.execute(testDb.db);
    expect(counts.rows[0]).toEqual({ records: '3', versions: '3', files: '1' });
  });

  it('re-presents identical content under a different filename without duplicating it', async () => {
    fs.set(`${LANDING}/customer_20260105.csv`, CUSTOMERS_V1);
    await runIngestion(connectorFor(fs), deps, testContext(), {
      mode: 'FULL',
      approveNewStructures: true,
    });

    // The same export, re-sent because someone thought the first had failed.
    fs.set(
      `${LANDING}/customer_20260106.csv`,
      CUSTOMERS_V1,
      new Date('2026-01-06T12:00:00Z'),
    );
    const second = await runIngestion(connectorFor(fs), deps, testContext(), {
      mode: 'FULL',
    });

    // Both the original file and its re-send are recognised as content already held.
    expect(second.filesSkipped).toBe(2);
    const versions = await sql<{ count: string }>`
      SELECT count(*) AS count FROM ingest.source_record_version
    `.execute(testDb.db);
    expect(Number(versions.rows[0]!.count)).toBe(3);
  });

  it('appends a version when a record changes and leaves unchanged records alone', async () => {
    fs.set(`${LANDING}/customer_20260105.csv`, CUSTOMERS_V1);
    await runIngestion(connectorFor(fs), deps, testContext(), {
      mode: 'FULL',
      approveNewStructures: true,
    });

    fs.set(
      `${LANDING}/customer_20260106.csv`,
      CUSTOMERS_V2,
      new Date('2026-01-06T12:00:00Z'),
    );
    const second = await runIngestion(connectorFor(fs), deps, testContext(), {
      mode: 'FULL',
    });

    expect(second.counters.changed).toBe(1);
    expect(second.counters.unchanged).toBe(2);
    expect(second.counters.added).toBe(0);

    const history = await sql<{ credit_limit: string | null }>`
      SELECT v.payload->>'credit_limit' AS credit_limit
        FROM ingest.source_record_version v
        JOIN ingest.source_record r ON r.id = v.source_record_id
       WHERE r.source_id = 'C1002'
       ORDER BY v.observed_at
    `.execute(testDb.db);
    // Both what the source used to say and what it says now. History is never rewritten.
    expect(history.rows.map((r) => r.credit_limit)).toEqual(['25000', '40000']);

    // A changed payload invalidates the previous mapping rather than silently keeping it.
    const status = await sql<{ mapping_status: string }>`
      SELECT mapping_status FROM ingest.source_record WHERE source_id = 'C1002'
    `.execute(testDb.db);
    expect(status.rows[0]!.mapping_status).toBe('UNMAPPED');
  });

  it('marks a record absent from a full extract as deleted in source, never deleting it', async () => {
    fs.set(`${LANDING}/customer_20260105.csv`, CUSTOMERS_V1);
    await runIngestion(connectorFor(fs), deps, testContext(), {
      mode: 'FULL',
      approveNewStructures: true,
    });

    const withoutC1003 = CUSTOMERS_V1.split('\r\n')
      .filter((line) => !line.startsWith('C1003'))
      .join('\r\n');
    fs.remove(`${LANDING}/customer_20260105.csv`);
    fs.set(
      `${LANDING}/customer_20260107.csv`,
      withoutC1003,
      new Date('2026-01-07T12:00:00Z'),
    );

    await runIngestion(connectorFor(fs), deps, testContext(), { mode: 'FULL' });

    const rows = await sql<{ source_id: string; deleted_in_source_at: Date | null }>`
      SELECT source_id, deleted_in_source_at FROM ingest.source_record ORDER BY source_id
    `.execute(testDb.db);
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows[0]!.deleted_in_source_at).toBeNull();
    expect(rows.rows[2]!.source_id).toBe('C1003');
    expect(rows.rows[2]!.deleted_in_source_at).not.toBeNull();
  });

  it('registers itself from the connector code, so the two cannot drift', async () => {
    fs.set(`${LANDING}/customer_20260105.csv`, CUSTOMERS_V1);
    await runIngestion(connectorFor(fs), deps, testContext(), {
      mode: 'FULL',
      approveNewStructures: true,
    });

    const row = await sql<{
      name: string;
      kind: string;
      source_system_code: string;
      mapping_version: number;
      parser_version: number;
      is_enabled: boolean;
    }>`SELECT * FROM ingest.connector WHERE key = 'prophet21_files'`.execute(testDb.db);
    expect(row.rows[0]).toMatchObject({
      source_system_code: 'P21',
      kind: 'FILE',
      mapping_version: 3,
      parser_version: 2,
      is_enabled: true,
    });
  });

  it('refuses to run a connector an operator has disabled', async () => {
    fs.set(`${LANDING}/customer_20260105.csv`, CUSTOMERS_V1);
    await runIngestion(connectorFor(fs), deps, testContext(), {
      mode: 'FULL',
      approveNewStructures: true,
    });

    // Disabling a connector is how someone stops a source that is producing bad data.
    // A scheduler that ran it anyway would make that control decorative.
    await sql`
      UPDATE ingest.connector SET is_enabled = false WHERE key = 'prophet21_files'
    `.execute(testDb.db);

    fs.set(
      `${LANDING}/customer_20260109.csv`,
      CUSTOMERS_V2,
      new Date('2026-01-09T12:00:00Z'),
    );
    await expect(
      runIngestion(connectorFor(fs), deps, testContext(), { mode: 'FULL' }),
    ).rejects.toThrow(/disabled/);

    // And nothing from the new file was staged.
    const changed = await sql<{ count: string }>`
      SELECT count(*) AS count FROM ingest.source_record_version
    `.execute(testDb.db);
    expect(Number(changed.rows[0]!.count)).toBe(3);
  });

  it('emits events that carry identifiers and never the source payload', async () => {
    fs.set(`${LANDING}/customer_20260105.csv`, CUSTOMERS_V1);
    await runIngestion(connectorFor(fs), deps, testContext(), {
      mode: 'FULL',
      approveNewStructures: true,
    });

    const events = await sql<{ event_type: string; payload: Record<string, unknown> }>`
      SELECT event_type, payload FROM events.domain_event ORDER BY sequence
    `.execute(testDb.db);

    const types = events.rows.map((r) => r.event_type);
    expect(types).toContain('fsw.ingest.RunStarted');
    expect(types).toContain('fsw.ingest.SourceRecordChanged');
    expect(types).toContain('fsw.ingest.RunCompleted');

    const changed = events.rows.filter(
      (r) => r.event_type === 'fsw.ingest.SourceRecordChanged',
    );
    expect(changed).toHaveLength(3);
    expect(changed[0]!.payload['change']).toBe('ADDED');

    // No event anywhere in the run repeats a customer name. Payloads carry identifiers
    // only, which is what lets erasure and an immutable ledger coexist (ADR-0027).
    const serialised = JSON.stringify(events.rows);
    expect(serialised).not.toContain('Keystone Process Systems');
    expect(serialised).not.toContain('Delaware Valley Pumps');
  });
});
