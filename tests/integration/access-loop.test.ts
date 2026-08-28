import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testDb, resetDatabase, seedRoles, seedOrg, makeWorker, type Fixture } from '../helpers/db';
import { profileMatches, entitlementsFor, provisionForOnboarding, deprovisionForOffboarding, accessExceptions } from '@/lib/access';

let fixture: Fixture;
let warehouseWorker: string, salesWorker: string, leaver: string;
let p21Id: string, teamsId: string, crmId: string;
let warehouseProfileId: string;

beforeAll(async () => {
  await resetDatabase();
  await seedRoles();
  fixture = await seedOrg();

  const p21 = await testDb.softwareApp.create({ data: { name: 'Prophet 21' } });
  const teams = await testDb.softwareApp.create({ data: { name: 'Microsoft Teams' } });
  const crm = await testDb.softwareApp.create({ data: { name: 'Pipedrive' } });
  p21Id = p21.id; teamsId = teams.id; crmId = crm.id;

  const wh = await makeWorker({ fixture, email: 'wh@acc.test', roleKeys: ['EMPLOYEE'], title: 'Warehouse Associate' });
  const sales = await makeWorker({ fixture, email: 'sales@acc.test', roleKeys: ['EMPLOYEE'], title: 'Account Executive' });
  const gone = await makeWorker({ fixture, email: 'gone@acc.test', roleKeys: ['EMPLOYEE'] });
  warehouseWorker = wh.workerId; salesWorker = sales.workerId; leaver = gone.workerId;

  await testDb.employmentRecord.updateMany({ where: { workerId: warehouseWorker }, data: { jobFamily: 'Warehouse' } });
  await testDb.employmentRecord.updateMany({ where: { workerId: salesWorker }, data: { jobFamily: 'Sales' } });
});

afterAll(async () => {
  await testDb.$disconnect();
});

beforeEach(async () => {
  await testDb.$executeRawUnsafe('TRUNCATE TABLE "AccessEvent", "AccessProfileItem", "AccessProfile", "AppAccessGrant", "Task" RESTART IDENTITY CASCADE');
  await testDb.worker.update({ where: { id: leaver }, data: { status: 'ACTIVE', terminationDate: null } });

  const profile = await testDb.accessProfile.create({
    data: {
      name: 'Warehouse Associate',
      criteria: { jobFamilies: ['Warehouse'], workerTypes: ['EMPLOYEE'] },
    },
  });
  warehouseProfileId = profile.id;
  await testDb.accessProfileItem.create({ data: { profileId: profile.id, appId: p21Id, accessLevel: 'USER' } });
  await testDb.accessProfileItem.create({ data: { profileId: profile.id, appId: teamsId, accessLevel: 'USER', required: false } });
});

describe('profile matching', () => {
  const facts = { departmentId: 'd1', jobFamily: 'Warehouse', workerType: 'EMPLOYEE', title: 'Picker' };

  it('matches on job family', () => {
    expect(profileMatches({ jobFamilies: ['Warehouse'] }, facts)).toBe(true);
    expect(profileMatches({ jobFamilies: ['Sales'] }, facts)).toBe(false);
  });

  it('requires every stated rule to match', () => {
    expect(profileMatches({ jobFamilies: ['Warehouse'], workerTypes: ['CONTRACTOR'] }, facts)).toBe(false);
  });

  it('matches nobody when the profile has no rules at all', () => {
    // A profile that applied to everyone by omission would over-provision the
    // whole company the moment it was saved.
    expect(profileMatches({}, facts)).toBe(false);
    expect(profileMatches(null, facts)).toBe(false);
    expect(profileMatches({ jobFamilies: [], workerTypes: [] }, facts)).toBe(false);
  });
});

describe('entitlements', () => {
  it('resolves what a worker should have from their profiles', async () => {
    const entitlements = await entitlementsFor(warehouseWorker);
    expect(entitlements.map((e) => e.appName).sort()).toEqual(['Microsoft Teams', 'Prophet 21']);
  });

  it('gives nothing to a worker no profile covers', async () => {
    expect(await entitlementsFor(salesWorker)).toHaveLength(0);
  });

  it('takes the higher access level when two profiles overlap', async () => {
    const second = await testDb.accessProfile.create({
      data: { name: 'Warehouse Lead', criteria: { jobFamilies: ['Warehouse'] } },
    });
    await testDb.accessProfileItem.create({ data: { profileId: second.id, appId: p21Id, accessLevel: 'ADMIN' } });
    const entitlements = await entitlementsFor(warehouseWorker);
    expect(entitlements.find((e) => e.appId === p21Id)!.accessLevel).toBe('ADMIN');
  });

  it('ignores an inactive profile', async () => {
    await testDb.accessProfile.update({ where: { id: warehouseProfileId }, data: { active: false } });
    expect(await entitlementsFor(warehouseWorker)).toHaveLength(0);
  });
});

describe('provisioning on onboarding', () => {
  it('raises a grant task per entitlement and records the evidence', async () => {
    const created = await provisionForOnboarding(warehouseWorker);
    expect(created).toBe(2);

    const tasks = await testDb.task.findMany({ where: { workerId: warehouseWorker, sourceType: 'ACCESS_PROVISION' } });
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.ownerRoleKey === 'IT_ADMIN')).toBe(true);

    const events = await testDb.accessEvent.findMany({ where: { workerId: warehouseWorker } });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.action === 'GRANT_REQUESTED' && e.source === 'ONBOARDING')).toBe(true);
  });

  it('is idempotent — re-running raises nothing new', async () => {
    await provisionForOnboarding(warehouseWorker);
    expect(await provisionForOnboarding(warehouseWorker)).toBe(0);
    expect(await testDb.task.count({ where: { workerId: warehouseWorker, sourceType: 'ACCESS_PROVISION' } })).toBe(2);
  });

  it('skips an entitlement that is already granted', async () => {
    await testDb.appAccessGrant.create({ data: { appId: p21Id, workerId: warehouseWorker } });
    expect(await provisionForOnboarding(warehouseWorker)).toBe(1);
  });

  it('marks required entitlements as higher priority than optional ones', async () => {
    await provisionForOnboarding(warehouseWorker);
    const tasks = await testDb.task.findMany({ where: { workerId: warehouseWorker, sourceType: 'ACCESS_PROVISION' } });
    expect(tasks.find((t) => t.sourceId === p21Id)!.priority).toBe('HIGH');
    expect(tasks.find((t) => t.sourceId === teamsId)!.priority).toBe('NORMAL');
  });
});

describe('deprovisioning on offboarding', () => {
  it('raises revoke tasks from what was actually granted, not from the profile', async () => {
    // Granted something outside their profile — exactly the case a
    // profile-driven revoke would miss.
    await testDb.appAccessGrant.create({ data: { appId: crmId, workerId: warehouseWorker } });
    await testDb.appAccessGrant.create({ data: { appId: p21Id, workerId: warehouseWorker } });

    const created = await deprovisionForOffboarding(warehouseWorker);
    expect(created).toBe(2);
    const tasks = await testDb.task.findMany({ where: { workerId: warehouseWorker, sourceType: 'ACCESS_REVOKE' } });
    expect(tasks.map((t) => t.sourceId).sort()).toEqual([crmId, p21Id].sort());
  });

  it('raises nothing for someone with no live grants', async () => {
    expect(await deprovisionForOffboarding(salesWorker)).toBe(0);
  });

  it('does not re-raise a revoke task that is already open', async () => {
    await testDb.appAccessGrant.create({ data: { appId: p21Id, workerId: warehouseWorker } });
    await deprovisionForOffboarding(warehouseWorker);
    expect(await deprovisionForOffboarding(warehouseWorker)).toBe(0);
  });
});

describe('the exception report', () => {
  it('flags a leaver whose access was never revoked, with how long it has been', async () => {
    await testDb.appAccessGrant.create({ data: { appId: p21Id, workerId: leaver } });
    await testDb.worker.update({
      where: { id: leaver },
      data: { status: 'TERMINATED', terminationDate: new Date(Date.now() - 45 * 86_400_000) },
    });

    const exceptions = await accessExceptions();
    const finding = exceptions.find((e) => e.kind === 'STILL_HAS_ACCESS_AFTER_LEAVING');
    expect(finding).toBeDefined();
    expect(finding!.workerId).toBe(leaver);
    expect(finding!.daysOutstanding).toBeGreaterThanOrEqual(44);
    // Leavers sort to the top — it is the finding an auditor opens with.
    expect(exceptions[0].kind).toBe('STILL_HAS_ACCESS_AFTER_LEAVING');
  });

  it('clears once the grant is revoked', async () => {
    const grant = await testDb.appAccessGrant.create({ data: { appId: p21Id, workerId: leaver } });
    await testDb.worker.update({
      where: { id: leaver },
      data: { status: 'TERMINATED', terminationDate: new Date() },
    });
    expect((await accessExceptions()).some((e) => e.kind === 'STILL_HAS_ACCESS_AFTER_LEAVING')).toBe(true);

    await testDb.appAccessGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
    expect((await accessExceptions()).some((e) => e.kind === 'STILL_HAS_ACCESS_AFTER_LEAVING')).toBe(false);
  });

  it('flags a required entitlement that was never granted', async () => {
    const exceptions = await accessExceptions();
    const missing = exceptions.filter((e) => e.kind === 'MISSING_ENTITLEMENT' && e.workerId === warehouseWorker);
    expect(missing).toHaveLength(1); // Prophet 21 is required; Teams is optional
    expect(missing[0].appId).toBe(p21Id);
  });

  it('flags a grant no profile accounts for', async () => {
    await testDb.appAccessGrant.create({ data: { appId: crmId, workerId: warehouseWorker } });
    const exceptions = await accessExceptions();
    const extra = exceptions.find((e) => e.kind === 'ACCESS_WITHOUT_PROFILE' && e.appId === crmId);
    expect(extra).toBeDefined();
  });

  it('does not call every grant an exception when no profile covers the worker', async () => {
    await testDb.appAccessGrant.create({ data: { appId: crmId, workerId: salesWorker } });
    const exceptions = await accessExceptions();
    expect(exceptions.some((e) => e.workerId === salesWorker)).toBe(false);
  });
});

describe('the evidence log', () => {
  it('is append-only', async () => {
    await provisionForOnboarding(warehouseWorker);
    const event = await testDb.accessEvent.findFirstOrThrow();
    await expect(
      testDb.accessEvent.update({ where: { id: event.id }, data: { action: 'GRANTED' } }),
    ).rejects.toThrow();
    await expect(testDb.accessEvent.delete({ where: { id: event.id } })).rejects.toThrow();
  });

  it('keeps the application name even if the application record goes away', async () => {
    await provisionForOnboarding(warehouseWorker);
    const event = await testDb.accessEvent.findFirstOrThrow({ where: { appId: p21Id } });
    expect(event.appName).toBe('Prophet 21');
  });
});
