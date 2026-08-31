import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';
import { createTestDatabase, type TestDatabase } from '../support/database.js';
import { testContext, testDeps } from '../support/context.js';
import { expectRefusal } from '../support/errors.js';
import { syncEventRegistry } from '../../src/modules/events/index.js';
import { ALL_EVENTS } from '../../src/event-catalog.js';
import { withUnitOfWork, type UnitOfWork } from '../../src/kernel/unit-of-work.js';
import {
  assignRole,
  createPersonPrincipal,
  createServiceAccount,
  decide,
  describePrincipal,
  loadPrincipalContext,
  operatingCompanyPredicate,
  operatingCompanyOrGroupPredicate,
  recordDenial,
  revokeRole,
  scopeCovers,
  scopeFilterFor,
  withinScope,
} from '../../src/modules/iam/index.js';
import { createOrganization, loadPartyDeps } from '../../src/modules/party/index.js';

/**
 * Acceptance criterion 2 (spec §83): a ValveMan-only principal is denied a
 * Welsford-only resource, with a negative test and an audit entry.
 *
 * The interesting half is not the refusal. It is that an out-of-scope row is NOT
 * RETURNED rather than refused: a refusal still tells the caller the row exists, and
 * "403 here, 404 there" is an enumeration oracle. Function-level permission is never
 * sufficient (ADR-0019).
 */
describe('object-level authorization (AC2)', () => {
  let testDb: TestDatabase;
  let deps: ReturnType<typeof testDeps>;

  beforeAll(async () => {
    testDb = await createTestDatabase('objectauthz');
    await syncEventRegistry(testDb.db, ALL_EVENTS);
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await sql`
      TRUNCATE iam.access_denial, iam.principal_role_assignment, iam.api_credential,
               iam.service_account, iam.identity, iam.principal,
               party.commercial_account, party.organization, party.person
        RESTART IDENTITY CASCADE
    `.execute(testDb.db);
    await sql`
      TRUNCATE events.event_delivery, events.domain_event RESTART IDENTITY CASCADE
    `.execute(testDb.db);
    deps = testDeps();
  });

  async function inUnitOfWork<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    return withUnitOfWork(testDb.db, testContext(), deps, work);
  }

  /** A principal holding one role in one scope. */
  async function principalWith(
    label: string,
    roleKey: string,
    scopeType: 'FSW_GROUP' | 'OPERATING_COMPANY',
    scopeId?: string,
  ): Promise<string> {
    return inUnitOfWork(async (uow) => {
      const personId = uow.ids.next();
      await sql`
        INSERT INTO party.person (id, display_name) VALUES (${personId}, ${label})
      `.execute(uow.tx);
      const principalId = await createPersonPrincipal(uow, { personId, label });
      await assignRole(uow, {
        principalId,
        roleKey,
        scopeType,
        scopeId,
        reason: `Test fixture: ${label}.`,
      });
      return principalId;
    });
  }

  /** Commercial accounts for one organization, one per operating company. */
  async function twoCompanyAccounts(): Promise<{ welsford: string; valveman: string }> {
    return inUnitOfWork(async (uow) => {
      const party = await loadPartyDeps(uow.tx);
      const organizationId = await createOrganization(uow, party, {
        legalName: 'Keystone Process Systems',
        sourceSystemCode: 'P21',
      });

      const welsford = uow.ids.next();
      const valveman = uow.ids.next();
      await sql`
        INSERT INTO party.commercial_account
          (id, organization_id, operating_company, source_system_code, source_account_key,
           account_name)
        VALUES
          (${welsford}, ${organizationId}::uuid, 'WELSFORD', 'P21', 'C1001', 'Keystone - Welsford'),
          (${valveman}, ${organizationId}::uuid, 'VALVEMAN', 'VALVEMAN_STORE', 'W-88', 'Keystone - web')
      `.execute(uow.tx);

      return { welsford, valveman };
    });
  }

  describe('the decision point', () => {
    it('denies a ValveMan principal a Welsford-scoped operation', async () => {
      const principalId = await principalWith(
        'ValveMan reader',
        'reader',
        'OPERATING_COMPANY',
        'VALVEMAN',
      );
      const context = (await loadPrincipalContext(testDb.db, principalId))!;

      const allowed = decide(context, 'account.read', {
        type: 'OPERATING_COMPANY',
        id: 'VALVEMAN',
      });
      expect(allowed.outcome).toBe('ALLOW');

      const denied = decide(context, 'account.read', {
        type: 'OPERATING_COMPANY',
        id: 'WELSFORD',
      });
      expect(denied.outcome).toBe('DENY');
      // The reason distinguishes "no such permission" from "not here", because those
      // need different fixes: one is a role grant, the other is a scope.
      expect(denied.reason).toContain('does not cover');
      expect(denied.reason).toContain('The permission exists; the scope does not');
    });

    it('denies a permission no role grants, and says so differently', async () => {
      const principalId = await principalWith(
        'Reader',
        'reader',
        'OPERATING_COMPANY',
        'WELSFORD',
      );
      const context = (await loadPrincipalContext(testDb.db, principalId))!;

      const denied = decide(context, 'account.merge', {
        type: 'OPERATING_COMPANY',
        id: 'WELSFORD',
      });
      expect(denied.outcome).toBe('DENY');
      expect(denied.reason).toContain('No role held by this principal grants');
    });

    it('lets a group-scoped grant cover every company', async () => {
      const principalId = await principalWith('Auditor', 'auditor', 'FSW_GROUP');
      const context = (await loadPrincipalContext(testDb.db, principalId))!;
      for (const company of ['WELSFORD', 'VALVEMAN']) {
        expect(
          decide(context, 'audit.read', { type: 'OPERATING_COMPANY', id: company })
            .outcome,
        ).toBe('ALLOW');
      }
    });

    it('refuses an unscoped request from a principal scoped to one company', () => {
      // "Read accounts", with no company named, held only for ValveMan, must not
      // quietly mean "read all accounts".
      expect(scopeCovers({ type: 'OPERATING_COMPANY', id: 'VALVEMAN' }, undefined)).toBe(
        false,
      );
      expect(scopeCovers({ type: 'FSW_GROUP' }, undefined)).toBe(true);
    });

    it('denies everything to a deactivated principal, whatever roles remain', async () => {
      const principalId = await principalWith(
        'Leaver',
        'reader',
        'OPERATING_COMPANY',
        'WELSFORD',
      );
      await sql`
        UPDATE iam.principal
           SET is_active = false, deactivated_at = now(), deactivated_reason = 'Left the company'
         WHERE id = ${principalId}::uuid
      `.execute(testDb.db);

      const context = (await loadPrincipalContext(testDb.db, principalId))!;
      const denied = decide(context, 'account.read', {
        type: 'OPERATING_COMPANY',
        id: 'WELSFORD',
      });
      expect(denied.outcome).toBe('DENY');
      expect(denied.reason).toContain('not active');
    });

    it('stops honouring an assignment once it expires', async () => {
      const principalId = await principalWith(
        'Temp',
        'reader',
        'OPERATING_COMPANY',
        'WELSFORD',
      );
      await sql`
        UPDATE iam.principal_role_assignment SET expires_at = now() - interval '1 day'
         WHERE principal_id = ${principalId}::uuid
      `.execute(testDb.db);

      const context = (await loadPrincipalContext(testDb.db, principalId))!;
      expect(
        decide(context, 'account.read', { type: 'OPERATING_COMPANY', id: 'WELSFORD' })
          .outcome,
      ).toBe('DENY');
    });

    it('is default deny for a principal with no roles at all', async () => {
      const principalId = await inUnitOfWork(async (uow) => {
        const personId = uow.ids.next();
        await sql`
          INSERT INTO party.person (id, display_name) VALUES (${personId}, 'New joiner')
        `.execute(uow.tx);
        return createPersonPrincipal(uow, { personId, label: 'New joiner' });
      });

      const context = (await loadPrincipalContext(testDb.db, principalId))!;
      for (const permission of [
        'account.read',
        'product.read',
        'audit.read',
        'pii.erase',
      ]) {
        expect(decide(context, permission, { type: 'FSW_GROUP' }).outcome).toBe('DENY');
      }
    });
  });

  describe('the scope predicate', () => {
    it("does not return the other company's account — it does not refuse it", async () => {
      const accounts = await twoCompanyAccounts();
      const principalId = await principalWith(
        'ValveMan reader',
        'reader',
        'OPERATING_COMPANY',
        'VALVEMAN',
      );
      const context = (await loadPrincipalContext(testDb.db, principalId))!;
      const filter = scopeFilterFor(context, 'account.read');

      const visible = await sql<{ id: string; operating_company: string }>`
        SELECT id, operating_company FROM party.commercial_account
         WHERE ${operatingCompanyPredicate(filter, 'operating_company')}
      `.execute(testDb.db);

      // Exactly one row comes back. The Welsford account is not refused, not hidden
      // behind a 403 — it is simply not in the result, so its existence is not
      // information the caller now has.
      expect(visible.rows).toHaveLength(1);
      expect(visible.rows[0]!.id).toBe(accounts.valveman);
      expect(visible.rows[0]!.operating_company).toBe('VALVEMAN');
    });

    it('returns everything for a group-scoped principal', async () => {
      await twoCompanyAccounts();
      const principalId = await principalWith(
        'Privacy officer',
        'privacy_officer',
        'FSW_GROUP',
      );
      const context = (await loadPrincipalContext(testDb.db, principalId))!;
      const filter = scopeFilterFor(context, 'account.read');

      const visible = await sql<{ id: string }>`
        SELECT id FROM party.commercial_account
         WHERE ${operatingCompanyPredicate(filter, 'operating_company')}
      `.execute(testDb.db);
      expect(visible.rows).toHaveLength(2);
    });

    it('returns nothing, rather than failing, for a principal with no scope', async () => {
      await twoCompanyAccounts();
      const principalId = await inUnitOfWork(async (uow) => {
        const personId = uow.ids.next();
        await sql`
          INSERT INTO party.person (id, display_name) VALUES (${personId}, 'No roles')
        `.execute(uow.tx);
        return createPersonPrincipal(uow, { personId, label: 'No roles' });
      });
      const context = (await loadPrincipalContext(testDb.db, principalId))!;
      const filter = scopeFilterFor(context, 'account.read');
      expect(filter.kind).toBe('none');

      // An empty list, not an error. A new joiner with no roles should see nothing,
      // and "you have no accounts" is a legitimate state rather than a failure.
      const visible = await sql<{ id: string }>`
        SELECT id FROM party.commercial_account
         WHERE ${operatingCompanyPredicate(filter, 'operating_company')}
      `.execute(testDb.db);
      expect(visible.rows).toEqual([]);
    });

    it('shares group-wide rows while keeping company-specific ones separate', async () => {
      // Assumption A-021 and open question I6: after a merge, organization identity is
      // visible group-wide while commercial accounts stay within their owning company.
      await twoCompanyAccounts();
      const principalId = await principalWith(
        'ValveMan reader',
        'reader',
        'OPERATING_COMPANY',
        'VALVEMAN',
      );
      const context = (await loadPrincipalContext(testDb.db, principalId))!;
      const filter = scopeFilterFor(context, 'account.read');

      const organizations = await sql<{ count: string }>`
        SELECT count(*) AS count FROM party.organization o
         LEFT JOIN LATERAL (SELECT NULL::text AS operating_company) s ON true
         WHERE ${operatingCompanyOrGroupPredicate(filter, 's.operating_company')}
      `.execute(testDb.db);
      // The organization itself is shared: a ValveMan user can see that Keystone
      // exists, without seeing what Welsford sells them.
      expect(Number(organizations.rows[0]!.count)).toBe(1);
    });

    it('answers the single-row question the same way', () => {
      const filter = {
        kind: 'companies' as const,
        operatingCompanies: ['VALVEMAN'],
        principalId: 'p',
      };
      expect(withinScope(filter, 'VALVEMAN')).toBe(true);
      expect(withinScope(filter, 'WELSFORD')).toBe(false);
      expect(withinScope(filter, null)).toBe(true);
      expect(withinScope({ ...filter, kind: 'none', operatingCompanies: [] }, null)).toBe(
        false,
      );
    });

    it('refuses to build a predicate from anything but a plain identifier', () => {
      const filter = {
        kind: 'companies' as const,
        operatingCompanies: ['VALVEMAN'],
        principalId: 'p',
      };
      // A scope predicate built from an unvalidated identifier would be a hole in
      // exactly the control it exists to be.
      expect(() =>
        operatingCompanyPredicate(filter, "x'; DROP TABLE party.organization; --"),
      ).toThrow(/plain identifier/);
    });
  });

  describe('the denial record', () => {
    it('records a refusal with who, what, where and why', async () => {
      const principalId = await principalWith(
        'ValveMan reader',
        'reader',
        'OPERATING_COMPANY',
        'VALVEMAN',
      );
      const context = (await loadPrincipalContext(testDb.db, principalId))!;
      const denied = decide(context, 'account.read', {
        type: 'OPERATING_COMPANY',
        id: 'WELSFORD',
      });
      expect(denied.outcome).toBe('DENY');

      const requestContext = testContext();
      await recordDenial(
        testDb.db,
        {
          interface: 'API',
          correlationId: requestContext.correlationId,
          clientIp: '198.51.100.7',
        },
        {
          principalId,
          permissionKey: denied.permissionKey,
          scope: denied.scope,
          resourceKind: 'commercial_account',
          reason: denied.reason,
        },
      );

      const rows = await sql<{
        principal_id: string;
        permission_key: string;
        scope_type: string;
        scope_id: string;
        reason: string;
        interface: string;
        client_ip: string;
      }>`SELECT * FROM iam.access_denial`.execute(testDb.db);

      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]).toMatchObject({
        principal_id: principalId,
        permission_key: 'account.read',
        scope_type: 'OPERATING_COMPANY',
        scope_id: 'WELSFORD',
        interface: 'API',
        client_ip: '198.51.100.7',
      });
      expect(rows.rows[0]!.reason).toContain('does not cover');
    });

    it('records a refusal even when the caller could not be identified', async () => {
      // Worth seeing on its own: an unidentifiable caller probing endpoints is exactly
      // the pattern a refusal rate is meant to surface.
      await recordDenial(
        testDb.db,
        { interface: 'API', correlationId: testContext().correlationId },
        { attemptedSubject: 'unknown-subject', reason: 'No principal for this token.' },
      );
      const rows = await sql<{ principal_id: string | null; attempted_subject: string }>`
        SELECT principal_id, attempted_subject FROM iam.access_denial
      `.execute(testDb.db);
      expect(rows.rows[0]!.principal_id).toBeNull();
      expect(rows.rows[0]!.attempted_subject).toBe('unknown-subject');
    });

    it('is append-only for the application role', async () => {
      // A denial is evidence, and evidence the application can rewrite is not evidence.
      //
      // The guarantee is a REVOKE in the migration, and it only takes effect where the
      // fsw_app role exists — which needs CREATEROLE, and a managed instance or a
      // developer sandbox may not grant it. So: verify the live grants where the role
      // is there, and verify the migration still carries the REVOKE where it is not.
      // The weaker check is stated rather than skipped, because a security test that
      // quietly does nothing is worse than one that is absent.
      const roleExists = await sql<{ exists: boolean }>`
        SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsw_app') AS exists
      `.execute(testDb.db);

      if (roleExists.rows[0]!.exists) {
        const grants = await sql<{ privilege_type: string }>`
          SELECT privilege_type FROM information_schema.role_table_grants
           WHERE table_schema = 'iam' AND table_name = 'access_denial' AND grantee = 'fsw_app'
        `.execute(testDb.db);
        const held = grants.rows.map((r) => r.privilege_type);
        expect(held).toContain('INSERT');
        expect(held).toContain('SELECT');
        expect(held).not.toContain('UPDATE');
        expect(held).not.toContain('DELETE');
        return;
      }

      const migration = await readFile(
        join(import.meta.dirname, '..', '..', 'db', 'migrations', '0019_iam.sql'),
        'utf8',
      );
      expect(
        migration,
        'The fsw_app role does not exist in this database, so the runtime grant cannot ' +
          'be checked. The migration must still revoke UPDATE and DELETE on ' +
          'iam.access_denial, or the append-only guarantee is lost wherever the role ' +
          'does exist.',
      ).toMatch(/REVOKE\s+UPDATE,\s*DELETE\s+ON\s+iam\.access_denial\s+FROM\s+fsw_app/i);
    });
  });

  describe('role administration', () => {
    it('lets one person edit at ValveMan and only read at Welsford', async () => {
      const principalId = await principalWith(
        'Dual role',
        'product_editor',
        'OPERATING_COMPANY',
        'VALVEMAN',
      );
      await inUnitOfWork(async (uow) =>
        assignRole(uow, {
          principalId,
          roleKey: 'reader',
          scopeType: 'OPERATING_COMPANY',
          scopeId: 'WELSFORD',
          reason: 'Covers the Welsford catalogue during the transition.',
        }),
      );

      const context = (await loadPrincipalContext(testDb.db, principalId))!;
      expect(
        decide(context, 'product.write', { type: 'OPERATING_COMPANY', id: 'VALVEMAN' })
          .outcome,
      ).toBe('ALLOW');
      expect(
        decide(context, 'product.write', { type: 'OPERATING_COMPANY', id: 'WELSFORD' })
          .outcome,
      ).toBe('DENY');
      expect(
        decide(context, 'product.read', { type: 'OPERATING_COMPANY', id: 'WELSFORD' })
          .outcome,
      ).toBe('ALLOW');
    });

    it('refuses to grant a company-scoped role group-wide', async () => {
      const principalId = await principalWith(
        'Reader',
        'reader',
        'OPERATING_COMPANY',
        'VALVEMAN',
      );
      await expectRefusal(
        inUnitOfWork(async (uow) =>
          assignRole(uow, {
            principalId,
            roleKey: 'product_editor',
            scopeType: 'FSW_GROUP',
            reason: 'Convenience.',
          }),
        ),
        /cannot be granted group-wide/,
      );
    });

    it('refuses a grant with no reason', async () => {
      const principalId = await principalWith(
        'Reader',
        'reader',
        'OPERATING_COMPANY',
        'VALVEMAN',
      );
      await expectRefusal(
        inUnitOfWork(async (uow) =>
          assignRole(uow, {
            principalId,
            roleKey: 'data_steward',
            scopeType: 'OPERATING_COMPANY',
            scopeId: 'VALVEMAN',
            reason: '   ',
          }),
        ),
        /needs a reason/,
      );
    });

    it('refuses a scope that names no company', async () => {
      const principalId = await principalWith(
        'Reader',
        'reader',
        'OPERATING_COMPANY',
        'VALVEMAN',
      );
      await expectRefusal(
        inUnitOfWork(async (uow) =>
          assignRole(uow, {
            principalId,
            roleKey: 'data_steward',
            scopeType: 'OPERATING_COMPANY',
            scopeId: 'NOT_A_COMPANY',
            reason: 'Typo.',
          }),
        ),
        /not an active operating company/,
      );
    });

    it('audits a grant and a revocation, both with their reasons', async () => {
      const principalId = await principalWith(
        'Steward',
        'reader',
        'OPERATING_COMPANY',
        'WELSFORD',
      );
      const assignmentId = await inUnitOfWork(async (uow) =>
        assignRole(uow, {
          principalId,
          roleKey: 'data_steward',
          scopeType: 'OPERATING_COMPANY',
          scopeId: 'WELSFORD',
          reason: 'Approved by the operations manager on 12 August.',
        }),
      );
      await inUnitOfWork(async (uow) =>
        revokeRole(uow, assignmentId, 'Quarterly access review: no longer needed.'),
      );

      const entries = await sql<{
        operation: string;
        reason: string;
        actor_label: string;
      }>`
        SELECT operation, reason, actor_label FROM audit.change_log
         WHERE entity_id = ${assignmentId} ORDER BY occurred_at
      `.execute(testDb.db);
      expect(entries.rows.map((r) => r.operation)).toEqual(['INSERT', 'DELETE']);
      expect(entries.rows[0]!.reason).toContain('operations manager');
      expect(entries.rows[1]!.reason).toContain('Quarterly access review');
      expect(entries.rows[0]!.actor_label).toBe('test.user@fsw.group');
    });

    it('stops granting anything the moment a role is revoked', async () => {
      const principalId = await principalWith(
        'Steward',
        'data_steward',
        'OPERATING_COMPANY',
        'WELSFORD',
      );
      const before = (await loadPrincipalContext(testDb.db, principalId))!;
      expect(
        decide(before, 'account.merge', { type: 'OPERATING_COMPANY', id: 'WELSFORD' })
          .outcome,
      ).toBe('ALLOW');

      const assignment = await sql<{ id: string }>`
        SELECT id FROM iam.principal_role_assignment WHERE principal_id = ${principalId}::uuid
      `.execute(testDb.db);
      await inUnitOfWork(async (uow) =>
        revokeRole(uow, assignment.rows[0]!.id, 'Moved to a different team.'),
      );

      const after = (await loadPrincipalContext(testDb.db, principalId))!;
      expect(
        decide(after, 'account.merge', { type: 'OPERATING_COMPANY', id: 'WELSFORD' })
          .outcome,
      ).toBe('DENY');
    });

    it('describes a principal in one call, which is what /v1/me returns', async () => {
      const principalId = await principalWith(
        'Dual role',
        'product_editor',
        'OPERATING_COMPANY',
        'VALVEMAN',
      );
      await inUnitOfWork(async (uow) =>
        assignRole(uow, {
          principalId,
          roleKey: 'reader',
          scopeType: 'OPERATING_COMPANY',
          scopeId: 'WELSFORD',
          reason: 'Transition cover.',
        }),
      );

      const summary = await describePrincipal(testDb.db, principalId);
      expect(summary.principalType).toBe('PERSON');
      expect(summary.personId).toBeDefined();
      expect(summary.roles.map((r) => `${r.roleKey}@${r.scopeId ?? '*'}`).sort()).toEqual(
        ['product_editor@VALVEMAN', 'reader@WELSFORD'],
      );
      expect(summary.permissions).toContain('product.write');
      expect(summary.operatingCompanies).toEqual(['VALVEMAN', 'WELSFORD']);
    });

    it('refuses a service account with no named owner', async () => {
      await expectRefusal(
        inUnitOfWork(async (uow) =>
          createServiceAccount(uow, {
            key: 'orphan',
            description: 'Nobody owns this.',
            ownerNote: '  ',
          }),
        ),
        /needs a named owner/,
      );
    });

    it('gives a service account a principal that can hold roles', async () => {
      const created = await inUnitOfWork(async (uow) => {
        const account = await createServiceAccount(uow, {
          key: 'p21_connector',
          description: 'Runs the Prophet 21 file import.',
          ownerNote: 'Data platform team.',
        });
        await assignRole(uow, {
          principalId: account.principalId,
          roleKey: 'integration',
          scopeType: 'OPERATING_COMPANY',
          scopeId: 'WELSFORD',
          reason: 'Scheduled import.',
        });
        return account;
      });

      const context = (await loadPrincipalContext(testDb.db, created.principalId))!;
      expect(context.principalType).toBe('SERVICE');
      expect(context.personId).toBeUndefined();
      expect(
        decide(context, 'ingest.run', { type: 'OPERATING_COMPANY', id: 'WELSFORD' })
          .outcome,
      ).toBe('ALLOW');
      // Every automated write now has an accountable identity rather than appearing
      // as "the system".
      expect(
        decide(context, 'pii.erase', { type: 'OPERATING_COMPANY', id: 'WELSFORD' })
          .outcome,
      ).toBe('DENY');
    });
  });

  describe('the permission catalogue', () => {
    it('grants no role a permission the catalogue does not define', async () => {
      const orphans = await sql<{ role_key: string; permission_key: string }>`
        SELECT rp.role_key, rp.permission_key FROM iam.role_permission rp
         WHERE NOT EXISTS (SELECT 1 FROM iam.permission p WHERE p.key = rp.permission_key)
      `.execute(testDb.db);
      expect(orphans.rows).toEqual([]);
    });

    it('keeps the sensitive permissions out of the ordinary roles', async () => {
      // A reader or a product editor should not hold erasure, merge, or metadata
      // rewriting. Checked here rather than trusted to review, because the seed data
      // is easy to extend carelessly.
      const leaked = await sql<{ role_key: string; permission_key: string }>`
        SELECT rp.role_key, rp.permission_key
          FROM iam.role_permission rp
          JOIN iam.permission p ON p.key = rp.permission_key
         WHERE p.is_sensitive AND rp.role_key IN ('reader','product_editor','integration')
      `.execute(testDb.db);
      expect(leaked.rows.filter((r) => r.permission_key !== 'ingest.approve')).toEqual(
        [],
      );
    });
  });
});
