import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import { db } from '@/lib/db';
import { generateToken, hashToken } from '@/lib/crypto';
import { auditAnonymous } from '@/lib/audit';

/**
 * Machine credentials for the versioned read API.
 *
 * Other FSW systems currently re-key employee data out of here, which is how
 * it drifts. A narrow, scoped, read-only API removes the reason to copy
 * anything — and being read-only is the point: nothing outside this
 * application may change an HR record without going through the same
 * authorization and audit path a person does.
 *
 * Keys are hashed like passwords. The plaintext exists once, in the response
 * that created it, and is never recoverable — which is why the UI says so
 * loudly rather than offering a "show key" button that could not work.
 */

export const API_SCOPES = {
  'workers.read': 'Read the directory: names, work contact, title, department, manager, status',
  'org.read': 'Read org structure: departments, teams, locations, legal entities',
  'headcount.read': 'Read aggregate headcount figures',
} as const;

export type ApiScope = keyof typeof API_SCOPES;
export const ALL_API_SCOPES = Object.keys(API_SCOPES) as ApiScope[];

/** Requests per key per minute. Generous for a sync job, useless for scraping. */
export const RATE_LIMIT_PER_MINUTE = 120;

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `fswp_${generateToken()}`;
  return { key, hash: hashToken(key), prefix: key.slice(0, 12) };
}

export type AuthResult =
  | { ok: true; keyId: string; scopes: ApiScope[]; name: string }
  | { ok: false; status: 401 | 403 | 429; error: string };

// In-process rate limiting. Single-node only, and stated as such in
// DEPLOYMENT.md — a multi-node deployment needs a shared counter.
const requestWindows = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(keyId: string, now = Date.now()): boolean {
  const window = requestWindows.get(keyId);
  if (!window || window.resetAt <= now) {
    requestWindows.set(keyId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (window.count >= RATE_LIMIT_PER_MINUTE) return false;
  window.count += 1;
  return true;
}

/** Test seam: clear the in-process rate-limit state. */
export function resetRateLimits(): void {
  requestWindows.clear();
}

/**
 * Authenticate a request and check it carries the scope it needs.
 *
 * Failures are deliberately uniform: an unknown key, a revoked key and an
 * expired key all return the same 401, so the endpoint cannot be used to
 * probe which keys exist.
 */
export async function authenticateApiRequest(
  authorization: string | null,
  required: ApiScope,
): Promise<AuthResult> {
  const presented = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : null;
  if (!presented) return { ok: false, status: 401, error: 'Missing bearer token.' };

  const record = await db.apiKey.findUnique({ where: { keyHash: hashToken(presented) } });
  if (!record || !record.active || record.revokedAt || (record.expiresAt && record.expiresAt < new Date())) {
    await auditAnonymous('api.auth_failed', { metadata: { reason: record ? 'inactive' : 'unknown' } });
    return { ok: false, status: 401, error: 'Invalid API key.' };
  }

  const scopes = (record.scopes as string[]).filter((s): s is ApiScope => s in API_SCOPES);
  if (!scopes.includes(required)) {
    await auditAnonymous('api.scope_denied', { metadata: { keyId: record.id, required } });
    return { ok: false, status: 403, error: `This key does not carry the ${required} scope.` };
  }
  if (!rateLimit(record.id)) {
    return { ok: false, status: 429, error: 'Rate limit exceeded. Try again in a minute.' };
  }

  await db.apiKey.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date(), requestCount: { increment: 1 } },
  });
  return { ok: true, keyId: record.id, scopes, name: record.name };
}

// ---------------------------------------------------------------------------
// Outbound webhooks
// ---------------------------------------------------------------------------

export const MAX_WEBHOOK_ATTEMPTS = 5;

/**
 * Sign a payload the same way we ask Indeed to sign theirs: HMAC-SHA256 over
 * the exact bytes sent, so the receiver can verify without trusting transport.
 * The timestamp is inside the signed string, so a captured delivery cannot be
 * replayed indefinitely.
 */
export function signWebhook(secret: string, body: string, timestamp: number): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
}

export function verifyWebhookSignature(
  secret: string,
  body: string,
  timestamp: number,
  signature: string,
): boolean {
  const expected = Buffer.from(signWebhook(secret, body, timestamp), 'hex');
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** Exponential backoff, capped. Attempt 1 retries in a minute, attempt 5 in ~an hour. */
export function nextAttemptDelayMs(attempt: number): number {
  return Math.min(60_000 * 2 ** (attempt - 1), 3_600_000);
}
