/**
 * Principal and role administration (ADR-0019).
 *
 * Everything here is a grant or a withdrawal of access, so everything here is audited
 * and carries a reason. "Who gave this person account.merge, and why" must have an
 * answer, and the answer must not be "look at the git history of a config file".
 */
import { sql } from 'kysely';
import type { Database, DbTransaction } from '../../platform/db/index.js';
import type { UnitOfWork } from '../../kernel/unit-of-work.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import type { Scope, ScopeType } from './authorization.js';
import {
  PrincipalRoleAssigned,
  PrincipalRoleRevoked,
  ServiceAccountCreated,
  PersonRegistered,
} from './events.js';

export interface CreatePersonPrincipalInput {
  readonly personId: string;
  readonly label: string;
}

export async function createPersonPrincipal(
  uow: UnitOfWork,
  input: CreatePersonPrincipalInput,
): Promise<string> {
  const id = uow.ids.next();
  await sql`
    INSERT INTO iam.principal (id, principal_type, person_id, label, created_by)
    VALUES (${id}, 'PERSON', ${input.personId}::uuid, ${input.label},
            ${uow.context.actor.principalId ?? null}::uuid)
  `.execute(uow.tx);

  uow.audit({
    schema: 'iam',
    table: 'principal',
    entityId: id,
    operation: 'INSERT',
    after: { id, principal_type: 'PERSON', person_id: input.personId },
  });

  uow.emit(
    PersonRegistered,
    {
      personId: input.personId,
      principalId: id,
      issuerId: null,
      provisioning: 'ADMINISTRATIVE',
    },
    { aggregateId: input.personId },
  );

  return id;
}

export interface CreateServiceAccountInput {
  readonly key: string;
  readonly description: string;
  /** Who to ask when it misbehaves. Required: an unowned service account is one
   * nobody dares disable. */
  readonly ownerNote: string;
}

export async function createServiceAccount(
  uow: UnitOfWork,
  input: CreateServiceAccountInput,
): Promise<{ principalId: string; serviceAccountId: string }> {
  if (input.ownerNote.trim() === '') {
    throw new ValidationError(
      'A service account needs a named owner. One without becomes a mystery nobody ' +
        'dares disable, which is how expired credentials turn into outages.',
    );
  }

  const principalId = uow.ids.next();
  await sql`
    INSERT INTO iam.principal (id, principal_type, label, created_by)
    VALUES (${principalId}, 'SERVICE', ${input.key},
            ${uow.context.actor.principalId ?? null}::uuid)
  `.execute(uow.tx);

  const serviceAccountId = uow.ids.next();
  await sql`
    INSERT INTO iam.service_account (id, principal_id, key, description, owner_note)
    VALUES (${serviceAccountId}, ${principalId}::uuid, ${input.key}, ${input.description},
            ${input.ownerNote})
  `.execute(uow.tx);

  uow.audit({
    schema: 'iam',
    table: 'service_account',
    entityId: serviceAccountId,
    operation: 'INSERT',
    after: { id: serviceAccountId, key: input.key, owner_note: input.ownerNote },
  });

  uow.emit(
    ServiceAccountCreated,
    { principalId, serviceAccountId, key: input.key },
    { aggregateId: principalId },
  );

  return { principalId, serviceAccountId };
}

export interface AssignRoleInput {
  readonly principalId: string;
  readonly roleKey: string;
  readonly scopeType: ScopeType;
  readonly scopeId?: string | undefined;
  readonly reason: string;
  /** Access reviews expire assignments rather than trusting anyone to remember. */
  readonly expiresAt?: Date | undefined;
}

export async function assignRole(
  uow: UnitOfWork,
  input: AssignRoleInput,
): Promise<string> {
  if (input.reason.trim() === '') {
    throw new ValidationError(
      'A role assignment needs a reason. "Why does this person have this access" is ' +
        'the first question of every access review.',
    );
  }

  const roleRow = await sql<{ is_company_scoped: boolean }>`
    SELECT is_company_scoped FROM iam.role WHERE key = ${input.roleKey} AND is_active
  `.execute(uow.tx);
  const role = roleRow.rows[0];
  if (role === undefined) {
    throw new ValidationError(
      `'${input.roleKey}' is not an active role. Roles are data: add it to iam.role ` +
        `rather than inventing one at the call site.`,
    );
  }

  if (input.scopeType === 'FSW_GROUP' && input.scopeId !== undefined) {
    throw new ValidationError(
      'A group-wide assignment does not name a scope identifier.',
    );
  }
  if (input.scopeType !== 'FSW_GROUP' && (input.scopeId ?? '') === '') {
    throw new ValidationError(
      `A ${input.scopeType} assignment must say which one. An unscoped scope is a ` +
        `group grant written by accident.`,
    );
  }
  if (role.is_company_scoped && input.scopeType === 'FSW_GROUP') {
    throw new ValidationError(
      `The '${input.roleKey}' role is company-scoped and cannot be granted group-wide. ` +
        `Grant it per operating company, so that widening someone's access is a ` +
        `visible act rather than a default.`,
    );
  }
  if (input.scopeType === 'OPERATING_COMPANY') {
    const company = await sql`
      SELECT 1 FROM kernel.operating_company WHERE code = ${input.scopeId ?? null} AND is_active
    `.execute(uow.tx);
    if (company.rows.length === 0) {
      throw new ValidationError(`'${input.scopeId}' is not an active operating company.`);
    }
  }

  const id = uow.ids.next();
  const inserted = await sql<{ id: string }>`
    INSERT INTO iam.principal_role_assignment
      (id, principal_id, role_key, scope_type, scope_id, granted_by, granted_reason,
       expires_at)
    VALUES (${id}, ${input.principalId}::uuid, ${input.roleKey}, ${input.scopeType},
            ${input.scopeId ?? null}, ${uow.context.actor.principalId ?? null}::uuid,
            ${input.reason}, ${input.expiresAt?.toISOString() ?? null}::timestamptz)
    ON CONFLICT DO NOTHING
    RETURNING id
  `.execute(uow.tx);

  if (inserted.rows.length === 0) {
    throw new ConflictError(
      `This principal already holds '${input.roleKey}' in that scope.`,
    );
  }

  uow.audit({
    schema: 'iam',
    table: 'principal_role_assignment',
    entityId: id,
    operation: 'INSERT',
    after: {
      principal_id: input.principalId,
      role_key: input.roleKey,
      scope_type: input.scopeType,
      scope_id: input.scopeId ?? null,
    },
    reason: input.reason,
  });

  uow.emit(
    PrincipalRoleAssigned,
    {
      principalId: input.principalId,
      roleKey: input.roleKey,
      scopeType: input.scopeType,
      scopeId: input.scopeId ?? null,
    },
    { aggregateId: input.principalId },
  );

  return id;
}

export async function revokeRole(
  uow: UnitOfWork,
  assignmentId: string,
  reason: string,
): Promise<void> {
  if (reason.trim() === '') {
    throw new ValidationError('Revoking access needs a reason.');
  }

  const result = await sql<{
    principal_id: string;
    role_key: string;
    scope_type: ScopeType;
    scope_id: string | null;
  }>`
    UPDATE iam.principal_role_assignment
       SET revoked_at = now(), revoked_by = ${uow.context.actor.principalId ?? null}::uuid,
           revoked_reason = ${reason}
     WHERE id = ${assignmentId}::uuid AND revoked_at IS NULL
    RETURNING principal_id, role_key, scope_type, scope_id
  `.execute(uow.tx);

  const revoked = result.rows[0];
  if (revoked === undefined) {
    throw new NotFoundError('role assignment', assignmentId);
  }

  uow.audit({
    schema: 'iam',
    table: 'principal_role_assignment',
    entityId: assignmentId,
    operation: 'DELETE',
    before: { role_key: revoked.role_key, scope_type: revoked.scope_type },
    reason,
  });

  uow.emit(
    PrincipalRoleRevoked,
    {
      principalId: revoked.principal_id,
      roleKey: revoked.role_key,
      scopeType: revoked.scope_type,
      scopeId: revoked.scope_id,
    },
    { aggregateId: revoked.principal_id },
  );
}

export interface DenialRecord {
  readonly principalId?: string | undefined;
  readonly attemptedSubject?: string | undefined;
  readonly permissionKey?: string | undefined;
  readonly scope?: Scope | undefined;
  readonly resourceKind?: string | undefined;
  readonly resourceId?: string | undefined;
  readonly reason: string;
}

/**
 * Record a refusal.
 *
 * Written outside any unit of work on purpose: a denial usually happens because a
 * transaction is about to be refused, and a record that rolls back with the thing it
 * was recording is not a record.
 */
export async function recordDenial(
  db: Database | DbTransaction,
  context: {
    interface: string;
    correlationId: string;
    clientIp?: string | undefined;
  },
  denial: DenialRecord,
): Promise<void> {
  await sql`
    INSERT INTO iam.access_denial
      (principal_id, attempted_subject, permission_key, scope_type, scope_id,
       resource_kind, resource_id, reason, interface, correlation_id, client_ip)
    VALUES (${denial.principalId ?? null}::uuid, ${denial.attemptedSubject ?? null},
            ${denial.permissionKey ?? null}, ${denial.scope?.type ?? null},
            ${denial.scope?.id ?? null}, ${denial.resourceKind ?? null},
            ${denial.resourceId ?? null}, ${denial.reason}, ${context.interface},
            ${context.correlationId}::uuid, ${context.clientIp ?? null}::inet)
  `.execute(db);
}

export interface PrincipalSummary {
  readonly principalId: string;
  readonly principalType: 'PERSON' | 'SERVICE';
  readonly personId: string | undefined;
  readonly label: string;
  readonly roles: readonly {
    roleKey: string;
    scopeType: ScopeType;
    scopeId: string | undefined;
  }[];
  readonly permissions: readonly string[];
  readonly operatingCompanies: readonly string[];
}

/**
 * What `GET /v1/me` returns: the caller's canonical person, principal, roles,
 * permissions and scopes in one call.
 *
 * One call is the point. A consuming application bootstraps from this and enforces
 * locally, rather than asking Layer 0 for a decision on every read — which would make
 * Layer 0 a hard availability dependency for every future application (ADR-0019).
 */
export async function describePrincipal(
  db: Database | DbTransaction,
  principalId: string,
): Promise<PrincipalSummary> {
  const principalRows = await sql<{
    id: string;
    principal_type: 'PERSON' | 'SERVICE';
    person_id: string | null;
    label: string;
  }>`
    SELECT id, principal_type, person_id, label FROM iam.principal
     WHERE id = ${principalId}::uuid
  `.execute(db);
  const principal = principalRows.rows[0];
  if (principal === undefined) throw new NotFoundError('principal', principalId);

  const assignments = await sql<{
    role_key: string;
    scope_type: ScopeType;
    scope_id: string | null;
  }>`
    SELECT role_key, scope_type, scope_id FROM iam.principal_role_assignment
     WHERE principal_id = ${principalId}::uuid AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY role_key, scope_id NULLS FIRST
  `.execute(db);

  const permissionRows = await sql<{ permission_key: string }>`
    SELECT DISTINCT rp.permission_key
      FROM iam.principal_role_assignment a
      JOIN iam.role_permission rp ON rp.role_key = a.role_key
      JOIN iam.permission p ON p.key = rp.permission_key AND p.is_active
     WHERE a.principal_id = ${principalId}::uuid AND a.revoked_at IS NULL
       AND (a.expires_at IS NULL OR a.expires_at > now())
     ORDER BY rp.permission_key
  `.execute(db);

  return {
    principalId: principal.id,
    principalType: principal.principal_type,
    personId: principal.person_id ?? undefined,
    label: principal.label,
    roles: assignments.rows.map((row) => ({
      roleKey: row.role_key,
      scopeType: row.scope_type,
      scopeId: row.scope_id ?? undefined,
    })),
    permissions: permissionRows.rows.map((row) => row.permission_key),
    operatingCompanies: [
      ...new Set(
        assignments.rows
          .filter(
            (row) => row.scope_type === 'OPERATING_COMPANY' && row.scope_id !== null,
          )
          .map((row) => row.scope_id!),
      ),
    ].sort(),
  };
}
