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
 * Acceptance criterion 16 (spec §83): a malformed record is quarantined with a useful
 * reason while the import continues.
 *
 * "Useful" is the load-bearing word. A quarantine table nobody can act on is a
 * discard with extra steps, so every row here is checked for the identifier, the row
 * number, the original content and a message that says what to do.
 */

const LANDING = '/landing/p21';

const MESSY = [
  'customer_id,customer_name,customer_type,credit_limit,date_last_modified,delete_flag',
  'C2001,Lehigh Valley Controls,DIRECT,50000,2026-01-02 09:15:00,N', // good
  'C2002,Schuylkill Instrument,DIRECT,10000', // ragged: too few fields
  ',Nameless Holdings,DIRECT,10000,2026-01-02 09:15:00,N', // no identifier
  'C2004,,DIRECT,10000,2026-01-02 09:15:00,N', // required field empty
  'C2005,Berks Fluid Handling,DIRECT,10000,not-a-date,N', // unparseable timestamp
  'C2006,Chester Valve Supply,DIRECT,20000,2026-01-04 11:00:00,N', // good
  'C2006,Chester Valve Supply LLC,DIRECT,30000,2026-01-04 12:00:00,N', // duplicate key
  'C2008,Montgomery Steam,DIRECT,15000,2026-01-05 08:00:00,N', // good
  '',
].join('\r\n');

describe('quarantine (AC16)', () => {
  let testDb: TestDatabase;
  let fs: MemoryFileSystem;
  let deps: PipelineDeps;

  beforeAll(async () => {
    testDb = await createTestDatabase('quarantine');
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
    deps = { db: testDb.db, objectStore: new MemoryObjectStore(), ...testDeps() };
  });

  function connector(): Prophet21Connector {
    return new Prophet21Connector({
      landingPath: LANDING,
      mappings: DEFAULT_P21_MAPPINGS,
      fileSystem: fs,
    });
  }

  it('imports the good records and quarantines the rest with reasons', async () => {
    fs.set(`${LANDING}/customer_messy.csv`, MESSY);
    const result = await runIngestion(connector(), deps, testContext(), {
      mode: 'FULL',
      approveNewStructures: true,
    });

    // The import continues. One bad row does not cost the other seven.
    expect(result.status).toBe('SUCCEEDED');
    expect(result.counters.added).toBe(2);

    const imported = await sql<{ source_id: string }>`
      SELECT source_id FROM ingest.source_record ORDER BY source_id
    `.execute(testDb.db);
    expect(imported.rows.map((r) => r.source_id)).toEqual(['C2001', 'C2008']);

    const quarantined = await sql<{
      source_id: string | null;
      failure_category: string;
      messages: string[];
      row_number: number | null;
      raw: unknown;
      status: string;
      landed_file_id: string | null;
    }>`
      SELECT source_id, failure_category, messages, row_number, raw, status, landed_file_id
        FROM ingest.quarantine ORDER BY row_number NULLS LAST, source_id
    `.execute(testDb.db);

    const categories = quarantined.rows.map((r) => r.failure_category).sort();
    expect(categories).toEqual([
      'DUPLICATE_KEY',
      'DUPLICATE_KEY',
      'INVALID_VALUE',
      'MISSING_REQUIRED_FIELD',
      'MISSING_REQUIRED_FIELD',
      'PARSE_ERROR',
    ]);

    for (const row of quarantined.rows) {
      expect(row.status).toBe('OPEN');
      expect(row.messages.length).toBeGreaterThan(0);
      expect(row.messages[0]!.length).toBeGreaterThan(20);
      // Traceable back to the file it came from, so a reviewer can open the original.
      expect(row.landed_file_id).not.toBeNull();
      // Nothing is lost by rejecting it: the original content is kept.
      expect(row.raw).not.toBeNull();
    }

    const ragged = quarantined.rows.find((r) => r.failure_category === 'PARSE_ERROR')!;
    expect(ragged.row_number).toBe(3);
    expect(ragged.messages[0]).toContain('Expected 6 fields but found 4');

    const noIdentifier = quarantined.rows.find((r) => r.row_number === 4)!;
    expect(noIdentifier.source_id).toBeNull();
    expect(noIdentifier.messages[0]).toContain("'customer_id' is empty");

    const emptyRequired = quarantined.rows.find((r) => r.source_id === 'C2004')!;
    expect(emptyRequired.failure_category).toBe('MISSING_REQUIRED_FIELD');
    expect(emptyRequired.messages[0]).toContain("'customer_name' is required");

    const badDate = quarantined.rows.find((r) => r.source_id === 'C2005')!;
    expect(badDate.failure_category).toBe('INVALID_VALUE');
    expect(badDate.messages[0]).toContain('not-a-date');
  });

  it('quarantines both halves of a duplicate key rather than picking a winner', async () => {
    fs.set(`${LANDING}/customer_messy.csv`, MESSY);
    await runIngestion(connector(), deps, testContext(), {
      mode: 'FULL',
      approveNewStructures: true,
    });

    // Last-one-wins would have silently chosen 'Chester Valve Supply LLC' at 30000.
    // Nobody chose that, so neither row is imported and both are visible work.
    const duplicates = await sql<{ raw: Record<string, string | null> }>`
      SELECT raw FROM ingest.quarantine
       WHERE failure_category = 'DUPLICATE_KEY' ORDER BY row_number
    `.execute(testDb.db);
    expect(duplicates.rows).toHaveLength(2);
    expect(duplicates.rows.map((r) => r.raw['credit_limit'])).toEqual(['20000', '30000']);

    const imported = await sql<{ count: string }>`
      SELECT count(*) AS count FROM ingest.source_record WHERE source_id = 'C2006'
    `.execute(testDb.db);
    expect(Number(imported.rows[0]!.count)).toBe(0);
  });

  it('counts rejections on the run, so a mostly-failing import is not called a success', async () => {
    fs.set(`${LANDING}/customer_messy.csv`, MESSY);
    const result = await runIngestion(connector(), deps, testContext(), {
      mode: 'FULL',
      approveNewStructures: true,
    });

    expect(result.counters.rejected).toBe(6);
    const run = await sql<{ rejected: number; added: number; status: string }>`
      SELECT rejected, added, status FROM ingest.run WHERE id = ${result.runId}::uuid
    `.execute(testDb.db);
    expect(run.rows[0]).toEqual({ rejected: 6, added: 2, status: 'SUCCEEDED' });

    const completed = await sql<{ payload: Record<string, unknown> }>`
      SELECT payload FROM events.domain_event WHERE event_type = 'fsw.ingest.RunCompleted'
    `.execute(testDb.db);
    expect(completed.rows[0]!.payload['rejected']).toBe(6);
  });

  it('emits a quarantine event carrying the category and identifier, never the record', async () => {
    fs.set(`${LANDING}/customer_messy.csv`, MESSY);
    await runIngestion(connector(), deps, testContext(), {
      mode: 'FULL',
      approveNewStructures: true,
    });

    const events = await sql<{ payload: Record<string, unknown> }>`
      SELECT payload FROM events.domain_event
       WHERE event_type = 'fsw.ingest.RecordQuarantined'
    `.execute(testDb.db);
    expect(events.rows).toHaveLength(6);

    const serialised = JSON.stringify(events.rows);
    // A quarantined record is the likeliest place for personal data to be sitting, so
    // it is exactly where the payload must carry identifiers only (ADR-0027).
    expect(serialised).not.toContain('Lehigh Valley');
    expect(serialised).not.toContain('Nameless Holdings');
    expect(serialised).not.toContain('not-a-date');

    const categories = events.rows.map((r) => r.payload['failureCategory']).sort();
    expect(categories).toContain('DUPLICATE_KEY');
    expect(categories).toContain('PARSE_ERROR');

    // The event points at the quarantine row, so a consumer can go and read it.
    const ids = events.rows.map((r) => r.payload['quarantineId'] as string);
    const rows = await sql<{ count: string }>`
      SELECT count(*) AS count FROM ingest.quarantine WHERE id = ANY(${ids}::uuid[])
    `.execute(testDb.db);
    expect(Number(rows.rows[0]!.count)).toBe(6);
  });

  it('fails the run rather than importing mojibake when the encoding is wrong', async () => {
    // 0xB0 is a degree sign in windows-1252 and is not valid UTF-8 on its own. This is
    // the everyday version of the problem: an export declared utf-8 that is really a
    // code page. A lenient decoder writes 'SS 316 \ufffd25' and the import looks like it
    // worked, which is worse than a failure (ADR-0023).
    fs.set(
      `${LANDING}/item_bad_encoding.csv`,
      Buffer.concat([
        Buffer.from('item_id,item_desc,date_last_modified\r\n', 'latin1'),
        Buffer.from('I-900,Ball valve rated to 120', 'latin1'),
        Buffer.from([0xb0]),
        Buffer.from('C,2026-01-02 09:15:00\r\n', 'latin1'),
      ]),
    );

    const utf8Connector = new Prophet21Connector({
      landingPath: LANDING,
      mappings: DEFAULT_P21_MAPPINGS,
      fileSystem: fs,
      encoding: 'utf-8',
    });

    await expect(
      runIngestion(utf8Connector, deps, testContext(), {
        mode: 'FULL',
        approveNewStructures: true,
      }),
    ).rejects.toThrow(/decode/i);

    const run = await sql<{ status: string; halt_reason: string }>`
      SELECT status, halt_reason FROM ingest.run ORDER BY started_at DESC LIMIT 1
    `.execute(testDb.db);
    expect(run.rows[0]!.status).toBe('FAILED');
    // The message names the declared encoding, because that is the thing to change.
    expect(run.rows[0]!.halt_reason).toContain('utf-8');

    const records = await sql<{ count: string }>`
      SELECT count(*) AS count FROM ingest.source_record
    `.execute(testDb.db);
    expect(Number(records.rows[0]!.count)).toBe(0);
  });
});
