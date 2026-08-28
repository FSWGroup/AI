import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { testDb, resetDatabase, seedRoles, seedOrg, makeWorker, type Fixture } from '../helpers/db';
import { hashToken } from '@/lib/crypto';
import {
  generateApiKey, signWebhook, verifyWebhookSignature, nextAttemptDelayMs,
  resetRateLimits, RATE_LIMIT_PER_MINUTE, MAX_WEBHOOK_ATTEMPTS,
} from '@/lib/api-keys';
import { API_WORKER_FIELDS } from '@/lib/api-serializers';
import { queueWebhooks } from '@/lib/webhooks';
import { GET as workersRoute } from '@/app/api/v1/workers/route';
import { GET as orgRoute } from '@/app/api/v1/org/route';
import { GET as headcountRoute } from '@/app/api/v1/headcount/route';

let fixture: Fixture;
let fullKey: string, readOnlyOrgKey: string, revokedKey: string, expiredKey: string;
let terminatedId: string;

const call = (
  route: (r: NextRequest) => Promise<Response>,
  path: string,
  key: string | null,
) =>
  route(
    new NextRequest(`http://localhost:3000${path}`, {
      headers: key ? new Headers({ authorization: `Bearer ${key}` }) : new Headers(),
    }),
  );

beforeAll(async () => {
  await resetDatabase();
  await seedRoles();
  fixture = await seedOrg();
  await makeWorker({ fixture, email: 'a@api.test', roleKeys: ['EMPLOYEE'], first: 'Ada', last: 'Nkemelu' });
  await makeWorker({ fixture, email: 'b@api.test', roleKeys: ['EMPLOYEE'], first: 'Bo', last: 'Reyes' });
  const gone = await makeWorker({ fixture, email: 'gone@api.test', roleKeys: ['EMPLOYEE'] });
  terminatedId = gone.workerId;
  await testDb.worker.update({
    where: { id: terminatedId },
    data: { status: 'TERMINATED', terminationDate: new Date() },
  });

  const full = generateApiKey();
  fullKey = full.key;
  await testDb.apiKey.create({
    data: { name: 'Full', keyHash: full.hash, prefix: full.prefix, scopes: ['workers.read', 'org.read', 'headcount.read'] },
  });

  const orgOnly = generateApiKey();
  readOnlyOrgKey = orgOnly.key;
  await testDb.apiKey.create({ data: { name: 'Org only', keyHash: orgOnly.hash, prefix: orgOnly.prefix, scopes: ['org.read'] } });

  const revoked = generateApiKey();
  revokedKey = revoked.key;
  await testDb.apiKey.create({
    data: { name: 'Revoked', keyHash: revoked.hash, prefix: revoked.prefix, scopes: ['workers.read'], active: false, revokedAt: new Date() },
  });

  const expired = generateApiKey();
  expiredKey = expired.key;
  await testDb.apiKey.create({
    data: {
      name: 'Expired', keyHash: expired.hash, prefix: expired.prefix, scopes: ['workers.read'],
      expiresAt: new Date(Date.now() - 86_400_000),
    },
  });
});

afterAll(async () => {
  await testDb.$disconnect();
});

beforeEach(() => {
  resetRateLimits();
});

describe('authentication', () => {
  it('refuses a request with no key', async () => {
    expect((await call(workersRoute, '/api/v1/workers', null)).status).toBe(401);
  });

  it('refuses an unknown key', async () => {
    expect((await call(workersRoute, '/api/v1/workers', 'fswp_not-a-real-key')).status).toBe(401);
  });

  it('gives the same 401 for revoked and expired keys, so keys cannot be probed', async () => {
    expect((await call(workersRoute, '/api/v1/workers', revokedKey)).status).toBe(401);
    expect((await call(workersRoute, '/api/v1/workers', expiredKey)).status).toBe(401);
  });

  it('stores only a hash of the key', async () => {
    const record = await testDb.apiKey.findFirstOrThrow({ where: { name: 'Full' } });
    expect(record.keyHash).toBe(hashToken(fullKey));
    expect(record.keyHash).not.toContain(fullKey);
  });

  it('accepts a valid key and records the use', async () => {
    const before = await testDb.apiKey.findFirstOrThrow({ where: { name: 'Full' } });
    const response = await call(workersRoute, '/api/v1/workers', fullKey);
    expect(response.status).toBe(200);
    const after = await testDb.apiKey.findFirstOrThrow({ where: { name: 'Full' } });
    expect(after.requestCount).toBe(before.requestCount + 1);
    expect(after.lastUsedAt).not.toBeNull();
  });
});

describe('scopes', () => {
  it('refuses a route the key has no scope for, with 403 not 401', async () => {
    const response = await call(workersRoute, '/api/v1/workers', readOnlyOrgKey);
    expect(response.status).toBe(403);
  });

  it('allows the route the key does carry', async () => {
    expect((await call(orgRoute, '/api/v1/org', readOnlyOrgKey)).status).toBe(200);
  });

  it('keeps headcount a separate scope from the directory', async () => {
    expect((await call(headcountRoute, '/api/v1/headcount', readOnlyOrgKey)).status).toBe(403);
    expect((await call(headcountRoute, '/api/v1/headcount', fullKey)).status).toBe(200);
  });

  it('records a denied scope for review', async () => {
    await call(workersRoute, '/api/v1/workers', readOnlyOrgKey);
    expect(await testDb.auditEvent.count({ where: { action: 'api.scope_denied' } })).toBeGreaterThan(0);
  });
});

describe('what the API returns', () => {
  it('exposes exactly the allowlisted fields and nothing else', async () => {
    const body = await (await call(workersRoute, '/api/v1/workers', fullKey)).json();
    expect(body.data.length).toBeGreaterThan(0);
    for (const worker of body.data) {
      expect(Object.keys(worker).sort()).toEqual([...API_WORKER_FIELDS].sort());
    }
  });

  it('never leaks restricted personal data', async () => {
    const raw = await (await call(workersRoute, '/api/v1/workers?limit=200', fullKey)).text();
    for (const forbidden of [
      'dateOfBirth', 'homeStreet', 'homeCity', 'personalEmail', 'compensation',
      'passwordHash', 'kioskPinHash', 'mfaSecret', 'terminationReason', 'ssn',
    ]) {
      expect(raw).not.toContain(forbidden);
    }
    // And no actual seeded values either.
    expect(raw).not.toContain('1 Test Lane');
    expect(raw).not.toContain('1990-05-15');
  });

  it('excludes terminated workers by default', async () => {
    const body = await (await call(workersRoute, '/api/v1/workers', fullKey)).json();
    expect(body.data.map((w: { id: string }) => w.id)).not.toContain(terminatedId);
  });

  it('paginates with a cursor rather than returning everything', async () => {
    const first = await (await call(workersRoute, '/api/v1/workers?limit=1', fullKey)).json();
    expect(first.data).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await (await call(workersRoute, `/api/v1/workers?limit=1&cursor=${first.nextCursor}`, fullKey)).json();
    expect(second.data[0]?.id).not.toBe(first.data[0].id);
  });

  it('caps the page size however large a limit is asked for', async () => {
    const body = await (await call(workersRoute, '/api/v1/workers?limit=100000', fullKey)).json();
    expect(body.data.length).toBeLessThanOrEqual(200);
  });

  it('rejects a malformed updatedSince rather than ignoring it', async () => {
    expect((await call(workersRoute, '/api/v1/workers?updatedSince=yesterday', fullKey)).status).toBe(400);
  });

  it('returns aggregates only from the headcount route', async () => {
    const body = await (await call(headcountRoute, '/api/v1/headcount', fullKey)).json();
    expect(body.data.byStatus).toBeDefined();
    expect(JSON.stringify(body)).not.toContain('@api.test'); // no individual records
  });

  it('marks every response uncacheable', async () => {
    const response = await call(orgRoute, '/api/v1/org', readOnlyOrgKey);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
});

describe('rate limiting', () => {
  it('lets a burst through then returns 429', async () => {
    let last = 200;
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE + 2; i++) {
      last = (await call(orgRoute, '/api/v1/org', readOnlyOrgKey)).status;
    }
    expect(last).toBe(429);
  });

  it('is per key, not global', async () => {
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE + 2; i++) {
      await call(orgRoute, '/api/v1/org', readOnlyOrgKey);
    }
    expect((await call(orgRoute, '/api/v1/org', fullKey)).status).toBe(200);
  });
});

describe('webhook signing', () => {
  const secret = 'a-shared-secret-value';
  const body = JSON.stringify({ event: 'WORKER_ADDED', data: { workerId: 'w1' } });
  const timestamp = 1_800_000_000;

  it('verifies a correct signature', () => {
    expect(verifyWebhookSignature(secret, body, timestamp, signWebhook(secret, body, timestamp))).toBe(true);
  });

  it('rejects a tampered body', () => {
    const signature = signWebhook(secret, body, timestamp);
    expect(verifyWebhookSignature(secret, `${body} `, timestamp, signature)).toBe(false);
  });

  it('rejects a replayed signature under a different timestamp', () => {
    const signature = signWebhook(secret, body, timestamp);
    expect(verifyWebhookSignature(secret, body, timestamp + 1, signature)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    expect(verifyWebhookSignature('other-secret', body, timestamp, signWebhook(secret, body, timestamp))).toBe(false);
  });

  it('rejects a malformed signature without throwing', () => {
    expect(verifyWebhookSignature(secret, body, timestamp, 'not-hex-at-all')).toBe(false);
    expect(verifyWebhookSignature(secret, body, timestamp, '')).toBe(false);
  });

  it('backs off exponentially and caps', () => {
    expect(nextAttemptDelayMs(1)).toBe(60_000);
    expect(nextAttemptDelayMs(2)).toBe(120_000);
    expect(nextAttemptDelayMs(MAX_WEBHOOK_ATTEMPTS)).toBeLessThanOrEqual(3_600_000);
  });
});

describe('webhook queueing', () => {
  beforeEach(async () => {
    await testDb.webhookDelivery.deleteMany();
    await testDb.webhookEndpoint.deleteMany();
  });

  it('queues one delivery per subscribed endpoint', async () => {
    await testDb.webhookEndpoint.create({
      data: { name: 'A', url: 'https://a.invalid/hook', secretEnc: 'x', events: ['WORKER_ADDED'] },
    });
    await testDb.webhookEndpoint.create({
      data: { name: 'B', url: 'https://b.invalid/hook', secretEnc: 'x', events: ['PTO_APPROVED'] },
    });

    expect(await queueWebhooks('WORKER_ADDED', { workerId: 'w1' })).toBe(1);
    const deliveries = await testDb.webhookDelivery.findMany({ include: { endpoint: true } });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].endpoint.name).toBe('A');
  });

  it('treats an empty event list as “everything”', async () => {
    await testDb.webhookEndpoint.create({
      data: { name: 'All', url: 'https://all.invalid/hook', secretEnc: 'x', events: [] },
    });
    expect(await queueWebhooks('ANYTHING_AT_ALL', {})).toBe(1);
  });

  it('skips a disabled endpoint', async () => {
    await testDb.webhookEndpoint.create({
      data: { name: 'Off', url: 'https://off.invalid/hook', secretEnc: 'x', events: [], active: false },
    });
    expect(await queueWebhooks('WORKER_ADDED', {})).toBe(0);
  });

  it('never throws, so a webhook problem cannot break an HR action', async () => {
    await testDb.webhookEndpoint.create({
      data: { name: 'Fine', url: 'https://fine.invalid/hook', secretEnc: 'x', events: [] },
    });
    await expect(queueWebhooks('WORKER_ADDED', { nested: { deeply: true } })).resolves.toBeTypeOf('number');
  });
});
