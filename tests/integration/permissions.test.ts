import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb, resetDatabase, seedRoles, seedOrg, makeWorker, ctxFor, type Fixture } from '../helpers/db';
import { can, workerAccess, allReportIds, directReportIds, isManagerOf, assertProfileAccess, AuthzError, scopedWorkerFilter, type Ctx } from '@/lib/authz';

/**
 * Permission boundary tests (§66 "Security permission tests are mandatory").
 * These assert the SERVER-SIDE authorization rules, not UI hiding.
 */

let fixture: Fixture;
let hr: Ctx, manager: Ctx, employee: Ctx, peer: Ctx, itAdmin: Ctx, finance: Ctx, auditor: Ctx, contractor: Ctx;
let employeeWorkerId: string, peerWorkerId: string, managerWorkerId: string, indirectWorkerId: string;

beforeAll(async () => {
  await resetDatabase();
  await seedRoles();
  fixture = await seedOrg();

  const hrRow = await makeWorker({ fixture, email: 'hr@test.com', roleKeys: ['HR_ADMIN'], title: 'Head of People' });
  const mgrRow = await makeWorker({ fixture, email: 'manager@test.com', roleKeys: ['MANAGER', 'EMPLOYEE'], title: 'VP Operations' });
  managerWorkerId = mgrRow.workerId;
  const empRow = await makeWorker({ fixture, email: 'employee@test.com', roleKeys: ['EMPLOYEE'], managerId: mgrRow.workerId });
  employeeWorkerId = empRow.workerId;
  // Reports to the employee → indirect report of the manager
  const indirectRow = await makeWorker({ fixture, email: 'indirect@test.com', roleKeys: ['EMPLOYEE'], managerId: empRow.workerId });
  indirectWorkerId = indirectRow.workerId;
  // Unrelated employee under nobody
  const peerRow = await makeWorker({ fixture, email: 'peer@test.com', roleKeys: ['EMPLOYEE'] });
  peerWorkerId = peerRow.workerId;
  const itRow = await makeWorker({ fixture, email: 'it@test.com', roleKeys: ['IT_ADMIN'] });
  const finRow = await makeWorker({ fixture, email: 'finance@test.com', roleKeys: ['FINANCE'] });
  const audRow = await makeWorker({ fixture, email: 'auditor@test.com', roleKeys: ['AUDITOR'] });
  const conRow = await makeWorker({ fixture, email: 'contractor@test.com', roleKeys: ['CONTRACTOR'], workerType: 'CONTRACTOR' });

  hr = await ctxFor(hrRow.userId);
  manager = await ctxFor(mgrRow.userId);
  employee = await ctxFor(empRow.userId);
  peer = await ctxFor(peerRow.userId);
  itAdmin = await ctxFor(itRow.userId);
  finance = await ctxFor(finRow.userId);
  auditor = await ctxFor(audRow.userId);
  contractor = await ctxFor(conRow.userId);
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe('role permission grants', () => {
  it('gives HR people management but not infrastructure settings', () => {
    expect(can(hr, 'people.write')).toBe(true);
    expect(can(hr, 'pii.reveal')).toBe(true);
    expect(can(hr, 'settings.admin')).toBe(false);
    expect(can(hr, 'users.admin')).toBe(false);
  });

  it('denies IT any compensation, PII or HR case access', () => {
    expect(can(itAdmin, 'equipment.admin')).toBe(true);
    expect(can(itAdmin, 'apps.admin')).toBe(true);
    expect(can(itAdmin, 'comp.read')).toBe(false);
    expect(can(itAdmin, 'pii.view')).toBe(false);
    expect(can(itAdmin, 'pii.reveal')).toBe(false);
    expect(can(itAdmin, 'cases.read')).toBe(false);
    expect(can(itAdmin, 'people.read_all')).toBe(false);
  });

  it('gives finance compensation but not HR cases or PII reveal', () => {
    expect(can(finance, 'comp.read')).toBe(true);
    expect(can(finance, 'payroll.admin')).toBe(true);
    expect(can(finance, 'cases.read')).toBe(false);
    expect(can(finance, 'pii.reveal')).toBe(false);
  });

  it('keeps the auditor read-only', () => {
    expect(can(auditor, 'audit.read')).toBe(true);
    expect(can(auditor, 'people.read_all')).toBe(true);
    expect(can(auditor, 'people.write')).toBe(false);
    expect(can(auditor, 'comp.write')).toBe(false);
    expect(can(auditor, 'reports.export')).toBe(false);
  });

  it('restricts plain employees and contractors to self-service', () => {
    for (const ctx of [employee, contractor]) {
      expect(can(ctx, 'people.read')).toBe(true);
      expect(can(ctx, 'people.read_all')).toBe(false);
      expect(can(ctx, 'comp.read')).toBe(false);
      expect(can(ctx, 'pii.view')).toBe(false);
      expect(can(ctx, 'reports.run')).toBe(false);
      expect(can(ctx, 'cases.read')).toBe(false);
    }
  });
});

describe('manager hierarchy', () => {
  it('resolves direct reports', async () => {
    const direct = await directReportIds(managerWorkerId);
    expect(direct).toContain(employeeWorkerId);
    expect(direct).not.toContain(indirectWorkerId);
  });

  it('resolves indirect reports transitively', async () => {
    const all = await allReportIds(managerWorkerId);
    expect(all).toContain(employeeWorkerId);
    expect(all).toContain(indirectWorkerId);
    expect(all).not.toContain(peerWorkerId);
    expect(all).not.toContain(managerWorkerId);
  });

  it('does not treat an unrelated employee as a report', async () => {
    expect(await isManagerOf(manager, peerWorkerId)).toBe(false);
    expect(await isManagerOf(manager, employeeWorkerId)).toBe(true);
  });
});

describe('worker-level field visibility', () => {
  it('lets an employee see their own restricted fields', async () => {
    const access = await workerAccess(employee, employeeWorkerId);
    expect(access.self).toBe(true);
    expect(access.pii).toBe(true);
    expect(access.comp).toBe(true);
  });

  it('denies a manager PII and compensation on their report', async () => {
    const access = await workerAccess(manager, employeeWorkerId);
    expect(access.manager).toBe(true);
    // Manager sees the profile, but NOT SSN/DOB/home address or pay.
    expect(access.pii).toBe(false);
    expect(access.comp).toBe(false);
  });

  it('denies a peer any elevated access to another employee', async () => {
    const access = await workerAccess(peer, employeeWorkerId);
    expect(access.self).toBe(false);
    expect(access.manager).toBe(false);
    expect(access.hr).toBe(false);
    expect(access.pii).toBe(false);
    expect(access.comp).toBe(false);
  });

  it('grants HR full profile plus PII and compensation', async () => {
    const access = await workerAccess(hr, employeeWorkerId);
    expect(access.hr).toBe(true);
    expect(access.pii).toBe(true);
    expect(access.comp).toBe(true);
  });

  it('denies IT admins PII on any worker', async () => {
    const access = await workerAccess(itAdmin, employeeWorkerId);
    expect(access.pii).toBe(false);
    expect(access.comp).toBe(false);
    expect(access.hr).toBe(false);
  });

  it('gives finance compensation without PII', async () => {
    const access = await workerAccess(finance, employeeWorkerId);
    expect(access.comp).toBe(true);
    expect(access.pii).toBe(false);
  });
});

describe('profile access guard', () => {
  it('allows self, manager and HR', async () => {
    await expect(assertProfileAccess(employee, employeeWorkerId)).resolves.toBeTruthy();
    await expect(assertProfileAccess(manager, employeeWorkerId)).resolves.toBeTruthy();
    await expect(assertProfileAccess(hr, employeeWorkerId)).resolves.toBeTruthy();
  });

  it('throws for a context with no directory permission at all', async () => {
    const nobody: Ctx = { ...peer, permissions: new Set<string>(), workerId: null };
    await expect(assertProfileAccess(nobody, employeeWorkerId)).rejects.toBeInstanceOf(AuthzError);
  });
});

describe('permission scope narrowing', () => {
  it('produces no filter when a permission is unscoped', () => {
    expect(scopedWorkerFilter(hr, 'people.read_all')).toEqual({});
  });

  it('narrows by country and legal entity when a scope is present', () => {
    const scoped: Ctx = {
      ...hr,
      scopes: { 'people.read_all': { countries: ['PH'], legalEntityIds: [fixture.entityId] } },
    };
    const filter = scopedWorkerFilter(scoped, 'people.read_all') as { AND: Record<string, unknown>[] };
    expect(filter.AND).toHaveLength(2);
    expect(filter.AND[0]).toEqual({ country: { in: ['PH'] } });
    expect(JSON.stringify(filter.AND[1])).toContain(fixture.entityId);
  });
});
