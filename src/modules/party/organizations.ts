/**
 * The organization service: the one place an organization changes.
 *
 * Every write does the whole job in one transaction — candidates, survivorship,
 * materialization, audit and events — because doing part of it produces a record that
 * disagrees with its own provenance.
 *
 * Note what is NOT here: no function that sets `legal_name`. There is no such
 * function anywhere. A name changes because a source asserted a name and survivorship
 * chose it (ADR-0011).
 */
import { sql } from 'kysely';
import type { Database, DbTransaction } from '../../platform/db/index.js';
import type { UnitOfWork } from '../../kernel/unit-of-work.js';
import {
  ConflictError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../platform/errors.js';
import { loadFieldRegistry, type FieldRegistry } from './fields.js';
import { assertCandidates, type CandidateInput } from './candidates.js';
import {
  evaluateFields,
  loadSurvivorshipDeps,
  type SurvivorshipDeps,
} from './survivorship.js';
import {
  OrganizationCreated,
  OrganizationFieldValueChanged,
  OrganizationRelationshipChanged,
  OrganizationRoleGranted,
} from './events.js';

export interface PartyDeps {
  readonly fields: FieldRegistry;
  readonly survivorship: SurvivorshipDeps;
}

/**
 * Load what a party operation needs. Per unit of work rather than cached
 * process-wide: a rule change must take effect on the next write, not on the next
 * deployment.
 */
export async function loadPartyDeps(tx: DbTransaction): Promise<PartyDeps> {
  const fields = await loadFieldRegistry(tx);
  return { fields, survivorship: await loadSurvivorshipDeps(tx, fields) };
}

export interface CreateOrganizationInput {
  /**
   * What the source says the organization is called. Written as a candidate like
   * every other field — the parameter exists because an organization row needs a
   * non-null legal_name to exist at all, not because it is authored.
   */
  readonly legalName: string;
  readonly sourceSystemCode: string;
  readonly sourceRecordId?: string | undefined;
  readonly organizationType?: string;
  readonly confidence?: 'UNCONFIRMED' | 'PROBABLE' | 'CONFIRMED';
  readonly fields?: readonly CandidateInput[];
  readonly roles?: readonly OrganizationRoleInput[];
  /** Required when the source system is MANUAL. */
  readonly reason?: string | undefined;
}

export interface OrganizationRoleInput {
  readonly roleCode: string;
  readonly operatingCompany?: string | undefined;
  readonly validFrom?: string | undefined;
}

export async function createOrganization(
  uow: UnitOfWork,
  deps: PartyDeps,
  input: CreateOrganizationInput,
): Promise<string> {
  if (input.legalName.trim() === '') {
    throw new ValidationError('An organization needs a name to be created with.');
  }

  const id = uow.ids.next();

  // The row is created with the asserted name in place so the NOT NULL column holds,
  // then immediately re-derived from candidates. After the evaluation below, the
  // column is a survivorship output like any other — including in the case where a
  // second source disagrees on the very next import.
  await sql`
    INSERT INTO party.organization
      (id, legal_name, organization_type, confidence, created_by, updated_by)
    VALUES (${id}, ${input.legalName}, ${input.organizationType ?? 'COMPANY'},
            ${input.confidence ?? 'UNCONFIRMED'},
            ${uow.context.actor.principalId ?? null}::uuid,
            ${uow.context.actor.principalId ?? null}::uuid)
  `.execute(uow.tx);

  const candidates: CandidateInput[] = [
    {
      fieldKey: 'legal_name',
      value: input.legalName,
      sourceSystemCode: input.sourceSystemCode,
      sourceRecordId: input.sourceRecordId,
      reason: input.reason,
    },
    ...(input.organizationType === undefined
      ? []
      : [
          {
            fieldKey: 'organization_type',
            value: input.organizationType,
            sourceSystemCode: input.sourceSystemCode,
            sourceRecordId: input.sourceRecordId,
            reason: input.reason,
          },
        ]),
    ...(input.fields ?? []),
  ];

  const touched = await assertCandidates(
    uow,
    deps.fields,
    'ORGANIZATION',
    id,
    candidates,
  );
  await evaluateFields(uow, deps.survivorship, 'ORGANIZATION', id, touched);

  uow.audit({
    schema: 'party',
    table: 'organization',
    entityId: id,
    operation: 'INSERT',
    after: {
      id,
      legal_name: input.legalName,
      confidence: input.confidence ?? 'UNCONFIRMED',
    },
  });

  uow.emit(
    OrganizationCreated,
    {
      organizationId: id,
      sourceSystemCode: input.sourceSystemCode,
      confidence: input.confidence ?? 'UNCONFIRMED',
    },
    { aggregateId: id },
  );

  for (const role of input.roles ?? []) {
    await grantRole(uow, id, role);
  }

  return id;
}

export interface AssertFieldsInput {
  readonly organizationId: string;
  readonly candidates: readonly CandidateInput[];
  /**
   * The row version the caller believes it is changing. A stale value is rejected
   * rather than silently applied (acceptance criterion 25). Optional only for
   * ingestion paths, where there is no user holding a stale screen.
   */
  readonly expectedVersion?: number | undefined;
}

/**
 * Record what a source says and re-derive the affected fields.
 *
 * This is the whole write path for mastered organization data — from an importer, from
 * the admin UI, from an API client. They differ only in which source system they
 * attribute the values to.
 */
export async function assertOrganizationFields(
  uow: UnitOfWork,
  deps: PartyDeps,
  input: AssertFieldsInput,
): Promise<readonly string[]> {
  const current = await loadOrganizationRow(uow.tx, input.organizationId);

  if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
    throw new PreconditionFailedError(
      'organization',
      String(input.expectedVersion),
      current.version,
    );
  }
  if (current.merged_into_id !== null) {
    throw new ConflictError(
      `This organization was merged into ${current.merged_into_id}. Assert values ` +
        `against the surviving record; the merged one keeps its history and takes no ` +
        `new facts.`,
    );
  }

  const touched = await assertCandidates(
    uow,
    deps.fields,
    'ORGANIZATION',
    input.organizationId,
    input.candidates,
  );
  const results = await evaluateFields(
    uow,
    deps.survivorship,
    'ORGANIZATION',
    input.organizationId,
    touched,
  );

  const changed = results.filter((result) => result.valueChanged);
  if (changed.length === 0) return [];

  const after = await loadOrganizationRow(uow.tx, input.organizationId);
  uow.audit({
    schema: 'party',
    table: 'organization',
    entityId: input.organizationId,
    operation: 'UPDATE',
    before: current as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
  });

  const winners = await winningSources(
    uow.tx,
    input.organizationId,
    changed.map((result) => result.fieldKey),
  );

  for (const result of changed) {
    uow.emit(
      OrganizationFieldValueChanged,
      {
        organizationId: input.organizationId,
        fieldKey: result.fieldKey,
        winningSourceCode: winners.get(result.fieldKey) ?? null,
        previousSourceCode: null,
        ruleVersion: deps.survivorship.rules.for('ORGANIZATION', result.fieldKey).version,
      },
      { aggregateId: input.organizationId },
    );
  }

  return changed.map((result) => result.fieldKey);
}

/**
 * Re-run survivorship for an entity without asserting anything new.
 *
 * The operation that makes a rule change safe: it is explicit, it produces a new
 * reason on every affected field, and it destroys no candidate. Run it after editing
 * `party.survivorship_rule`.
 */
export async function reevaluateOrganization(
  uow: UnitOfWork,
  deps: PartyDeps,
  organizationId: string,
): Promise<readonly string[]> {
  const fieldKeys = deps.fields.forEntity('ORGANIZATION').map((field) => field.fieldKey);
  const results = await evaluateFields(
    uow,
    deps.survivorship,
    'ORGANIZATION',
    organizationId,
    fieldKeys,
  );

  const changed = results.filter((result) => result.valueChanged);
  const winners = await winningSources(
    uow.tx,
    organizationId,
    changed.map((result) => result.fieldKey),
  );

  for (const result of changed) {
    uow.emit(
      OrganizationFieldValueChanged,
      {
        organizationId,
        fieldKey: result.fieldKey,
        winningSourceCode: winners.get(result.fieldKey) ?? null,
        previousSourceCode: null,
        ruleVersion: deps.survivorship.rules.for('ORGANIZATION', result.fieldKey).version,
      },
      { aggregateId: organizationId },
    );
  }

  return changed.map((result) => result.fieldKey);
}

async function winningSources(
  tx: DbTransaction,
  organizationId: string,
  fieldKeys: readonly string[],
): Promise<Map<string, string>> {
  if (fieldKeys.length === 0) return new Map();
  const result = await sql<{ field_key: string; source_system_code: string }>`
    SELECT field_key, source_system_code FROM party.field_candidate
     WHERE entity_type = 'ORGANIZATION' AND entity_id = ${organizationId}::uuid
       AND field_key = ANY(${[...fieldKeys]}::text[]) AND is_selected
  `.execute(tx);
  return new Map(result.rows.map((row) => [row.field_key, row.source_system_code]));
}

interface OrganizationRow {
  readonly id: string;
  readonly legal_name: string;
  readonly trade_name: string | null;
  readonly website_url: string | null;
  readonly organization_type: string;
  readonly lifecycle_status: string;
  readonly merged_into_id: string | null;
  readonly version: number;
}

async function loadOrganizationRow(
  tx: DbTransaction,
  id: string,
): Promise<OrganizationRow> {
  const result = await sql<OrganizationRow>`
    SELECT id, legal_name, trade_name, website_url, organization_type,
           lifecycle_status, merged_into_id, version
      FROM party.organization WHERE id = ${id}::uuid
  `.execute(tx);
  const row = result.rows[0];
  if (row === undefined) throw new NotFoundError('organization', id);
  return row;
}

export async function grantRole(
  uow: UnitOfWork,
  organizationId: string,
  role: OrganizationRoleInput,
): Promise<void> {
  const scoped = await sql<{ is_company_scoped: boolean }>`
    SELECT is_company_scoped FROM party.organization_role_type
     WHERE code = ${role.roleCode} AND is_active
  `.execute(uow.tx);
  const roleType = scoped.rows[0];
  if (roleType === undefined) {
    throw new ValidationError(
      `'${role.roleCode}' is not an active organization role. Adding one requires a ` +
        `data-dictionary entry and a stated consumer (ADR-0007).`,
    );
  }
  if (roleType.is_company_scoped && role.operatingCompany === undefined) {
    throw new ValidationError(
      `The '${role.roleCode}' role is per operating company: an organization can be a ` +
        `Welsford customer and not a ValveMan one. Say which business.`,
    );
  }
  if (!roleType.is_company_scoped && role.operatingCompany !== undefined) {
    throw new ValidationError(
      `The '${role.roleCode}' role is not company-scoped. A company either makes ` +
        `things or it does not; scoping it to one business would assert otherwise.`,
    );
  }

  const inserted = await sql<{ id: string }>`
    INSERT INTO party.organization_role
      (id, organization_id, role_code, operating_company, valid_from, created_by)
    VALUES (${uow.ids.next()}, ${organizationId}::uuid, ${role.roleCode},
            ${role.operatingCompany ?? null}, ${role.validFrom ?? null}::date,
            ${uow.context.actor.principalId ?? null}::uuid)
    ON CONFLICT DO NOTHING
    RETURNING id
  `.execute(uow.tx);

  if (inserted.rows.length === 0) return; // Already held; granting again is a no-op.

  uow.emit(
    OrganizationRoleGranted,
    {
      organizationId,
      roleCode: role.roleCode,
      operatingCompany: role.operatingCompany ?? null,
    },
    role.operatingCompany === undefined
      ? { aggregateId: organizationId }
      : { aggregateId: organizationId, operatingCompany: role.operatingCompany },
  );
}

export interface RelationshipInput {
  readonly fromOrganizationId: string;
  readonly toOrganizationId: string;
  readonly relationshipCode: string;
  readonly validFrom?: string | undefined;
  readonly note?: string | undefined;
}

export class RelationshipCycleError extends ConflictError {
  constructor(path: readonly string[], relationshipCode: string) {
    super(
      `This '${relationshipCode}' relationship would create a cycle: ` +
        `${path.join(' -> ')}. A company cannot be its own parent, however many ` +
        `steps away.`,
    );
    this.name = 'RelationshipCycleError';
  }
}

/**
 * Record a relationship, refusing one that would make a hierarchy circular.
 *
 * The cycle check runs in the application rather than as a constraint so that the
 * error names the offending path. "A -> B -> C -> A" is something a person can fix;
 * a constraint violation is something they raise a ticket about.
 */
export async function relateOrganizations(
  uow: UnitOfWork,
  input: RelationshipInput,
): Promise<void> {
  if (input.fromOrganizationId === input.toOrganizationId) {
    throw new ValidationError('An organization cannot be related to itself.');
  }

  const type = await sql<{ is_hierarchical: boolean }>`
    SELECT is_hierarchical FROM party.relationship_type
     WHERE code = ${input.relationshipCode} AND is_active
  `.execute(uow.tx);
  const relationshipType = type.rows[0];
  if (relationshipType === undefined) {
    throw new ValidationError(
      `'${input.relationshipCode}' is not an active relationship type.`,
    );
  }

  if (relationshipType.is_hierarchical) {
    const path = await findPath(uow.tx, input.toOrganizationId, input.fromOrganizationId);
    if (path !== undefined) {
      throw new RelationshipCycleError(
        [input.fromOrganizationId, ...path],
        input.relationshipCode,
      );
    }
  }

  await sql`
    INSERT INTO party.organization_relationship
      (id, from_organization_id, to_organization_id, relationship_code, valid_from,
       note, created_by)
    VALUES (${uow.ids.next()}, ${input.fromOrganizationId}::uuid,
            ${input.toOrganizationId}::uuid, ${input.relationshipCode},
            ${input.validFrom ?? null}::date, ${input.note ?? null},
            ${uow.context.actor.principalId ?? null}::uuid)
    ON CONFLICT DO NOTHING
  `.execute(uow.tx);

  uow.emit(
    OrganizationRelationshipChanged,
    {
      organizationId: input.fromOrganizationId,
      toOrganizationId: input.toOrganizationId,
      relationshipCode: input.relationshipCode,
      change: 'ADDED',
    },
    { aggregateId: input.fromOrganizationId },
  );
}

/** The hierarchical path from one organization to another, if there is one. */
async function findPath(
  tx: DbTransaction,
  from: string,
  to: string,
): Promise<readonly string[] | undefined> {
  const result = await sql<{ path: string[] }>`
    WITH RECURSIVE reachable(id, path) AS (
      SELECT ${from}::uuid, ARRAY[${from}::uuid]
      UNION ALL
      SELECT r.to_organization_id, reachable.path || r.to_organization_id
        FROM party.organization_relationship r
        JOIN party.relationship_type t ON t.code = r.relationship_code
        JOIN reachable ON reachable.id = r.from_organization_id
       WHERE t.is_hierarchical
         AND r.valid_to IS NULL
         -- Stop rather than loop if the graph already contains a cycle from some
         -- earlier state; reporting it is better than hanging.
         AND NOT (r.to_organization_id = ANY(reachable.path))
         AND array_length(reachable.path, 1) < 64
    )
    SELECT path::text[] AS path FROM reachable WHERE id = ${to}::uuid LIMIT 1
  `.execute(tx);
  return result.rows[0]?.path;
}

export interface OrganizationView {
  readonly id: string;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly websiteUrl: string | null;
  readonly organizationType: string;
  readonly lifecycleStatus: string;
  readonly version: number;
}

export async function readOrganization(
  db: Database | DbTransaction,
  id: string,
): Promise<OrganizationView> {
  const result = await sql<OrganizationRow>`
    SELECT id, legal_name, trade_name, website_url, organization_type,
           lifecycle_status, merged_into_id, version
      FROM party.organization WHERE id = ${id}::uuid
  `.execute(db);
  const row = result.rows[0];
  if (row === undefined) throw new NotFoundError('organization', id);
  return {
    id: row.id,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    websiteUrl: row.website_url,
    organizationType: row.organization_type,
    lifecycleStatus: row.lifecycle_status,
    version: row.version,
  };
}
