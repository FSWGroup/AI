/**
 * OIDC token validation and identity resolution (ADR-0020, spec §12).
 *
 * Layer 0 does not authenticate anyone. It verifies that somebody we trust already
 * did, and then answers "which of our people is that". No password is stored here, no
 * password can be reset here, and MFA is the identity provider's problem.
 *
 * The rule that shapes the whole file: **identity is (issuer, subject), never email**.
 * People change names, companies change domains, and addresses get reused by the next
 * employee. An email is recorded as a note of what the token said when the identity was
 * linked, and nothing ever looks a person up by it.
 */
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import { sql } from 'kysely';
import type { Database, DbTransaction } from '../../platform/db/index.js';
import type { UnitOfWork } from '../../kernel/unit-of-work.js';
import { UnauthenticatedError } from '../../platform/errors.js';
import { IdentityLinked, PersonRegistered, PendingLinkRequested } from './events.js';

export interface IssuerConfig {
  readonly id: string;
  readonly issuerUrl: string;
  readonly name: string;
  readonly jwksUri: string;
  readonly audiences: readonly string[];
  readonly allowedTenantIds: readonly string[];
  readonly jitEnabled: boolean;
  readonly jitEmailDomains: readonly string[];
  readonly defaultOperatingCompany: string | undefined;
  readonly clockSkewSeconds: number;
}

export async function loadIssuers(
  db: Database | DbTransaction,
): Promise<readonly IssuerConfig[]> {
  const result = await sql<{
    id: string;
    issuer_url: string;
    name: string;
    jwks_uri: string;
    audiences: string[];
    allowed_tenant_ids: string[];
    jit_enabled: boolean;
    jit_email_domains: string[];
    default_operating_company: string | null;
    clock_skew_seconds: number;
  }>`
    SELECT id, issuer_url, name, jwks_uri, audiences, allowed_tenant_ids, jit_enabled,
           jit_email_domains, default_operating_company, clock_skew_seconds
      FROM iam.issuer WHERE is_active
  `.execute(db);

  return result.rows.map((row) => ({
    id: row.id,
    issuerUrl: row.issuer_url,
    name: row.name,
    jwksUri: row.jwks_uri,
    audiences: row.audiences,
    allowedTenantIds: row.allowed_tenant_ids,
    jitEnabled: row.jit_enabled,
    jitEmailDomains: row.jit_email_domains,
    defaultOperatingCompany: row.default_operating_company ?? undefined,
    clockSkewSeconds: row.clock_skew_seconds,
  }));
}

/**
 * Validate an issuer's configuration before it can be used.
 *
 * Called at startup and whenever an issuer is written. JIT provisioning with no domain
 * allow-list means "create a person for anyone this issuer will sign a token for",
 * which is not a configuration anybody intends; refusing it at startup beats
 * discovering it when a contractor's personal tenant appears in the directory.
 */
export function assertIssuerUsable(issuer: IssuerConfig): void {
  const problems: string[] = [];
  if (issuer.audiences.length === 0) {
    problems.push('no audiences are configured, so no token could be accepted');
  }
  if (issuer.jitEnabled && issuer.jitEmailDomains.length === 0) {
    problems.push(
      'just-in-time provisioning is enabled with no email-domain allow-list, which ' +
        'means anyone this issuer will sign for becomes a person here',
    );
  }
  if (issuer.jitEnabled && issuer.defaultOperatingCompany === undefined) {
    problems.push(
      'just-in-time provisioning is enabled with no default operating company, so a ' +
        'provisioned person would belong to no business',
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `Issuer '${issuer.name}' (${issuer.issuerUrl}) cannot be used: ${problems.join('; ')}.`,
    );
  }
}

/** Claims we require and understand. Everything else in the token is ignored. */
export interface VerifiedToken {
  readonly issuer: IssuerConfig;
  readonly subject: string;
  readonly tenantId: string | undefined;
  readonly email: string | undefined;
  readonly emailVerified: boolean;
  readonly displayName: string | undefined;
  readonly expiresAt: Date;
}

/** How JWKS is fetched. Injected so tests need no network (ADR-0029). */
export type KeyResolver = (issuer: IssuerConfig) => JWTVerifyGetKey;

const remoteKeyCache = new Map<string, JWTVerifyGetKey>();

export const remoteKeyResolver: KeyResolver = (issuer) => {
  const cached = remoteKeyCache.get(issuer.jwksUri);
  if (cached !== undefined) return cached;
  // jose caches the key set and re-fetches on an unknown `kid`, which is what makes
  // issuer key rotation a non-event.
  const jwks = createRemoteJWKSet(new URL(issuer.jwksUri));
  remoteKeyCache.set(issuer.jwksUri, jwks);
  return jwks;
};

/**
 * Verify a bearer token against a registered issuer.
 *
 * No token is trusted because it parses. Signature, issuer, audience, expiry and
 * not-before are all checked, and the tenant is checked against the issuer's allow-list
 * — a valid Entra token from somebody else's tenant is a valid token that is not for us.
 */
export async function verifyToken(
  rawToken: string,
  issuers: readonly IssuerConfig[],
  resolveKeys: KeyResolver = remoteKeyResolver,
): Promise<VerifiedToken> {
  if (rawToken.trim() === '') {
    throw new UnauthenticatedError('No bearer token was supplied.');
  }

  // The issuer is read from the unverified claims only to SELECT which key set to
  // verify against. Nothing else is taken from an unverified token.
  const claimedIssuer = unverifiedIssuer(rawToken);
  const issuer = issuers.find((candidate) => candidate.issuerUrl === claimedIssuer);
  if (issuer === undefined) {
    throw new UnauthenticatedError(
      `Token was issued by '${claimedIssuer ?? 'an unstated issuer'}', which is not a ` +
        `registered issuer.`,
    );
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(rawToken, resolveKeys(issuer), {
      issuer: issuer.issuerUrl,
      audience: [...issuer.audiences],
      clockTolerance: issuer.clockSkewSeconds,
    }));
  } catch (error) {
    // The reason is deliberately not passed to the caller: "signature invalid" versus
    // "expired" is a useful oracle to someone probing, and useless to a legitimate
    // client, who should simply reauthenticate (§62). The underlying error is logged
    // by the caller's error handler, where an operator can see it and an attacker
    // cannot.
    const refusal = new UnauthenticatedError('The bearer token could not be verified.');
    // The underlying reason is attached as a cause, so an operator reading the log can
    // see it, and never reaches the response body.
    refusal.cause = error;
    throw refusal;
  }

  const subject = payload.sub;
  if (typeof subject !== 'string' || subject === '') {
    throw new UnauthenticatedError(
      'The token carries no subject claim, so it identifies nobody.',
    );
  }

  const tenantId = stringClaim(payload, 'tid') ?? stringClaim(payload, 'hd');
  if (
    issuer.allowedTenantIds.length > 0 &&
    (tenantId === undefined || !issuer.allowedTenantIds.includes(tenantId))
  ) {
    throw new UnauthenticatedError(
      `The token is from tenant '${tenantId ?? 'none'}', which this issuer is not ` +
        `trusted for.`,
    );
  }

  return {
    issuer,
    subject,
    tenantId,
    email: stringClaim(payload, 'email') ?? stringClaim(payload, 'preferred_username'),
    emailVerified: payload['email_verified'] === true,
    displayName: stringClaim(payload, 'name'),
    expiresAt: new Date((payload.exp ?? 0) * 1000),
  };
}

function unverifiedIssuer(rawToken: string): string | undefined {
  const parts = rawToken.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const claims = JSON.parse(
      Buffer.from(parts[1]!, 'base64url').toString('utf8'),
    ) as unknown;
    if (typeof claims !== 'object' || claims === null) return undefined;
    const iss = (claims as Record<string, unknown>)['iss'];
    return typeof iss === 'string' ? iss : undefined;
  } catch {
    return undefined;
  }
}

function stringClaim(payload: JWTPayload, name: string): string | undefined {
  const value = payload[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export type ResolutionOutcome =
  | { readonly kind: 'RESOLVED'; readonly personId: string; readonly principalId: string }
  | {
      readonly kind: 'PROVISIONED';
      readonly personId: string;
      readonly principalId: string;
    }
  | { readonly kind: 'PENDING'; readonly requestId: string; readonly reason: string };

/**
 * Turn a verified token into one of our people.
 *
 * Three outcomes, and the third is the one worth having: a first authentication that
 * cannot be provisioned raises a pending link request rather than failing silently.
 * The alternative produces a support ticket that says "it doesn't work" and contains
 * nothing an administrator can act on.
 */
export async function resolveIdentity(
  uow: UnitOfWork,
  token: VerifiedToken,
): Promise<ResolutionOutcome> {
  const existing = await sql<{
    person_id: string;
    identity_id: string;
    disabled_at: Date | null;
  }>`
    SELECT id AS identity_id, person_id, disabled_at FROM iam.identity
     WHERE issuer_id = ${token.issuer.id}::uuid AND subject = ${token.subject}
  `.execute(uow.tx);

  const identity = existing.rows[0];
  if (identity !== undefined) {
    if (identity.disabled_at !== null) {
      throw new UnauthenticatedError('This identity has been disabled.');
    }
    await sql`
      UPDATE iam.identity SET last_seen_at = now() WHERE id = ${identity.identity_id}::uuid
    `.execute(uow.tx);

    const principalId = await principalForPerson(uow, identity.person_id);
    return { kind: 'RESOLVED', personId: identity.person_id, principalId };
  }

  const refusal = jitRefusalReason(token);
  if (refusal !== undefined) {
    const requestId = await raisePendingLink(uow, token, refusal);
    return { kind: 'PENDING', requestId, reason: refusal };
  }

  // JIT provisioning. The new person gets NO roles: authentication is not
  // authorization, and a person who can log in and see nothing is a far better outcome
  // than one who can log in and see everything (ADR-0020).
  const personId = uow.ids.next();
  const displayName = token.displayName ?? token.email ?? token.subject;
  await sql`
    INSERT INTO party.person (id, display_name, email, email_normalized, created_by)
    VALUES (${personId}, ${displayName}, ${token.email ?? null},
            ${token.email?.toLowerCase() ?? null},
            ${uow.context.actor.principalId ?? null}::uuid)
  `.execute(uow.tx);

  const principalId = uow.ids.next();
  await sql`
    INSERT INTO iam.principal (id, principal_type, person_id, label, created_by)
    VALUES (${principalId}, 'PERSON', ${personId}::uuid, ${displayName},
            ${uow.context.actor.principalId ?? null}::uuid)
  `.execute(uow.tx);

  await linkIdentity(uow, personId, token);

  uow.audit({
    schema: 'party',
    table: 'person',
    entityId: personId,
    operation: 'INSERT',
    after: { id: personId, display_name: displayName },
    reason: `Provisioned on first authentication from ${token.issuer.name}.`,
  });

  uow.emit(
    PersonRegistered,
    {
      personId,
      principalId,
      issuerId: token.issuer.id,
      provisioning: 'JIT',
    },
    { aggregateId: personId },
  );

  return { kind: 'PROVISIONED', personId, principalId };
}

/**
 * Why this token cannot mint a person, or undefined if it can.
 *
 * Every branch here is a deliberate refusal. An unverified email is the subtle one: an
 * issuer that lets a user set an arbitrary unverified address would otherwise let them
 * choose their own way past the domain allow-list.
 */
function jitRefusalReason(token: VerifiedToken): string | undefined {
  if (!token.issuer.jitEnabled) {
    return `Issuer '${token.issuer.name}' does not allow automatic provisioning.`;
  }
  if (token.email === undefined) {
    return 'The token carries no email claim, so no domain could be checked.';
  }
  if (!token.emailVerified) {
    return (
      `The email '${token.email}' is not marked verified by the issuer. An unverified ` +
      `address is a value the user chose, not one the directory vouches for.`
    );
  }
  const domain = token.email.slice(token.email.lastIndexOf('@') + 1).toLowerCase();
  if (!token.issuer.jitEmailDomains.map((d) => d.toLowerCase()).includes(domain)) {
    return `The domain '${domain}' is not on this issuer's allow-list.`;
  }
  return undefined;
}

async function raisePendingLink(
  uow: UnitOfWork,
  token: VerifiedToken,
  reason: string,
): Promise<string> {
  const id = uow.ids.next();
  const result = await sql<{ id: string; inserted: boolean }>`
    INSERT INTO iam.pending_link_request
      (id, issuer_id, subject, tenant_id, email_claimed, display_name_claimed,
       email_verified, reason)
    VALUES (${id}, ${token.issuer.id}::uuid, ${token.subject}, ${token.tenantId ?? null},
            ${token.email ?? null}, ${token.displayName ?? null}, ${token.emailVerified},
            ${reason})
    ON CONFLICT (issuer_id, subject) DO UPDATE
      SET last_seen_at = now(),
          attempt_count = iam.pending_link_request.attempt_count + 1,
          reason = EXCLUDED.reason
    RETURNING id, (xmax = 0) AS inserted
  `.execute(uow.tx);

  const row = result.rows[0]!;
  if (row.inserted) {
    uow.emit(
      PendingLinkRequested,
      { requestId: row.id, issuerId: token.issuer.id },
      { aggregateId: row.id },
    );
  }
  return row.id;
}

/** Attach another issuer's identity to a person who already exists. */
export async function linkIdentity(
  uow: UnitOfWork,
  personId: string,
  token: VerifiedToken,
): Promise<string> {
  const id = uow.ids.next();
  await sql`
    INSERT INTO iam.identity
      (id, person_id, issuer_id, subject, tenant_id, email_at_link,
       display_name_at_link, linked_by, last_seen_at)
    VALUES (${id}, ${personId}::uuid, ${token.issuer.id}::uuid, ${token.subject},
            ${token.tenantId ?? null}, ${token.email ?? null}, ${token.displayName ?? null},
            ${uow.context.actor.principalId ?? null}::uuid, now())
  `.execute(uow.tx);

  uow.emit(
    IdentityLinked,
    { identityId: id, personId, issuerId: token.issuer.id },
    { aggregateId: personId },
  );

  return id;
}

async function principalForPerson(uow: UnitOfWork, personId: string): Promise<string> {
  const found = await sql<{ id: string }>`
    SELECT id FROM iam.principal WHERE person_id = ${personId}::uuid
  `.execute(uow.tx);
  const existing = found.rows[0];
  if (existing !== undefined) return existing.id;

  // A person with no principal is a person administrative provisioning created without
  // one. Creating it here rather than failing keeps the login working; it grants
  // nothing, because roles are assigned separately.
  const id = uow.ids.next();
  const name = await sql<{ display_name: string }>`
    SELECT display_name FROM party.person WHERE id = ${personId}::uuid
  `.execute(uow.tx);
  await sql`
    INSERT INTO iam.principal (id, principal_type, person_id, label)
    VALUES (${id}, 'PERSON', ${personId}::uuid, ${name.rows[0]?.display_name ?? 'unknown'})
  `.execute(uow.tx);
  return id;
}
