import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Type } from '@sinclair/typebox';
import { sql } from 'kysely';
import { createTestDatabase, connectTo, type TestDatabase } from '../support/database.js';
import { testContext, testDeps } from '../support/context.js';
import { createUnitOfWork, withUnitOfWork } from '../../src/kernel/unit-of-work.js';
import {
  defineEvent,
  syncEventRegistry,
  readEvents,
  latestSequence,
} from '../../src/modules/events/index.js';
import type { Database } from '../../src/platform/db/index.js';

const Ticked = defineEvent({
  type: 'fsw.kernel.Ticked',
  version: 1,
  module: 'kernel',
  aggregateType: 'Ticker',
  description: 'A test event used to prove ledger ordering guarantees.',
  payload: Type.Object({ n: Type.Integer() }),
});

/** Resolve to 'pending' if the promise has not settled within `ms`. */
async function settledWithin<T>(
  promise: Promise<T>,
  ms: number,
): Promise<'settled' | 'pending'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'pending'>((resolve) => {
    timer = setTimeout(() => resolve('pending'), ms);
  });
  const result = await Promise.race([promise.then(() => 'settled' as const), timeout]);
  if (timer !== undefined) clearTimeout(timer);
  return result;
}

describe('event ledger ordering (ADR-0008)', () => {
  let testDb: TestDatabase;
  const deps = testDeps();

  beforeAll(async () => {
    testDb = await createTestDatabase('ordering');
    await syncEventRegistry(testDb.db, [Ticked]);
  });
  afterAll(async () => {
    await testDb.close();
  });

  it('serialises sequence assignment with commit order', async () => {
    // The guarantee: a transaction that has drawn a sequence number holds the
    // advisory lock until it commits, so a later transaction cannot draw a lower
    // number and commit first. Without this, a reader tailing `sequence > cursor`
    // would skip an event that commits after the reader has passed its number.
    const a = connectTo(testDb, 'ordering-a');
    const b = connectTo(testDb, 'ordering-b');

    try {
      const trxA = await a.db.startTransaction().execute();
      const trxB = await b.db.startTransaction().execute();

      const uowA = createUnitOfWork(trxA, testContext(), deps);
      uowA.uow.emit(Ticked, { n: 1 }, { aggregateId: 'lock-demo' });
      await uowA.flush(); // takes the lock, draws a sequence, holds the lock

      const uowB = createUnitOfWork(trxB, testContext(), deps);
      uowB.uow.emit(Ticked, { n: 2 }, { aggregateId: 'lock-demo' });
      const flushB = uowB.flush();

      // B must be blocked: A still holds the sequence lock.
      expect(await settledWithin(flushB, 300)).toBe('pending');

      await trxA.commit().execute();
      await flushB;
      await trxB.commit().execute();

      const events = await readEvents(testDb.db, {
        aggregate: { type: 'Ticker', id: 'lock-demo' },
      });
      expect(events.map((e) => (e.payload as { n: number }).n)).toEqual([1, 2]);
      expect(BigInt(events[0]!.sequence)).toBeLessThan(BigInt(events[1]!.sequence));
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('never lets a tailing reader skip a committed event', async () => {
    // Concurrent writers with staggered work, and a reader following the cursor the
    // way an external consumer would. Every event must be seen exactly once, in
    // sequence order, with no gap that later fills in.
    const writerCount = 24;
    const pools: { db: Database; close(): Promise<void> }[] = [];
    for (let i = 0; i < 4; i += 1) pools.push(connectTo(testDb, `writer-${i}`));

    const startSequence = await latestSequence(testDb.db);
    const seen: number[] = [];
    let reading = true;

    const reader = (async () => {
      let cursor = startSequence;
      for (;;) {
        const batch = await readEvents(testDb.db, {
          after: cursor,
          types: ['fsw.kernel.Ticked'],
          limit: 100,
        });
        for (const event of batch) {
          const n = (event.payload as { n: number }).n;
          if (n >= 1000) seen.push(n);
          cursor = event.sequence;
        }
        if (!reading && batch.length === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return cursor;
    })();

    try {
      await Promise.all(
        Array.from({ length: writerCount }, (_, i) =>
          withUnitOfWork(
            pools[i % pools.length]!.db,
            testContext(),
            deps,
            async (uow) => {
              // Work of varying duration before the flush, so transactions genuinely
              // interleave rather than lining up by accident.
              await new Promise((resolve) => setTimeout(resolve, (i * 7) % 23));
              uow.emit(Ticked, { n: 1000 + i }, { aggregateId: 'tail-demo' });
            },
          ),
        ),
      );
      reading = false;
      await reader;

      const expected = Array.from({ length: writerCount }, (_, i) => 1000 + i);
      const counts = new Map<number, number>();
      for (const n of seen) counts.set(n, (counts.get(n) ?? 0) + 1);
      const duplicates = [...counts].filter(([, c]) => c > 1);
      expect(duplicates, 'an event was observed more than once').toEqual([]);
      expect([...seen].sort((x, y) => x - y)).toEqual(expected);
      expect(new Set(seen).size).toBe(writerCount);
    } finally {
      for (const pool of pools) await pool.close();
    }
  });

  it('orders the feed numerically, not lexicographically', async () => {
    // Regression: selecting `sequence::text AS sequence` made ORDER BY resolve to the
    // text output column, so sequence 10 sorted before sequence 9 and a tailing
    // cursor could move backwards and re-deliver events. The boundary is any run
    // that crosses a power of ten.
    const all = await readEvents(testDb.db, { after: '0', limit: 1000 });
    const sequences = all.map((e) => BigInt(e.sequence));
    expect(sequences.length).toBeGreaterThan(10);
    for (let i = 1; i < sequences.length; i += 1) {
      expect(sequences[i]! > sequences[i - 1]!).toBe(true);
    }
  });

  it('assigns a contiguous sequence with no gaps for committed events', async () => {
    const { rows } = await sql<{ gaps: string }>`
      WITH ordered AS (
        SELECT sequence, lag(sequence) OVER (ORDER BY sequence) AS previous
          FROM events.domain_event
      )
      SELECT count(*)::text AS gaps FROM ordered
       WHERE previous IS NOT NULL AND sequence <> previous + 1
    `.execute(testDb.db);
    // Gaps would only appear from rolled-back transactions, which this suite has
    // none of. A gap here would mean a sequence was drawn and lost.
    expect(rows[0]!.gaps).toBe('0');
  });
});
