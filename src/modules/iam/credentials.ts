/**
 * Machine credentials (ADR-0020, spec §62).
 *
 * The rule this file exists to enforce: **the secret is returned exactly once and is
 * never recoverable**. Not from the database, not from a log, not from an audit entry,
 * not by an administrator. There is no reset path, only rotation — which is a feature,
 * because a system that can show you a credential again is a system where a database
 * read is a credential compromise.
 *
 * Argon2id rather than a bare hash, even though these secrets are 256 bits of CSPRNG
 * output and therefore not brute-forceable. The reason is that the cost of being wrong
 * about that assumption is total, and the cost of being right anyway is a few
 * milliseconds per authentication.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  hash as argonHash,
  verify as argonVerify,
  type Algorithm,
} from '@node-rs/argon2';
import { sql } from 'kysely';
import type { Database, DbTransaction } from '../../platform/db/index.js';
import type { UnitOfWork } from '../../kernel/unit-of-work.js';
import { ValidationError, UnauthenticatedError } from '../../platform/errors.js';
import { CredentialRotated } from './events.js';

/**
 * Argon2id parameters.
 *
 * OWASP's second recommended configuration (19 MiB, two iterations, one lane). Chosen
 * over the heavier ones because this runs on the authentication path for machine
 * callers that may be making requests continuously, and because the input is
 * high-entropy: the memory hardness is defence in depth, not the primary control.
 */
/**
 * Argon2id, as the numeric value 2. The library declares its algorithm enum as an
 * ambient `const enum`, which TypeScript cannot read a value from under
 * `verbatimModuleSyntax`. The variant is pinned by a test that asserts the produced
 * hash begins `$argon2id$`, so this cannot drift silently into Argon2i.
 */
const ARGON2ID = 2 as Algorithm;

const ARGON_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** How long a credential lives unless the caller says otherwise. */
export const DEFAULT_CREDENTIAL_DAYS = 90;
/** Credentials expiring within this window are worth an alert (ADR-0020). */
export const EXPIRY_WARNING_DAYS = 30;

export interface IssuedCredential {
  readonly credentialId: string;
  /**
   * The full secret, in the form the caller presents it. Returned ONCE. Hold it in
   * memory only as long as it takes to hand to the caller: it must not be logged, put
   * in an audit record, or written anywhere.
   */
  readonly secret: string;
  readonly expiresAt: Date;
}

export interface IssueCredentialInput {
  readonly principalId: string;
  readonly label: string;
  readonly validForDays?: number;
  /** Set when replacing an existing credential, for overlapping rotation. */
  readonly rotatedFromId?: string | undefined;
}

/**
 * Issue a credential.
 *
 * The public identifier travels with every request so the right hash can be found
 * without hashing the presented secret against every row in the table — which, with a
 * deliberately slow hash, would be a denial-of-service vector rather than a security
 * measure.
 */
export async function issueCredential(
  uow: UnitOfWork,
  input: IssueCredentialInput,
): Promise<IssuedCredential> {
  const days = input.validForDays ?? DEFAULT_CREDENTIAL_DAYS;
  if (days <= 0 || days > 365) {
    throw new ValidationError(
      `A credential lifetime of ${days} days is outside the permitted range of 1 to ` +
        `365. A credential that never expires is one nobody ever rotates.`,
    );
  }

  const credentialId = `fsw_${randomBytes(9).toString('base64url')}`;
  const secretPart = randomBytes(32).toString('base64url');
  const secretHash = await argonHash(secretPart, ARGON_OPTIONS);

  // Both timestamps come from the INJECTED clock, and `created_at` is written
  // explicitly rather than left to `DEFAULT now()`. Mixing the two clocks is what
  // makes a row whose expiry precedes its own creation: the default would be the
  // transaction time while the expiry came from the clock the caller supplied, and
  // under a fixed test clock those are not the same instant. The CHECK constraint
  // catches it, which is the argument for having the constraint.
  const createdAt = uow.clock.now();
  const expiresAt = new Date(createdAt.getTime() + days * 86_400_000);

  const id = uow.ids.next();
  await sql`
    INSERT INTO iam.api_credential
      (id, principal_id, credential_id, secret_hash, label, created_by, created_at,
       expires_at, rotated_from_id)
    VALUES (${id}, ${input.principalId}::uuid, ${credentialId}, ${secretHash},
            ${input.label}, ${uow.context.actor.principalId ?? null}::uuid,
            ${createdAt.toISOString()}::timestamptz,
            ${expiresAt.toISOString()}::timestamptz, ${input.rotatedFromId ?? null}::uuid)
  `.execute(uow.tx);

  // The audit entry records that a credential was issued and which one. The secret is
  // not in it, and could not be: it is never passed to anything that writes.
  uow.audit({
    schema: 'iam',
    table: 'api_credential',
    entityId: id,
    operation: 'INSERT',
    after: { id, credential_id: credentialId, label: input.label, expires_at: expiresAt },
  });

  uow.emit(
    CredentialRotated,
    {
      principalId: input.principalId,
      credentialId,
      replacesCredentialId: null,
      expiresAt: expiresAt.toISOString(),
    },
    { aggregateId: input.principalId },
  );

  return { credentialId, secret: `${credentialId}.${secretPart}`, expiresAt };
}

/**
 * Replace a credential without downtime.
 *
 * Both work until the old one expires. Revoking the old one immediately is the obvious
 * implementation and the wrong one: it turns every rotation into a coordinated deploy,
 * which is how credentials end up never being rotated at all.
 */
export async function rotateCredential(
  uow: UnitOfWork,
  credentialId: string,
  input: { label?: string; validForDays?: number; overlapDays?: number },
): Promise<IssuedCredential> {
  const found = await sql<{
    id: string;
    principal_id: string;
    label: string;
    revoked_at: Date | null;
  }>`
    SELECT id, principal_id, label, revoked_at FROM iam.api_credential
     WHERE credential_id = ${credentialId}
  `.execute(uow.tx);
  const existing = found.rows[0];
  if (existing === undefined) {
    throw new ValidationError(`No credential '${credentialId}'.`);
  }
  if (existing.revoked_at !== null) {
    throw new ValidationError(
      `Credential '${credentialId}' is revoked. Issue a new one rather than rotating a ` +
        `credential that is already dead.`,
    );
  }

  const issued = await issueCredential(uow, {
    principalId: existing.principal_id,
    label: input.label ?? existing.label,
    ...(input.validForDays === undefined ? {} : { validForDays: input.validForDays }),
    rotatedFromId: existing.id,
  });

  // The old credential's life is shortened rather than ended, so the caller has a
  // window to deploy the new one.
  const overlapDays = input.overlapDays ?? 7;
  const overlapEnd = new Date(uow.clock.now().getTime() + overlapDays * 86_400_000);
  await sql`
    UPDATE iam.api_credential
       SET expires_at = least(expires_at, ${overlapEnd.toISOString()}::timestamptz)
     WHERE id = ${existing.id}::uuid
  `.execute(uow.tx);

  uow.emit(
    CredentialRotated,
    {
      principalId: existing.principal_id,
      credentialId: issued.credentialId,
      replacesCredentialId: credentialId,
      expiresAt: issued.expiresAt.toISOString(),
    },
    { aggregateId: existing.principal_id },
  );

  return issued;
}

export async function revokeCredential(
  uow: UnitOfWork,
  credentialId: string,
  reason: string,
): Promise<void> {
  if (reason.trim() === '') {
    throw new ValidationError('Revoking a credential needs a reason.');
  }
  await sql`
    UPDATE iam.api_credential
       SET revoked_at = now(), revoked_reason = ${reason}
     WHERE credential_id = ${credentialId} AND revoked_at IS NULL
  `.execute(uow.tx);
}

export interface AuthenticatedCredential {
  readonly principalId: string;
  readonly credentialId: string;
}

/**
 * Authenticate a presented secret.
 *
 * Every failure returns the same error. Distinguishing "no such credential" from "wrong
 * secret" from "expired" tells an attacker which of their guesses was structurally
 * right, and tells a legitimate caller nothing they can act on.
 */
export async function authenticateCredential(
  db: Database | DbTransaction,
  presented: string,
  now: Date,
): Promise<AuthenticatedCredential> {
  const failure = new UnauthenticatedError('The API credential is not valid.');

  const separator = presented.indexOf('.');
  if (separator <= 0) throw failure;
  const credentialId = presented.slice(0, separator);
  const secretPart = presented.slice(separator + 1);
  if (secretPart === '') throw failure;

  const found = await sql<{
    id: string;
    principal_id: string;
    secret_hash: string;
    expires_at: Date;
    revoked_at: Date | null;
    principal_active: boolean;
  }>`
    SELECT c.id, c.principal_id, c.secret_hash, c.expires_at, c.revoked_at,
           p.is_active AS principal_active
      FROM iam.api_credential c
      JOIN iam.principal p ON p.id = c.principal_id
     WHERE c.credential_id = ${credentialId}
  `.execute(db);

  const credential = found.rows[0];
  if (credential === undefined) {
    // Verify against a dummy hash anyway, so an unknown identifier does not return
    // measurably faster than a known one with a wrong secret.
    await argonVerify(DUMMY_HASH, secretPart).catch(() => false);
    throw failure;
  }

  const matches = await argonVerify(credential.secret_hash, secretPart).catch(
    () => false,
  );
  if (!matches) throw failure;
  if (credential.revoked_at !== null) throw failure;
  if (credential.expires_at.getTime() <= now.getTime()) throw failure;
  if (!credential.principal_active) throw failure;

  await sql`
    UPDATE iam.api_credential SET last_used_at = now() WHERE id = ${credential.id}::uuid
  `.execute(db);

  return { principalId: credential.principal_id, credentialId };
}

/**
 * A hash of a value nothing will ever present, so the unknown-identifier path does the
 * same work as the known one. Computed once at module load.
 */
const DUMMY_HASH = await argonHash(randomBytes(32).toString('base64url'), ARGON_OPTIONS);

export interface ExpiringCredential {
  readonly credentialId: string;
  readonly principalId: string;
  readonly label: string;
  readonly expiresAt: Date;
  readonly daysRemaining: number;
}

/**
 * Credentials worth warning about. Wired to a metric and an alert (ADR-0020).
 *
 * `now` is a parameter rather than `now()` in the query, for the same reason the rest
 * of this file takes an injected clock: a helper that reads the database clock while
 * the data was written from another one answers a question about neither.
 */
export async function expiringCredentials(
  db: Database | DbTransaction,
  now: Date,
  withinDays = EXPIRY_WARNING_DAYS,
): Promise<readonly ExpiringCredential[]> {
  const result = await sql<{
    credential_id: string;
    principal_id: string;
    label: string;
    expires_at: Date;
    days_remaining: number;
  }>`
    SELECT credential_id, principal_id, label, expires_at,
           ceil(extract(epoch FROM (expires_at - ${now.toISOString()}::timestamptz)) / 86400)::int
             AS days_remaining
      FROM iam.api_credential
     WHERE revoked_at IS NULL
       AND expires_at <= ${now.toISOString()}::timestamptz + make_interval(days => ${withinDays})
     ORDER BY expires_at
  `.execute(db);

  return result.rows.map((row) => ({
    credentialId: row.credential_id,
    principalId: row.principal_id,
    label: row.label,
    expiresAt: row.expires_at,
    daysRemaining: row.days_remaining,
  }));
}

/** Constant-time comparison, for callers comparing opaque identifiers. */
export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
