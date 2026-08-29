/**
 * Database access (ADR-0005). Kysely over node-postgres. No ORM: the SQL we write
 * is the SQL that runs, and the database keeps the invariants.
 */
import { Kysely, PostgresDialect } from 'kysely';
import type { Transaction } from 'kysely';
import pg from 'pg';
import type { DB } from './schema.js';

export type { DB };
export type Database = Kysely<DB>;
export type DbTransaction = Transaction<DB>;

/**
 * NUMERIC must not become a JavaScript float. Postgres type OID 1700 is returned as
 * a string and handled with decimal.js wherever arithmetic is required (ADR-0001).
 * BIGINT (OID 20) is likewise returned as a string; the event sequence exceeds
 * Number.MAX_SAFE_INTEGER only in theory, but silent precision loss is not a class
 * of bug worth leaving open.
 */
pg.types.setTypeParser(1700, (value) => value);
pg.types.setTypeParser(20, (value) => value);

export interface DatabaseOptions {
  readonly connectionString: string;
  readonly poolMax?: number;
  readonly statementTimeoutMs?: number;
  readonly applicationName?: string;
}

export function createPool(options: DatabaseOptions): pg.Pool {
  return new pg.Pool({
    connectionString: options.connectionString,
    max: options.poolMax ?? 10,
    application_name: options.applicationName ?? 'fsw-layer0',
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    // A transaction that has gone idle while holding the event sequence lock would
    // block every other writer. Fail it instead.
    idle_in_transaction_session_timeout: 30_000,
  });
}

export function createDatabase(pool: pg.Pool): Database {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

export async function closeDatabase(db: Database): Promise<void> {
  await db.destroy();
}
