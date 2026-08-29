/**
 * Integration test harness (ADR-0029).
 *
 * Tests run against real PostgreSQL, never a mock or an in-memory substitute: this
 * schema depends on exclusion constraints, btree_gist, pg_trgm and real planner
 * behaviour, none of which a substitute implements.
 *
 * Each test file gets its own database, created from a migrated template so the cost
 * of migrating is paid once per run rather than once per file.
 */
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { applyMigrations } from '../../src/platform/db/migrator.js';
import {
  createDatabase,
  createPool,
  type Database,
} from '../../src/platform/db/index.js';
import { loadDotEnv } from '../../src/platform/config.js';

loadDotEnv();

const TEMPLATE_DATABASE = 'fsw_layer0_template';
/** Serialises template creation across concurrent vitest workers. */
const TEMPLATE_LOCK_KEY = 918_273_645;

function adminUrl(): string {
  const base = process.env['DATABASE_TEST_URL'] ?? process.env['DATABASE_URL'];
  if (base === undefined || base === '') {
    throw new Error(
      'DATABASE_TEST_URL or DATABASE_URL must be set to run integration tests.\n' +
        'Run `make db-up` first, or see docs/testing.md.',
    );
  }
  return base;
}

function urlForDatabase(name: string): string {
  const url = new URL(adminUrl());
  url.pathname = `/${name}`;
  return url.toString();
}

async function withAdminClient<T>(work: (client: Client) => Promise<T>): Promise<T> {
  // 'postgres' is the maintenance database; CREATE DATABASE cannot run from inside
  // the database being created or templated.
  const client = new Client({ connectionString: urlForDatabase('postgres') });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

let templateReady: Promise<void> | undefined;

async function ensureTemplate(): Promise<void> {
  await withAdminClient(async (admin) => {
    await admin.query('SELECT pg_advisory_lock($1)', [TEMPLATE_LOCK_KEY]);
    try {
      const { rows } = await admin.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
        [TEMPLATE_DATABASE],
      );
      if (rows[0]?.exists !== true) {
        await admin.query(`CREATE DATABASE ${TEMPLATE_DATABASE}`);
      }
    } finally {
      await admin.query('SELECT pg_advisory_unlock($1)', [TEMPLATE_LOCK_KEY]);
    }
  });

  // Migrate the template. Applying migrations is idempotent, so concurrent workers
  // converge rather than conflict.
  const client = new Client({ connectionString: urlForDatabase(TEMPLATE_DATABASE) });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [TEMPLATE_LOCK_KEY]);
    await applyMigrations(client, { appliedBy: 'test-harness' });
    await client.query('SELECT pg_advisory_unlock($1)', [TEMPLATE_LOCK_KEY]);
  } finally {
    await client.end();
  }
}

export interface TestDatabase {
  readonly db: Database;
  readonly url: string;
  readonly name: string;
  close(): Promise<void>;
}

/**
 * Create an isolated database for one test file. Call `close()` in afterAll; the
 * database is dropped so a run leaves nothing behind.
 */
export async function createTestDatabase(label = 'test'): Promise<TestDatabase> {
  templateReady ??= ensureTemplate();
  await templateReady;

  const name = `fsw_t_${label
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
    .slice(0, 20)}_${randomUUID().slice(0, 8)}`;

  await withAdminClient(async (admin) => {
    // CREATE ... TEMPLATE fails while anything is connected to the template. Workers
    // finishing their own template migration can collide here; retry briefly.
    let lastError: unknown;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DATABASE}`);
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    throw new Error(
      `Could not create test database ${name}: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  });

  const url = urlForDatabase(name);
  const pool = createPool({
    connectionString: url,
    poolMax: 5,
    applicationName: `fsw-test-${label}`,
  });
  const db = createDatabase(pool);

  return {
    db,
    url,
    name,
    async close() {
      await db.destroy();
      await withAdminClient(async (admin) => {
        await admin.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
          [name],
        );
        await admin.query(`DROP DATABASE IF EXISTS ${name}`);
      });
    },
  };
}

/** A second, independent connection pool to the same test database, for concurrency tests. */
export function connectTo(
  testDb: TestDatabase,
  label = 'aux',
): { db: Database; close(): Promise<void> } {
  const pool = createPool({
    connectionString: testDb.url,
    poolMax: 5,
    applicationName: `fsw-test-${label}`,
  });
  const db = createDatabase(pool);
  return { db, close: () => db.destroy() };
}
