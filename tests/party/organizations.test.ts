import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { createTestDatabase, type TestDatabase } from '../support/database.js';
import { testContext, testDeps } from '../support/context.js';
import { syncEventRegistry } from '../../src/modules/events/index.js';
import { ALL_EVENTS } from '../../src/event-catalog.js';
import { withUnitOfWork, type UnitOfWork } from '../../src/kernel/unit-of-work.js';
import {
  assertOrganizationFields,
  createOrganization,
  grantRole,
  loadPartyDeps,
  readOrganization,
  relateOrganizations,
  RelationshipCycleError,
  type PartyDeps,
} from '../../src/modules/party/index.js';

/**
 * Organizations, roles and corporate structure (ADR-0007), plus acceptance criterion
 * 25: a stale write is rejected with a precondition failure rather than overwriting.
 */
describe('organizations', () => {
  let testDb: TestDatabase;
  let deps: ReturnType<typeof testDeps>;

  beforeAll(async () => {
    testDb = await createTestDatabase('organizations');
    await syncEventRegistry(testDb.db, ALL_EVENTS);
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await sql`
      TRUNCATE party.field_candidate, party.organization_role,
               party.organization_relationship, party.organization RESTART IDENTITY CASCADE
    `.execute(testDb.db);
    await sql`
      TRUNCATE events.event_delivery, events.domain_event RESTART IDENTITY CASCADE
    `.execute(testDb.db);
    deps = testDeps();
  });

  async function inUnitOfWork<T>(
    work: (uow: UnitOfWork, party: PartyDeps) => Promise<T>,
  ): Promise<T> {
    return withUnitOfWork(testDb.db, testContext(), deps, async (uow) => {
      const party = await loadPartyDeps(uow.tx);
      return work(uow, party);
    });
  }

  async function makeOrganization(name: string): Promise<string> {
    return inUnitOfWork(async (uow, party) =>
      createOrganization(uow, party, { legalName: name, sourceSystemCode: 'P21' }),
    );
  }

  describe('optimistic concurrency (AC25)', () => {
    it('rejects a write against a version that has moved on', async () => {
      const id = await makeOrganization('Lehigh Valley Controls');
      const read = await readOrganization(testDb.db, id);

      // Someone else's change lands first.
      await inUnitOfWork(async (uow, party) =>
        assertOrganizationFields(uow, party, {
          organizationId: id,
          candidates: [
            {
              fieldKey: 'trade_name',
              value: 'LVC',
              sourceSystemCode: 'MANUAL',
              reason: 'Confirmed on a site visit.',
            },
          ],
          expectedVersion: read.version,
        }),
      );

      // Ours was written against the screen we read before that.
      await expect(
        inUnitOfWork(async (uow, party) =>
          assertOrganizationFields(uow, party, {
            organizationId: id,
            candidates: [
              {
                fieldKey: 'trade_name',
                value: 'Lehigh Controls',
                sourceSystemCode: 'MANUAL',
                reason: 'Heard it on a call.',
              },
            ],
            expectedVersion: read.version,
          }),
        ),
      ).rejects.toMatchObject({ status: 412, code: 'STALE_VERSION' });

      // The first person's value stands. A stale write is refused, not applied.
      const after = await readOrganization(testDb.db, id);
      expect(after.tradeName).toBe('LVC');
    });

    it('accepts a write against the current version', async () => {
      const id = await makeOrganization('Berks Fluid Handling');
      const read = await readOrganization(testDb.db, id);

      await inUnitOfWork(async (uow, party) =>
        assertOrganizationFields(uow, party, {
          organizationId: id,
          candidates: [
            {
              fieldKey: 'trade_name',
              value: 'Berks',
              sourceSystemCode: 'MANUAL',
              reason: 'x',
            },
          ],
          expectedVersion: read.version,
        }),
      );

      const after = await readOrganization(testDb.db, id);
      expect(after.tradeName).toBe('Berks');
      expect(after.version).toBeGreaterThan(read.version);
    });

    it('refuses new facts against a record that lost a merge', async () => {
      const winner = await makeOrganization('Surviving Co');
      const loser = await makeOrganization('Merged Co');
      await sql`
        UPDATE party.organization
           SET merged_into_id = ${winner}::uuid, merged_at = now(),
               lifecycle_status = 'DUPLICATE'
         WHERE id = ${loser}::uuid
      `.execute(testDb.db);

      await expect(
        inUnitOfWork(async (uow, party) =>
          assertOrganizationFields(uow, party, {
            organizationId: loser,
            candidates: [
              {
                fieldKey: 'trade_name',
                value: 'x',
                sourceSystemCode: 'MANUAL',
                reason: 'y',
              },
            ],
          }),
        ),
      ).rejects.toThrow(/merged into/);
    });
  });

  describe('roles', () => {
    it('lets one organization be a manufacturer and a customer at once', async () => {
      const id = await makeOrganization('Emerson');
      await inUnitOfWork(async (uow) => {
        await grantRole(uow, id, { roleCode: 'MANUFACTURER' });
        await grantRole(uow, id, { roleCode: 'CUSTOMER', operatingCompany: 'WELSFORD' });
      });

      const roles = await sql<{ role_code: string; operating_company: string | null }>`
        SELECT role_code, operating_company FROM party.organization_role
         WHERE organization_id = ${id}::uuid ORDER BY role_code
      `.execute(testDb.db);
      expect(roles.rows).toEqual([
        { role_code: 'CUSTOMER', operating_company: 'WELSFORD' },
        { role_code: 'MANUFACTURER', operating_company: null },
      ]);
    });

    it('lets an organization be a customer of one business and not another', async () => {
      const id = await makeOrganization('Two Sided Co');
      await inUnitOfWork(async (uow) => {
        await grantRole(uow, id, { roleCode: 'CUSTOMER', operatingCompany: 'WELSFORD' });
        await grantRole(uow, id, { roleCode: 'PROSPECT', operatingCompany: 'VALVEMAN' });
      });

      const roles = await sql<{ count: string }>`
        SELECT count(*) AS count FROM party.organization_role
         WHERE organization_id = ${id}::uuid
      `.execute(testDb.db);
      expect(Number(roles.rows[0]!.count)).toBe(2);
    });

    it('requires an operating company for a company-scoped role, and refuses one otherwise', async () => {
      const id = await makeOrganization('Scope Test Co');
      await expect(
        inUnitOfWork(async (uow) => grantRole(uow, id, { roleCode: 'CUSTOMER' })),
      ).rejects.toThrow(/per operating company/);

      await expect(
        inUnitOfWork(async (uow) =>
          grantRole(uow, id, { roleCode: 'MANUFACTURER', operatingCompany: 'WELSFORD' }),
        ),
      ).rejects.toThrow(/not company-scoped/);
    });

    it('is a no-op when a role is granted twice', async () => {
      const id = await makeOrganization('Idempotent Co');
      await inUnitOfWork(async (uow) => {
        await grantRole(uow, id, { roleCode: 'SUPPLIER', operatingCompany: 'WELSFORD' });
        await grantRole(uow, id, { roleCode: 'SUPPLIER', operatingCompany: 'WELSFORD' });
      });

      const events = await sql<{ count: string }>`
        SELECT count(*) AS count FROM events.domain_event
         WHERE event_type = 'fsw.party.OrganizationRoleGranted'
      `.execute(testDb.db);
      expect(Number(events.rows[0]!.count)).toBe(1);
    });
  });

  describe('corporate structure', () => {
    it('records a parent relationship and reports a cycle by its path', async () => {
      const a = await makeOrganization('Alpha Holdings');
      const b = await makeOrganization('Beta Industries');
      const c = await makeOrganization('Gamma Works');

      await inUnitOfWork(async (uow) => {
        await relateOrganizations(uow, {
          fromOrganizationId: a,
          toOrganizationId: b,
          relationshipCode: 'PARENT_OF',
        });
        await relateOrganizations(uow, {
          fromOrganizationId: b,
          toOrganizationId: c,
          relationshipCode: 'PARENT_OF',
        });
      });

      // C cannot be A's parent: A already reaches C through B.
      const error = await inUnitOfWork(async (uow) =>
        relateOrganizations(uow, {
          fromOrganizationId: c,
          toOrganizationId: a,
          relationshipCode: 'PARENT_OF',
        }),
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(RelationshipCycleError);
      // The message names the path, so a person can see which link to remove rather
      // than reading a constraint violation and raising a ticket.
      expect((error as Error).message).toContain(a);
      expect((error as Error).message).toContain(b);
      expect((error as Error).message).toContain(c);
    });

    it('allows a symmetric relationship in both directions', async () => {
      const a = await makeOrganization('Rival One');
      const b = await makeOrganization('Rival Two');

      await inUnitOfWork(async (uow) => {
        await relateOrganizations(uow, {
          fromOrganizationId: a,
          toOrganizationId: b,
          relationshipCode: 'COMPETES_WITH',
        });
        // Not hierarchical, so this is not a cycle. Two companies compete with each
        // other; refusing the second row would be modelling nonsense.
        await relateOrganizations(uow, {
          fromOrganizationId: b,
          toOrganizationId: a,
          relationshipCode: 'COMPETES_WITH',
        });
      });

      const rows = await sql<{ count: string }>`
        SELECT count(*) AS count FROM party.organization_relationship
      `.execute(testDb.db);
      expect(Number(rows.rows[0]!.count)).toBe(2);
    });

    it('refuses a relationship from an organization to itself', async () => {
      const a = await makeOrganization('Self Referential Co');
      await expect(
        inUnitOfWork(async (uow) =>
          relateOrganizations(uow, {
            fromOrganizationId: a,
            toOrganizationId: a,
            relationshipCode: 'PARENT_OF',
          }),
        ),
      ).rejects.toThrow(/cannot be related to itself/);
    });
  });

  it('writes an audit entry naming the actor and the change', async () => {
    const id = await makeOrganization('Audited Co');
    await inUnitOfWork(async (uow, party) =>
      assertOrganizationFields(uow, party, {
        organizationId: id,
        candidates: [
          {
            fieldKey: 'website_url',
            value: 'https://audited.example',
            sourceSystemCode: 'MANUAL',
            reason: 'From their invoice letterhead.',
          },
        ],
      }),
    );

    const audit = await sql<{
      operation: string;
      actor_label: string;
      changed_fields: string[];
    }>`
      SELECT operation, actor_label, changed_fields FROM audit.change_log
       WHERE entity_id = ${id} AND operation = 'UPDATE'
    `.execute(testDb.db);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.actor_label).toBe('test.user@fsw.group');
    expect(audit.rows[0]!.changed_fields).toContain('website_url');
  });
});
