/**
 * The authorization decision point (ADR-0019, spec §13).
 *
 * One place decides. Not one place per module, not one helper per route — one
 * function, so that "may this principal do this?" has a single answer and a single
 * place to read when someone asks why.
 *
 * Two things this file insists on, both because the alternative fails quietly:
 *
 *   * **Default deny.** An unknown permission, an unknown scope, an inactive
 *     principal, an expired assignment — all denials. There is no path through this
 *     code that returns allowed because it ran out of reasons to refuse.
 *   * **Function-level permission is never enough.** Holding `account.read` says
 *     nothing about WHICH accounts. Every scoped read carries a scope predicate, and
 *     an out-of-scope row is not refused — it is not returned. That distinction is
 *     acceptance criterion 2.
 */
import { sql } from 'kysely';
import type { Database, DbTransaction } from '../../platform/db/index.js';

export type ScopeType = 'FSW_GROUP' | 'OPERATING_COMPANY' | 'DOMAIN';

export interface Scope {
  readonly type: ScopeType;
  /** The operating-company code or domain name. Absent for FSW_GROUP. */
  readonly id?: string | undefined;
}

export interface GrantedPermission {
  readonly permissionKey: string;
  readonly scopes: readonly Scope[];
}

/**
 * Everything the decision point needs about a caller, resolved once per request.
 *
 * Deliberately a value rather than a database handle: an authorization decision that
 * can issue queries is one that can behave differently under load, and a decision that
 * varies with timing is not one anybody can reason about.
 */
export interface PrincipalContext {
  readonly principalId: string;
  readonly principalType: 'PERSON' | 'SERVICE';
  readonly personId: string | undefined;
  readonly label: string;
  readonly isActive: boolean;
  readonly permissions: ReadonlyMap<string, readonly Scope[]>;
  /** Operating companies this principal can see anything in. Empty means none. */
  readonly operatingCompanies: readonly string[];
  readonly hasGroupScope: boolean;
}

export type DecisionOutcome = 'ALLOW' | 'DENY';

export interface Decision {
  readonly outcome: DecisionOutcome;
  /** Why, in terms someone can act on. Present on every decision, not just denials. */
  readonly reason: string;
  readonly permissionKey: string;
  readonly scope: Scope | undefined;
}

export function allowed(decision: Decision): boolean {
  return decision.outcome === 'ALLOW';
}

/**
 * Does a grant at `granted` cover a request for `requested`?
 *
 * FSW_GROUP covers everything, which is the whole point of a group scope. Everything
 * else must match exactly: an OPERATING_COMPANY grant for WELSFORD does not cover
 * VALVEMAN, and a DOMAIN grant covers nothing but itself.
 */
export function scopeCovers(granted: Scope, requested: Scope | undefined): boolean {
  if (granted.type === 'FSW_GROUP') return true;
  if (requested === undefined) {
    // An unscoped request against a scoped grant. Refused: "read accounts" with no
    // company named, held only for ValveMan, must not silently mean "read all
    // accounts". The caller says which company, or brings a group grant.
    return false;
  }
  if (granted.type !== requested.type) return false;
  return granted.id === requested.id;
}

/**
 * The decision.
 *
 * `scope` undefined means the caller is asking about an unscoped operation — reading
 * the metadata catalogue, say. That is answered by a group-scoped grant, and refused
 * for a grant confined to one company.
 */
export function decide(
  principal: PrincipalContext,
  permissionKey: string,
  scope?: Scope,
): Decision {
  const where = scope === undefined ? 'unscoped' : `${scope.type}:${scope.id ?? '*'}`;

  if (!principal.isActive) {
    return {
      outcome: 'DENY',
      reason: `Principal ${principal.principalId} is not active.`,
      permissionKey,
      scope,
    };
  }

  const grants = principal.permissions.get(permissionKey);
  if (grants === undefined || grants.length === 0) {
    return {
      outcome: 'DENY',
      reason: `No role held by this principal grants '${permissionKey}'.`,
      permissionKey,
      scope,
    };
  }

  const covering = grants.find((granted) => scopeCovers(granted, scope));
  if (covering === undefined) {
    const held = grants.map((g) => `${g.type}:${g.id ?? '*'}`).join(', ');
    return {
      outcome: 'DENY',
      reason:
        `'${permissionKey}' is held for ${held}, which does not cover ${where}. ` +
        `The permission exists; the scope does not.`,
      permissionKey,
      scope,
    };
  }

  return {
    outcome: 'ALLOW',
    reason: `'${permissionKey}' granted at ${covering.type}:${covering.id ?? '*'}.`,
    permissionKey,
    scope,
  };
}

/**
 * The scope predicate a repository must apply to a scoped read.
 *
 * Returned as a value rather than applied by convention, so that a query which forgot
 * it is visibly different from one that did not — and so the architecture test can
 * tell them apart. `all` means the principal sees every company; `none` means it sees
 * nothing and the query should return no rows rather than erroring, because "you have
 * no accounts" is a legitimate state and an error is not.
 */
export interface ScopeFilter {
  readonly kind: 'all' | 'companies' | 'none';
  readonly operatingCompanies: readonly string[];
  readonly principalId: string;
}

export function scopeFilterFor(
  principal: PrincipalContext,
  permissionKey: string,
): ScopeFilter {
  if (!principal.isActive) {
    return { kind: 'none', operatingCompanies: [], principalId: principal.principalId };
  }

  const grants = principal.permissions.get(permissionKey) ?? [];
  if (grants.some((grant) => grant.type === 'FSW_GROUP')) {
    return { kind: 'all', operatingCompanies: [], principalId: principal.principalId };
  }

  const companies = [
    ...new Set(
      grants
        .filter((grant) => grant.type === 'OPERATING_COMPANY' && grant.id !== undefined)
        .map((grant) => grant.id!),
    ),
  ].sort();

  if (companies.length === 0) {
    return { kind: 'none', operatingCompanies: [], principalId: principal.principalId };
  }
  return {
    kind: 'companies',
    operatingCompanies: companies,
    principalId: principal.principalId,
  };
}

/**
 * Load a principal's full authorization context.
 *
 * One query per request, cached by the caller for the life of that request and no
 * longer. A longer cache would mean a revocation that does not take effect, and
 * "revoked but still working" is the failure nobody forgives.
 */
export async function loadPrincipalContext(
  db: Database | DbTransaction,
  principalId: string,
): Promise<PrincipalContext | undefined> {
  const principalRows = await sql<{
    id: string;
    principal_type: 'PERSON' | 'SERVICE';
    person_id: string | null;
    label: string;
    is_active: boolean;
  }>`
    SELECT id, principal_type, person_id, label, is_active
      FROM iam.principal WHERE id = ${principalId}::uuid
  `.execute(db);
  const row = principalRows.rows[0];
  if (row === undefined) return undefined;

  const grantRows = await sql<{
    permission_key: string;
    scope_type: ScopeType;
    scope_id: string | null;
  }>`
    SELECT DISTINCT rp.permission_key, a.scope_type, a.scope_id
      FROM iam.principal_role_assignment a
      JOIN iam.role r ON r.key = a.role_key AND r.is_active
      JOIN iam.role_permission rp ON rp.role_key = a.role_key
      JOIN iam.permission p ON p.key = rp.permission_key AND p.is_active
     WHERE a.principal_id = ${principalId}::uuid
       AND a.revoked_at IS NULL
       AND (a.expires_at IS NULL OR a.expires_at > now())
  `.execute(db);

  const permissions = new Map<string, Scope[]>();
  for (const grant of grantRows.rows) {
    const scope: Scope = { type: grant.scope_type, id: grant.scope_id ?? undefined };
    const existing = permissions.get(grant.permission_key);
    if (existing === undefined) permissions.set(grant.permission_key, [scope]);
    else existing.push(scope);
  }

  const companies = [
    ...new Set(
      grantRows.rows
        .filter(
          (grant) => grant.scope_type === 'OPERATING_COMPANY' && grant.scope_id !== null,
        )
        .map((grant) => grant.scope_id!),
    ),
  ].sort();

  return {
    principalId: row.id,
    principalType: row.principal_type,
    personId: row.person_id ?? undefined,
    label: row.label,
    isActive: row.is_active,
    permissions,
    operatingCompanies: companies,
    hasGroupScope: grantRows.rows.some((grant) => grant.scope_type === 'FSW_GROUP'),
  };
}
