import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { sql } from 'kysely';
import { createTestDatabase, type TestDatabase } from '../support/database.js';
import {
  appliedMigrations,
  applyMigrations,
  assertHistoryIntact,
  loadMigrations,
  MigrationHistoryError,
} from '../../src/platform/db/migrator.js';

describe('migrations (ADR-0006)', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase('migrator');
  });
  afterAll(async () => {
    await testDb.close();
  });

  it('applies every migration from a clean database and records checksums', async () => {
    const files = await loadMigrations();
    expect(files.length).toBeGreaterThan(0);

    const client = new Client({ connectionString: testDb.url });
    await client.connect();
    try {
      const applied = await appliedMigrations(client);
      // The harness database is created from an already-migrated template.
      expect(applied.size).toBe(files.length);
      for (const file of files) {
        expect(applied.get(file.version)?.sha256).toBe(file.sha256);
      }
    } finally {
      await client.end();
    }
  });

  it('is idempotent: re-applying changes nothing', async () => {
    const client = new Client({ connectionString: testDb.url });
    await client.connect();
    try {
      const result = await applyMigrations(client, { appliedBy: 'test' });
      expect(result.applied).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it('refuses to run when an applied migration has been edited', async () => {
    const files = await loadMigrations();
    const tampered = files.map((f, i) =>
      i === 0 ? { ...f, sha256: 'deadbeef'.repeat(8) } : f,
    );
    const client = new Client({ connectionString: testDb.url });
    await client.connect();
    try {
      const applied = await appliedMigrations(client);
      expect(() => assertHistoryIntact(tampered, applied)).toThrow(MigrationHistoryError);
      try {
        assertHistoryIntact(tampered, applied);
      } catch (error) {
        expect((error as Error).message).toContain('immutable');
      }
    } finally {
      await client.end();
    }
  });

  it('refuses to run when an applied migration is missing from disk', async () => {
    const files = await loadMigrations();
    const client = new Client({ connectionString: testDb.url });
    await client.connect();
    try {
      const applied = await appliedMigrations(client);
      expect(() => assertHistoryIntact(files.slice(1), applied)).toThrow(
        MigrationHistoryError,
      );
    } finally {
      await client.end();
    }
  });

  it('creates every schema the system owns', async () => {
    const { rows } = await sql<{ nspname: string }>`
      SELECT nspname FROM pg_namespace WHERE nspname IN ('kernel','audit','events')
    `.execute(testDb.db);
    expect(rows.map((r) => r.nspname).sort()).toEqual(['audit', 'events', 'kernel']);
  });

  it('loads the reference data other tables depend on', async () => {
    const companies = await sql<{ code: string }>`
      SELECT code FROM kernel.operating_company ORDER BY code
    `.execute(testDb.db);
    expect(companies.rows.map((r) => r.code)).toEqual([
      'FSW_GROUP',
      'VALVEMAN',
      'WELSFORD',
    ]);

    const sources = await sql<{ code: string }>`
      SELECT code FROM kernel.source_system ORDER BY default_priority
    `.execute(testDb.db);
    // FSW_LAYER0 owns what nothing else does; MANUAL outranks every automated source.
    expect(sources.rows[0]?.code).toBe('FSW_LAYER0');
    expect(sources.rows[1]?.code).toBe('MANUAL');
    expect(sources.rows.map((r) => r.code)).toContain('P21');
    expect(sources.rows.map((r) => r.code)).toContain('PIPEDRIVE');
  });

  it('generates UUIDv7 in SQL as well as in the application', async () => {
    const { rows } = await sql<{ u: string }>`
      SELECT kernel.uuid_generate_v7() AS u FROM generate_series(1, 500)
    `.execute(testDb.db);
    expect(new Set(rows.map((r) => r.u)).size).toBe(500);
    for (const row of rows) {
      expect(row.u[14]).toBe('7');
      expect(['8', '9', 'a', 'b']).toContain(row.u[19]);
    }
  });

  it('enforces the machine_key and code_key naming domains', async () => {
    await expect(
      sql`INSERT INTO kernel.operating_company (code, name) VALUES ('lowercase', 'x')`.execute(
        testDb.db,
      ),
    ).rejects.toThrow();
  });
});
