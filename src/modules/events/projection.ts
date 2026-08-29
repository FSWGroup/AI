/**
 * In-process read models, driven from the ledger (ADR-0010).
 *
 * A projection is a consumer like any other: it tracks a cursor, it records what it
 * has already applied, and duplicate delivery is a primary-key conflict rather than
 * corruption. Wiping the read model and replaying from sequence zero is a supported,
 * tested operation — acceptance criterion 18.
 */
import { sql } from 'kysely';
import type { Database, DbTransaction } from '../../platform/db/index.js';
import { readEvents, matchesAny } from './feed.js';
import type { LedgerEvent } from './feed.js';

export interface Projection {
  /** Stable consumer key. Renaming it silently restarts the projection from zero. */
  readonly key: string;
  /** Event-type globs this projection consumes. */
  readonly handles: readonly string[];
  apply(tx: DbTransaction, event: LedgerEvent): Promise<void>;
  /** Clear the read model. Called before a replay. */
  reset(tx: DbTransaction): Promise<void>;
}

export interface RunResult {
  readonly applied: number;
  readonly skippedDuplicates: number;
  readonly lastSequence: string;
}

const DEFAULT_BATCH = 500;

/**
 * Apply everything the projection has not yet seen. Idempotent: an event already in
 * the inbox is skipped, so re-running after a partial failure, or delivering the same
 * event twice, leaves state correct (acceptance criterion 19).
 */
export async function runProjection(
  db: Database,
  projection: Projection,
  options: { batchSize?: number; maxBatches?: number } = {},
): Promise<RunResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY;

  let applied = 0;
  let skipped = 0;
  let batches = 0;
  let lastSequence = await cursorOf(db, projection.key);

  for (;;) {
    if (batches >= maxBatches) break;
    batches += 1;

    const outcome = await db.transaction().execute(async (tx) => {
      const events = await readEvents(tx, {
        after: lastSequence,
        limit: batchSize,
        types: projection.handles,
      });
      if (events.length === 0)
        return { count: 0, applied: 0, skipped: 0, last: lastSequence };

      let batchApplied = 0;
      let batchSkipped = 0;

      for (const event of events) {
        // Defence in depth: the SQL filter and the in-memory matcher must agree.
        if (!matchesAny(event.eventType, projection.handles)) continue;

        const claimed = await sql<{ event_id: string }>`
          INSERT INTO events.consumer_inbox (consumer_key, event_id)
          VALUES (${projection.key}, ${event.id})
          ON CONFLICT (consumer_key, event_id) DO NOTHING
          RETURNING event_id
        `.execute(tx);

        if (claimed.rows.length === 0) {
          batchSkipped += 1;
          continue;
        }
        await projection.apply(tx, event);
        batchApplied += 1;
      }

      const last = events[events.length - 1]!.sequence;
      await sql`
        INSERT INTO events.consumer_cursor (consumer_key, last_sequence, updated_at)
        VALUES (${projection.key}, ${last}::bigint, now())
        ON CONFLICT (consumer_key)
        DO UPDATE SET last_sequence = EXCLUDED.last_sequence, updated_at = now()
      `.execute(tx);

      return { count: events.length, applied: batchApplied, skipped: batchSkipped, last };
    });

    applied += outcome.applied;
    skipped += outcome.skipped;
    lastSequence = outcome.last;
    if (outcome.count < batchSize) break;
  }

  return { applied, skippedDuplicates: skipped, lastSequence };
}

/**
 * Rebuild from event zero: clear the read model, forget what was processed, replay.
 * The reset and the cursor rewind share a transaction, so a crash cannot leave a
 * projection that believes it is up to date while holding an empty read model.
 */
export async function replayProjection(
  db: Database,
  projection: Projection,
): Promise<RunResult> {
  await db.transaction().execute(async (tx) => {
    await projection.reset(tx);
    await sql`DELETE FROM events.consumer_inbox WHERE consumer_key = ${projection.key}`.execute(
      tx,
    );
    await sql`
      INSERT INTO events.consumer_cursor (consumer_key, last_sequence, updated_at)
      VALUES (${projection.key}, 0, now())
      ON CONFLICT (consumer_key)
      DO UPDATE SET last_sequence = 0, updated_at = now()
    `.execute(tx);
  });
  return runProjection(db, projection);
}

async function cursorOf(db: Database, consumerKey: string): Promise<string> {
  const result = await sql<{ last_sequence: string }>`
    SELECT last_sequence::text FROM events.consumer_cursor WHERE consumer_key = ${consumerKey}
  `.execute(db);
  return result.rows[0]?.last_sequence ?? '0';
}
