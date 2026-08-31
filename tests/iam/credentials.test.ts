import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { createTestDatabase, type TestDatabase } from '../support/database.js';
import { testContext, testDeps } from '../support/context.js';
import { expectRefusal } from '../support/errors.js';
import { syncEventRegistry } from '../../src/modules/events/index.js';
import { ALL_EVENTS } from '../../src/event-catalog.js';
import { withUnitOfWork, type UnitOfWork } from '../../src/kernel/unit-of-work.js';
import {
  authenticateCredential,
  createServiceAccount,
  expiringCredentials,
  issueCredential,
  revokeCredential,
  rotateCredential,
} from '../../src/modules/iam/index.js';

/**
 * Machine credentials (ADR-0020, spec §62).
 *
 * The rules worth proving are all about what must NOT happen: the secret must not be
 * recoverable, must not appear in the database, must not reach an audit record, and
 * must not survive its expiry or its revocation.
 */
describe('machine credentials', () => {
  let testDb: TestDatabase;
  let deps: ReturnType<typeof testDeps>;
  let principalId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase('credentials');
    await syncEventRegistry(testDb.db, ALL_EVENTS);
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await sql`
      TRUNCATE iam.api_credential, iam.service_account, iam.principal RESTART IDENTITY CASCADE
    `.execute(testDb.db);
    await sql`
      TRUNCATE events.event_delivery, events.domain_event, audit.change_log
        RESTART IDENTITY CASCADE
    `.execute(testDb.db);
    deps = testDeps();
    principalId = await inUnitOfWork(async (uow) => {
      const account = await createServiceAccount(uow, {
        key: 'dispatcher',
        description: 'Delivers events to subscribers.',
        ownerNote: 'Data platform team.',
      });
      return account.principalId;
    });
  });

  async function inUnitOfWork<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    return withUnitOfWork(testDb.db, testContext(), deps, work);
  }

  it('hashes with Argon2id and stores no trace of the secret', async () => {
    const issued = await inUnitOfWork(async (uow) =>
      issueCredential(uow, { principalId, label: 'Primary' }),
    );

    const row = await sql<{ secret_hash: string; hash_algorithm: string }>`
      SELECT secret_hash, hash_algorithm FROM iam.api_credential
    `.execute(testDb.db);

    // The variant is pinned here because the library declares its algorithm as an
    // ambient const enum that the source has to reference numerically.
    expect(row.rows[0]!.secret_hash.startsWith('$argon2id$')).toBe(true);
    expect(row.rows[0]!.hash_algorithm).toBe('argon2id');

    // The secret itself appears nowhere. Not in the row, not in a column that
    // happens to hold it, not anywhere in the table.
    const secretPart = issued.secret.slice(issued.secret.indexOf('.') + 1);
    const everything = await sql<{ dump: string }>`
      SELECT (to_jsonb(c.*))::text AS dump FROM iam.api_credential c
    `.execute(testDb.db);
    expect(everything.rows[0]!.dump).not.toContain(secretPart);
  });

  it('keeps the secret out of the audit log and the event ledger', async () => {
    const issued = await inUnitOfWork(async (uow) =>
      issueCredential(uow, { principalId, label: 'Primary' }),
    );
    const secretPart = issued.secret.slice(issued.secret.indexOf('.') + 1);

    const audit = await sql<{ dump: string }>`
      SELECT (to_jsonb(a.*))::text AS dump FROM audit.change_log a
    `.execute(testDb.db);
    for (const row of audit.rows) expect(row.dump).not.toContain(secretPart);

    const events = await sql<{ dump: string }>`
      SELECT (to_jsonb(e.*))::text AS dump FROM events.domain_event e
    `.execute(testDb.db);
    expect(events.rows.length).toBeGreaterThan(0);
    for (const row of events.rows) expect(row.dump).not.toContain(secretPart);

    // The event does say a credential exists and when it expires — which is what a
    // consumer needs in order to alert on it.
    const rotated = await sql<{ payload: Record<string, unknown> }>`
      SELECT payload FROM events.domain_event WHERE event_type = 'fsw.iam.CredentialRotated'
    `.execute(testDb.db);
    expect(rotated.rows[0]!.payload['credentialId']).toBe(issued.credentialId);
    expect(rotated.rows[0]!.payload['expiresAt']).toBeDefined();
  });

  // The suite runs on a FixedClock, so every assertion about expiry uses that clock
  // rather than the wall clock — the credential was written against it, and comparing
  // against real time would test the gap between the two.
  it('accepts the right secret and refuses everything else identically', async () => {
    const issued = await inUnitOfWork(async (uow) =>
      issueCredential(uow, { principalId, label: 'Primary' }),
    );

    const authenticated = await authenticateCredential(
      testDb.db,
      issued.secret,
      deps.clock.now(),
    );
    expect(authenticated.principalId).toBe(principalId);

    // Every failure looks the same. Distinguishing "no such credential" from "wrong
    // secret" tells an attacker which of their guesses was structurally right.
    const wrongSecret = `${issued.credentialId}.not-the-secret`;
    const unknownId = 'fsw_unknown.whatever';
    const messages = await Promise.all(
      [wrongSecret, unknownId, 'malformed', ''].map((presented) =>
        authenticateCredential(testDb.db, presented, deps.clock.now()).then(
          () => 'accepted',
          (error: Error) => error.message,
        ),
      ),
    );
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).not.toBe('accepted');
  });

  it('refuses a credential once it expires', async () => {
    const issued = await inUnitOfWork(async (uow) =>
      issueCredential(uow, { principalId, label: 'Short-lived', validForDays: 1 }),
    );
    const afterExpiry = new Date(issued.expiresAt.getTime() + 1000);
    await expectRefusal(
      authenticateCredential(testDb.db, issued.secret, afterExpiry),
      /not valid/,
    );
  });

  it('refuses a revoked credential immediately', async () => {
    const issued = await inUnitOfWork(async (uow) =>
      issueCredential(uow, { principalId, label: 'Leaked' }),
    );
    await inUnitOfWork(async (uow) =>
      revokeCredential(uow, issued.credentialId, 'Found in a build log.'),
    );
    await expectRefusal(
      authenticateCredential(testDb.db, issued.secret, deps.clock.now()),
      /not valid/,
    );
  });

  it('refuses a credential whose principal has been deactivated', async () => {
    const issued = await inUnitOfWork(async (uow) =>
      issueCredential(uow, { principalId, label: 'Primary' }),
    );
    await sql`
      UPDATE iam.principal
         SET is_active = false, deactivated_at = now(), deactivated_reason = 'Retired'
       WHERE id = ${principalId}::uuid
    `.execute(testDb.db);

    await expectRefusal(
      authenticateCredential(testDb.db, issued.secret, deps.clock.now()),
      /not valid/,
    );
  });

  it('rotates with an overlap, so both work while the caller redeploys', async () => {
    const original = await inUnitOfWork(async (uow) =>
      issueCredential(uow, { principalId, label: 'Primary', validForDays: 90 }),
    );
    const replacement = await inUnitOfWork(async (uow) =>
      rotateCredential(uow, original.credentialId, { overlapDays: 7 }),
    );

    const now = deps.clock.now();
    // Both work now. Revoking the old one at rotation time would turn every rotation
    // into a coordinated deploy, which is how credentials end up never rotated.
    await expect(
      authenticateCredential(testDb.db, original.secret, now),
    ).resolves.toMatchObject({
      principalId,
    });
    await expect(
      authenticateCredential(testDb.db, replacement.secret, now),
    ).resolves.toMatchObject({ principalId });

    // The old one's life was shortened, not ended.
    const rows = await sql<{
      credential_id: string;
      expires_at: Date;
      rotated_from_id: string | null;
    }>`
      SELECT credential_id, expires_at, rotated_from_id FROM iam.api_credential
       ORDER BY created_at
    `.execute(testDb.db);
    expect(rows.rows[0]!.expires_at.getTime()).toBeLessThan(
      rows.rows[1]!.expires_at.getTime(),
    );
    expect(rows.rows[1]!.rotated_from_id).not.toBeNull();

    // And it does stop working once the overlap is over.
    const afterOverlap = new Date(rows.rows[0]!.expires_at.getTime() + 1000);
    await expectRefusal(
      authenticateCredential(testDb.db, original.secret, afterOverlap),
      /not valid/,
    );
  });

  it('refuses to rotate a credential that is already revoked', async () => {
    const issued = await inUnitOfWork(async (uow) =>
      issueCredential(uow, { principalId, label: 'Primary' }),
    );
    await inUnitOfWork(async (uow) =>
      revokeCredential(uow, issued.credentialId, 'Compromised.'),
    );
    await expectRefusal(
      inUnitOfWork(async (uow) => rotateCredential(uow, issued.credentialId, {})),
      /already dead/,
    );
  });

  it('refuses a lifetime that amounts to never expiring', async () => {
    await expectRefusal(
      inUnitOfWork(async (uow) =>
        issueCredential(uow, { principalId, label: 'Forever', validForDays: 3650 }),
      ),
      /outside the permitted range/,
    );
  });

  it('surfaces credentials that are about to expire', async () => {
    await inUnitOfWork(async (uow) =>
      issueCredential(uow, { principalId, label: 'Expiring soon', validForDays: 10 }),
    );
    await inUnitOfWork(async (uow) =>
      issueCredential(uow, { principalId, label: 'Fine for now', validForDays: 200 }),
    );

    const expiring = await expiringCredentials(testDb.db, deps.clock.now(), 30);
    expect(expiring.map((c) => c.label)).toEqual(['Expiring soon']);
    expect(expiring[0]!.daysRemaining).toBeLessThanOrEqual(10);
  });

  it('issues a different secret every time', async () => {
    const secrets = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const issued = await inUnitOfWork(async (uow) =>
        issueCredential(uow, { principalId, label: `Key ${i}` }),
      );
      secrets.add(issued.secret);
    }
    expect(secrets.size).toBe(5);
  });
});
