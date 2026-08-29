import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Type } from '@sinclair/typebox';
import { sql } from 'kysely';
import { createTestDatabase, type TestDatabase } from '../support/database.js';
import { testContext, testDeps } from '../support/context.js';
import { withUnitOfWork } from '../../src/kernel/unit-of-work.js';
import {
  defineEvent,
  syncEventRegistry,
  runProjection,
  replayProjection,
  type Projection,
} from '../../src/modules/events/index.js';
import type { DbTransaction } from '../../src/platform/db/index.js';

const AccountOpened = defineEvent({
  type: 'fsw.kernel.AccountOpened',
  version: 1,
  module: 'kernel',
  aggregateType: 'Account',
  description: 'A test aggregate used to prove read models rebuild from event zero.',
  payload: Type.Object({ accountId: Type.String(), openingBalance: Type.Integer() }),
});

const AmountPosted = defineEvent({
  type: 'fsw.kernel.AmountPosted',
  version: 1,
  module: 'kernel',
  aggregateType: 'Account',
  description: 'An amount was posted to a test aggregate.',
  payload: Type.Object({ accountId: Type.String(), amount: Type.Integer() }),
});

const Unrelated = defineEvent({
  type: 'fsw.kernel.Unrelated',
  version: 1,
  module: 'kernel',
  aggregateType: 'Other',
  description: 'An event this projection must ignore.',
  payload: Type.Object({ noise: Type.String() }),
});

/** A deliberately trivial read model: balances derived only from the ledger. */
const balanceProjection: Projection = {
  key: 'test_balances',
  handles: ['fsw.kernel.AccountOpened', 'fsw.kernel.AmountPosted'],
  async apply(tx: DbTransaction, event) {
    if (event.eventType === 'fsw.kernel.AccountOpened') {
      const payload = event.payload as { accountId: string; openingBalance: number };
      await sql`
        INSERT INTO kernel.test_balance (account_id, balance, applied_events)
        VALUES (${payload.accountId}, ${payload.openingBalance}, 1)
        ON CONFLICT (account_id) DO UPDATE
          SET balance = kernel.test_balance.balance + EXCLUDED.balance,
              applied_events = kernel.test_balance.applied_events + 1
      `.execute(tx);
      return;
    }
    const payload = event.payload as { accountId: string; amount: number };
    await sql`
      UPDATE kernel.test_balance
         SET balance = balance + ${payload.amount},
             applied_events = applied_events + 1
       WHERE account_id = ${payload.accountId}
    `.execute(tx);
  },
  async reset(tx: DbTransaction) {
    await sql`DELETE FROM kernel.test_balance`.execute(tx);
  },
};

describe('read models rebuild from the ledger (acceptance criteria 18 and 19)', () => {
  let testDb: TestDatabase;
  const deps = testDeps();

  beforeAll(async () => {
    testDb = await createTestDatabase('projection');
    await syncEventRegistry(testDb.db, [AccountOpened, AmountPosted, Unrelated]);
    await sql`
      CREATE TABLE kernel.test_balance (
        account_id     text PRIMARY KEY,
        balance        bigint NOT NULL,
        applied_events integer NOT NULL DEFAULT 0
      )
    `.execute(testDb.db);

    await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
      uow.emit(
        AccountOpened,
        { accountId: 'A', openingBalance: 100 },
        { aggregateId: 'A' },
      );
      uow.emit(
        AccountOpened,
        { accountId: 'B', openingBalance: 50 },
        { aggregateId: 'B' },
      );
    });
    for (const [account, amount] of [
      ['A', 25],
      ['B', -10],
      ['A', -5],
      ['A', 30],
    ] as const) {
      await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
        uow.emit(AmountPosted, { accountId: account, amount }, { aggregateId: account });
      });
    }
    // Noise the projection must not consume.
    await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
      uow.emit(Unrelated, { noise: 'ignore me' }, { aggregateId: 'n/a' });
    });
  });

  afterAll(async () => {
    await testDb.close();
  });

  async function balances(): Promise<Record<string, number>> {
    const { rows } = await sql<{ account_id: string; balance: string }>`
      SELECT account_id, balance FROM kernel.test_balance ORDER BY account_id
    `.execute(testDb.db);
    return Object.fromEntries(rows.map((r) => [r.account_id, Number(r.balance)]));
  }

  it('builds the read model from the ledger', async () => {
    const result = await runProjection(testDb.db, balanceProjection);
    expect(result.applied).toBe(6);
    expect(await balances()).toEqual({ A: 150, B: 40 });
  });

  it('is a no-op when re-run with nothing new (idempotent)', async () => {
    const result = await runProjection(testDb.db, balanceProjection);
    expect(result.applied).toBe(0);
    expect(await balances()).toEqual({ A: 150, B: 40 });
  });

  it('leaves state correct when the same event is delivered twice', async () => {
    // Rewind the cursor without clearing the inbox: exactly what happens when a
    // consumer is restarted from an older checkpoint, or a broker redelivers.
    await sql`UPDATE events.consumer_cursor SET last_sequence = 0 WHERE consumer_key = ${balanceProjection.key}`.execute(
      testDb.db,
    );
    const result = await runProjection(testDb.db, balanceProjection);
    expect(result.applied).toBe(0);
    expect(result.skippedDuplicates).toBe(6);
    expect(await balances()).toEqual({ A: 150, B: 40 });
  });

  it('rebuilds an erased read model by replaying from sequence zero', async () => {
    await sql`DELETE FROM kernel.test_balance`.execute(testDb.db);
    expect(await balances()).toEqual({});

    const result = await replayProjection(testDb.db, balanceProjection);

    expect(result.applied).toBe(6);
    expect(result.skippedDuplicates).toBe(0);
    expect(await balances()).toEqual({ A: 150, B: 40 });

    const { rows } = await sql<{ applied_events: number }>`
      SELECT applied_events FROM kernel.test_balance WHERE account_id = 'A'
    `.execute(testDb.db);
    // Four A events applied exactly once each: opening plus three postings.
    expect(rows[0]!.applied_events).toBe(4);
  });

  it('ignores events it does not handle', async () => {
    const { rows } = await sql<{ count: string }>`
      SELECT count(*)::text AS count FROM events.consumer_inbox
       WHERE consumer_key = ${balanceProjection.key}
    `.execute(testDb.db);
    // Six handled events; the Unrelated event is never claimed.
    expect(rows[0]!.count).toBe('6');
  });

  it('continues to advance after a replay', async () => {
    await withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
      uow.emit(AmountPosted, { accountId: 'B', amount: 7 }, { aggregateId: 'B' });
    });
    const result = await runProjection(testDb.db, balanceProjection);
    expect(result.applied).toBe(1);
    expect(await balances()).toEqual({ A: 150, B: 47 });
  });
});
