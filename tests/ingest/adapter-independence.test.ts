import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sql } from 'kysely';
import { createTestDatabase, type TestDatabase } from '../support/database.js';
import { testContext, testDeps } from '../support/context.js';
import { MemoryObjectStore } from '../support/ingest.js';
import { syncEventRegistry } from '../../src/modules/events/index.js';
import { ALL_EVENTS } from '../../src/event-catalog.js';
import {
  runIngestion,
  type Connector,
  type DiscoverOptions,
  type ParseOutcome,
  type PipelineDeps,
  type SourcePayload,
  type SourceUnit,
} from '../../src/modules/ingest/index.js';

/**
 * Acceptance criterion 26 (spec §83): canonical services depend on the abstract
 * ingestion contract, not on Prophet 21 or Pipedrive.
 *
 * Proven two ways, because either alone is weak. A synthetic connector with no
 * knowledge of any real source runs the whole pipeline end to end; and the pipeline's
 * own source is checked for source-specific vocabulary, which is what would creep back
 * in first.
 */

/**
 * A connector for a source that does not exist: line-delimited JSON, held in memory,
 * with none of P21's file naming, encoding, timestamp or delete-flag conventions.
 *
 * This is the shape a future connector takes. If adding one required touching the
 * pipeline, the boundary would not be real.
 */
class LedgerConnector implements Connector {
  readonly key = 'ledger_stub';
  readonly name = 'Synthetic ledger';
  readonly sourceSystemCode = 'MANUAL';
  readonly kind = 'API' as const;
  readonly objectTypes = ['ledger_entry'];
  readonly mappingVersion = 7;
  readonly parserVersion = 1;

  constructor(private readonly pages: readonly (readonly Record<string, unknown>[])[]) {}

  async discover(options: DiscoverOptions): Promise<readonly SourceUnit[]> {
    const from = options.watermark === undefined ? 0 : Number(options.watermark);
    return this.pages.slice(from).map((_, index) => ({
      id: `page-${from + index}`,
      objectType: 'ledger_entry',
      label: `page ${from + index}`,
      handle: from + index,
    }));
  }

  async read(unit: SourceUnit): Promise<SourcePayload> {
    const page = this.pages[unit.handle as number] ?? [];
    return {
      bytes: Buffer.from(page.map((row) => JSON.stringify(row)).join('\n'), 'utf8'),
      encoding: 'utf-8',
      sourceTimezone: 'UTC',
      contentType: 'application/x-ndjson',
      filename: `${unit.id}.ndjson`,
    };
  }

  async parse(_unit: SourceUnit, payload: SourcePayload): Promise<ParseOutcome> {
    const lines = payload.bytes
      .toString('utf8')
      .split('\n')
      .filter((l) => l !== '');
    const rows = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    return {
      objectType: 'ledger_entry',
      columns: ['ref', 'amount'],
      // A fixed structure this source guarantees; the pipeline still requires approval.
      fingerprint: 'b'.repeat(64),
      records: rows.map((row, index) => ({
        sourceId: String(row['ref']),
        payload: row,
        rowNumber: index + 1,
      })),
      rejects: [],
      rowCount: rows.length,
    };
  }

  watermarkAfter(
    units: readonly SourceUnit[],
    previous: string | undefined,
  ): string | undefined {
    if (units.length === 0) return previous;
    return String((units[units.length - 1]!.handle as number) + 1);
  }
}

describe('adapter independence (AC26)', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase('adapterindep');
    await syncEventRegistry(testDb.db, ALL_EVENTS);
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('runs a connector that knows nothing about any real source system', async () => {
    const deps: PipelineDeps = {
      db: testDb.db,
      objectStore: new MemoryObjectStore(),
      ...testDeps(),
    };

    const connector = new LedgerConnector([
      [
        { ref: 'L-1', amount: 100 },
        { ref: 'L-2', amount: 250 },
      ],
      [{ ref: 'L-3', amount: 75 }],
    ]);

    const result = await runIngestion(connector, deps, testContext(), {
      mode: 'INCREMENTAL',
      approveNewStructures: true,
    });

    expect(result.status).toBe('SUCCEEDED');
    expect(result.counters.added).toBe(3);

    const records = await sql<{
      source_id: string;
      payload: Record<string, unknown>;
      mapping_version: number;
    }>`
      SELECT source_id, payload, mapping_version FROM ingest.source_record
       WHERE source_system_code = 'MANUAL' ORDER BY source_id
    `.execute(testDb.db);
    expect(records.rows.map((r) => r.source_id)).toEqual(['L-1', 'L-2', 'L-3']);
    expect(records.rows[0]!.payload['amount']).toBe(100);
    expect(records.rows[0]!.mapping_version).toBe(7);

    // The connector's own notion of a watermark is respected without the pipeline
    // knowing what it means.
    const run = await sql<{ watermark_after: string }>`
      SELECT watermark_after FROM ingest.run WHERE id = ${result.runId}::uuid
    `.execute(testDb.db);
    expect(run.rows[0]!.watermark_after).toBe('2');

    // A second run resumes from it and finds nothing new.
    const second = await runIngestion(connector, deps, testContext(), {
      mode: 'INCREMENTAL',
    });
    expect(second.counters.added).toBe(0);
    expect(second.counters.discovered).toBe(0);
  });

  it('keeps source-specific vocabulary out of the shared pipeline', async () => {
    const shared = resolve(import.meta.dirname, '..', '..', 'src', 'modules', 'ingest');
    const files = (await readdir(shared, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => join(shared, entry.name));

    // Connectors live in their own directory. Everything above them must be neutral:
    // the moment 'if (connector.key === ...)' appears here, the boundary is decoration.
    const forbidden = /\b(p21|prophet\s?21|pipedrive|epicor|valveman)\b/i;
    const offenders: string[] = [];
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      // Comments may name a source as an example; code may not.
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      if (forbidden.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps source-system identifiers inside the ingest schema', async () => {
    // The anti-corruption boundary, checked where it actually has to hold: no canonical
    // table carries a 'p21_id'-style column (spec §77, ADR-0022).
    const columns = await sql<{
      table_schema: string;
      table_name: string;
      column_name: string;
    }>`
      SELECT table_schema, table_name, column_name
        FROM information_schema.columns
       WHERE table_schema NOT IN ('ingest', 'information_schema', 'pg_catalog')
         AND (column_name ~* '(p21|prophet|pipedrive|epicor)'
              OR column_name IN ('source_id', 'external_id'))
    `.execute(testDb.db);
    expect(columns.rows).toEqual([]);
  });
});
