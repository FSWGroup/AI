/**
 * Migration engine (ADR-0006).
 *
 * Lives in the platform rather than in a script, because three things apply
 * migrations: the CLI, the deployment job, and the test harness. One implementation
 * means the database a test runs against is built exactly the way production is.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from 'pg';

export const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'db',
  'migrations',
);

const FILENAME_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;
const NO_TRANSACTION_PRAGMA = '-- fsw:no-transaction';

/** Schemas this system owns. `resetSchemas` drops exactly these and nothing else. */
export const OWNED_SCHEMAS = [
  'ingest',
  'pim',
  'party',
  'iam',
  'events',
  'audit',
  'kernel',
  'reporting',
] as const;

const BOOTSTRAP = `
CREATE SCHEMA IF NOT EXISTS kernel;
CREATE TABLE IF NOT EXISTS kernel.schema_migration (
  version       text        PRIMARY KEY,
  name          text        NOT NULL,
  sha256        text        NOT NULL,
  applied_at    timestamptz NOT NULL DEFAULT now(),
  applied_by    text        NOT NULL,
  execution_ms  integer     NOT NULL
);
COMMENT ON TABLE kernel.schema_migration IS
  'Applied migrations with content checksums. See ADR-0006.';
`;

export interface MigrationFile {
  readonly version: string;
  readonly name: string;
  readonly sql: string;
  readonly sha256: string;
  readonly inTransaction: boolean;
}

export interface AppliedMigration {
  readonly version: string;
  readonly name: string;
  readonly sha256: string;
  readonly applied_at: Date;
}

export class MigrationHistoryError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`Migration history is not intact:\n  - ${problems.join('\n  - ')}`);
    this.name = 'MigrationHistoryError';
    this.problems = problems;
  }
}

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const entries = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const seen = new Set<string>();
  const migrations: MigrationFile[] = [];

  for (const filename of entries) {
    const match = FILENAME_PATTERN.exec(filename);
    if (!match) {
      throw new Error(
        `Migration '${filename}' must match NNNN_snake_case_description.sql`,
      );
    }
    const version = match[1]!;
    if (seen.has(version)) throw new Error(`Duplicate migration version ${version}`);
    seen.add(version);

    const sql = await readFile(join(dir, filename), 'utf8');
    migrations.push({
      version,
      name: filename,
      sql,
      sha256: createHash('sha256').update(sql, 'utf8').digest('hex'),
      inTransaction: !sql.includes(NO_TRANSACTION_PRAGMA),
    });
  }
  return migrations;
}

export async function bootstrap(client: Client): Promise<void> {
  await client.query(BOOTSTRAP);
}

export async function appliedMigrations(
  client: Client,
): Promise<Map<string, AppliedMigration>> {
  const { rows } = await client.query<AppliedMigration>(
    'SELECT version, name, sha256, applied_at FROM kernel.schema_migration ORDER BY version',
  );
  return new Map(rows.map((r) => [r.version, r]));
}

/**
 * Refuse to proceed if an applied migration's content changed, or if a migration
 * recorded as applied is missing from disk. Both mean the database and the repository
 * disagree about history, which is never safe to paper over.
 */
export function assertHistoryIntact(
  files: readonly MigrationFile[],
  applied: ReadonlyMap<string, AppliedMigration>,
): void {
  const problems: string[] = [];
  const onDisk = new Map(files.map((f) => [f.version, f]));

  for (const [version, row] of applied) {
    const file = onDisk.get(version);
    if (file === undefined) {
      problems.push(
        `Migration ${version} (${row.name}) is recorded as applied but is missing from db/migrations/.`,
      );
      continue;
    }
    if (file.sha256 !== row.sha256) {
      problems.push(
        `Migration ${version} (${file.name}) has changed since it was applied.\n` +
          `    recorded: ${row.sha256}\n` +
          `    on disk:  ${file.sha256}\n` +
          `    Applied migrations are immutable (ADR-0006). Write a new forward migration.`,
      );
    }
  }

  if (problems.length > 0) throw new MigrationHistoryError(problems);
}

export interface ApplyResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: number;
}

export async function applyMigrations(
  client: Client,
  options: {
    dir?: string;
    appliedBy?: string;
    onProgress?: (name: string, ms: number) => void;
  } = {},
): Promise<ApplyResult> {
  await bootstrap(client);
  const files = await loadMigrations(options.dir);
  const already = await appliedMigrations(client);
  assertHistoryIntact(files, already);

  const pending = files.filter((f) => !already.has(f.version));
  const appliedBy = options.appliedBy ?? process.env['USER'] ?? 'unknown';
  const applied: string[] = [];

  for (const file of pending) {
    const started = Date.now();
    try {
      if (file.inTransaction) await client.query('BEGIN');
      await client.query(file.sql);
      await client.query(
        `INSERT INTO kernel.schema_migration (version, name, sha256, applied_by, execution_ms)
         VALUES ($1, $2, $3, $4, $5)`,
        [file.version, file.name, file.sha256, appliedBy, Date.now() - started],
      );
      if (file.inTransaction) await client.query('COMMIT');
    } catch (error) {
      if (file.inTransaction) await client.query('ROLLBACK').catch(() => undefined);
      throw new Error(
        `Migration ${file.name} failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    applied.push(file.name);
    options.onProgress?.(file.name, Date.now() - started);
  }

  return { applied, alreadyApplied: already.size };
}

export async function resetSchemas(client: Client): Promise<void> {
  for (const schema of OWNED_SCHEMAS) {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
}
