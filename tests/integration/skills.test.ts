import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testDb, resetDatabase, seedRoles, seedOrg, makeWorker, ctxFor, type Fixture } from '../helpers/db';
import { can, type Ctx } from '@/lib/authz';
import { skillCoverage, expiringCertifications, skillGapForWorker } from '@/lib/skills';

let fixture: Fixture;
let hr: Ctx, manager: Ctx, employee: Ctx, itAdmin: Ctx;
let forkliftId: string, osha: string, erp: string;
let alice: string, bob: string, carol: string;

const days = (n: number) => new Date(Date.now() + n * 86_400_000);

beforeAll(async () => {
  await resetDatabase();
  await seedRoles();
  fixture = await seedOrg();
  const hrRow = await makeWorker({ fixture, email: 'hr@skills.test', roleKeys: ['HR_ADMIN'] });
  const mgrRow = await makeWorker({ fixture, email: 'mgr@skills.test', roleKeys: ['MANAGER', 'EMPLOYEE'] });
  const a = await makeWorker({ fixture, email: 'alice@skills.test', roleKeys: ['EMPLOYEE'], managerId: mgrRow.workerId });
  const b = await makeWorker({ fixture, email: 'bob@skills.test', roleKeys: ['EMPLOYEE'], managerId: mgrRow.workerId });
  const c = await makeWorker({ fixture, email: 'carol@skills.test', roleKeys: ['EMPLOYEE'] });
  const it = await makeWorker({ fixture, email: 'it@skills.test', roleKeys: ['IT_ADMIN'] });
  alice = a.workerId; bob = b.workerId; carol = c.workerId;
  hr = await ctxFor(hrRow.userId);
  manager = await ctxFor(mgrRow.userId);
  employee = await ctxFor(a.userId);
  itAdmin = await ctxFor(it.userId);
});

afterAll(async () => {
  await testDb.$disconnect();
});

beforeEach(async () => {
  await testDb.workerSkill.deleteMany();
  await testDb.jobSkillRequirement.deleteMany();
  await testDb.skill.deleteMany();
  const forklift = await testDb.skill.create({
    data: { name: 'Forklift (sit-down)', category: 'EQUIPMENT', isCertification: true, isCritical: true, validityMonths: 36 },
  });
  const oshaSkill = await testDb.skill.create({
    data: { name: 'OSHA 30', category: 'SAFETY', isCertification: true, isCritical: true, validityMonths: 60 },
  });
  const erpSkill = await testDb.skill.create({
    data: { name: 'Prophet 21', category: 'SYSTEM', isCertification: false, isCritical: false },
  });
  forkliftId = forklift.id; osha = oshaSkill.id; erp = erpSkill.id;
});

describe('coverage risk', () => {
  it('flags a critical skill nobody holds as uncovered', async () => {
    const rows = await skillCoverage();
    const forklift = rows.find((r) => r.skillId === forkliftId)!;
    expect(forklift.risk).toBe('UNCOVERED');
    expect(forklift.coveredBy).toBe(0);
  });

  it('flags exactly one verified holder as a single point of failure', async () => {
    await testDb.workerSkill.create({
      data: { workerId: alice, skillId: forkliftId, level: 4, verifiedAt: new Date(), verifiedById: hr.userId, expiresAt: days(400) },
    });
    const rows = await skillCoverage();
    expect(rows.find((r) => r.skillId === forkliftId)!.risk).toBe('SINGLE_POINT');
  });

  it('calls two holders thin, and three or more no risk', async () => {
    for (const w of [alice, bob]) {
      await testDb.workerSkill.create({
        data: { workerId: w, skillId: forkliftId, level: 4, verifiedAt: new Date(), verifiedById: hr.userId, expiresAt: days(400) },
      });
    }
    expect((await skillCoverage()).find((r) => r.skillId === forkliftId)!.risk).toBe('THIN');

    await testDb.workerSkill.create({
      data: { workerId: carol, skillId: forkliftId, level: 3, verifiedAt: new Date(), verifiedById: hr.userId, expiresAt: days(400) },
    });
    expect((await skillCoverage()).find((r) => r.skillId === forkliftId)!.risk).toBe('NONE');
  });

  it('does not count an unverified claim on a critical skill', async () => {
    await testDb.workerSkill.create({ data: { workerId: alice, skillId: forkliftId, level: 5, expiresAt: days(400) } });
    const row = (await skillCoverage()).find((r) => r.skillId === forkliftId)!;
    expect(row.claimedBy).toBe(1);
    expect(row.coveredBy).toBe(0);
    expect(row.risk).toBe('UNCOVERED');
  });

  it('does not count a lapsed certification, and reports it as expired', async () => {
    await testDb.workerSkill.create({
      data: { workerId: alice, skillId: forkliftId, level: 4, verifiedAt: new Date(), verifiedById: hr.userId, expiresAt: days(-5) },
    });
    const row = (await skillCoverage()).find((r) => r.skillId === forkliftId)!;
    expect(row.coveredBy).toBe(0);
    expect(row.expired).toBe(1);
    expect(row.risk).toBe('UNCOVERED');
  });

  it('drops coverage when the only holder is terminated', async () => {
    await testDb.workerSkill.create({
      data: { workerId: alice, skillId: forkliftId, level: 4, verifiedAt: new Date(), verifiedById: hr.userId, expiresAt: days(400) },
    });
    expect((await skillCoverage()).find((r) => r.skillId === forkliftId)!.coveredBy).toBe(1);

    await testDb.worker.update({ where: { id: alice }, data: { status: 'TERMINATED' } });
    expect((await skillCoverage()).find((r) => r.skillId === forkliftId)!.coveredBy).toBe(0);
    await testDb.worker.update({ where: { id: alice }, data: { status: 'ACTIVE' } });
  });

  it('never reports risk for a skill that is not marked critical', async () => {
    const row = (await skillCoverage()).find((r) => r.skillId === erp)!;
    expect(row.coveredBy).toBe(0);
    expect(row.risk).toBe('NONE');
  });
});

describe('expiring certifications', () => {
  it('lists lapsing and lapsed credentials, soonest first', async () => {
    await testDb.workerSkill.create({ data: { workerId: alice, skillId: forkliftId, level: 4, expiresAt: days(30) } });
    await testDb.workerSkill.create({ data: { workerId: bob, skillId: osha, level: 4, expiresAt: days(-2) } });
    await testDb.workerSkill.create({ data: { workerId: carol, skillId: forkliftId, level: 4, expiresAt: days(900) } });

    const rows = await expiringCertifications();
    expect(rows).toHaveLength(2);
    expect(rows[0].workerId).toBe(bob); // already expired sorts first
  });

  it('ignores people who have left', async () => {
    await testDb.workerSkill.create({ data: { workerId: alice, skillId: forkliftId, level: 4, expiresAt: days(10) } });
    await testDb.worker.update({ where: { id: alice }, data: { status: 'TERMINATED' } });
    expect(await expiringCertifications()).toHaveLength(0);
    await testDb.worker.update({ where: { id: alice }, data: { status: 'ACTIVE' } });
  });
});

describe('skill gap against a requisition', () => {
  it('reports which requirements a person meets', async () => {
    const job = await testDb.jobRequisition.create({ data: { title: 'Warehouse Lead', status: 'OPEN' } });
    await testDb.jobSkillRequirement.create({ data: { requisitionId: job.id, skillId: forkliftId, minLevel: 3 } });
    await testDb.jobSkillRequirement.create({ data: { requisitionId: job.id, skillId: erp, minLevel: 4, required: false } });
    await testDb.workerSkill.create({ data: { workerId: alice, skillId: forkliftId, level: 4, expiresAt: days(400) } });
    await testDb.workerSkill.create({ data: { workerId: alice, skillId: erp, level: 2 } });

    const gaps = await skillGapForWorker(alice, job.id);
    expect(gaps.find((g) => g.skillId === forkliftId)!.met).toBe(true);
    expect(gaps.find((g) => g.skillId === erp)!.met).toBe(false);
    expect(gaps.find((g) => g.skillId === erp)!.required).toBe(false);
  });

  it('treats a lapsed certification as not met', async () => {
    const job = await testDb.jobRequisition.create({ data: { title: 'Driver', status: 'OPEN' } });
    await testDb.jobSkillRequirement.create({ data: { requisitionId: job.id, skillId: forkliftId, minLevel: 3 } });
    await testDb.workerSkill.create({ data: { workerId: alice, skillId: forkliftId, level: 5, expiresAt: days(-1) } });

    const gaps = await skillGapForWorker(alice, job.id);
    expect(gaps[0].met).toBe(false);
    expect(gaps[0].workerLevel).toBeNull();
  });
});

describe('who may see and manage skills', () => {
  it('gives read to HR, managers and IT, but not to an ordinary employee', () => {
    expect(can(hr, 'skills.read')).toBe(true);
    expect(can(manager, 'skills.read')).toBe(true);
    expect(can(itAdmin, 'skills.read')).toBe(true);
    expect(can(employee, 'skills.read')).toBe(false);
  });

  it('restricts catalog management and verification to skills.admin', () => {
    expect(can(hr, 'skills.admin')).toBe(true);
    expect(can(manager, 'skills.admin')).toBe(false);
    expect(can(itAdmin, 'skills.admin')).toBe(false);
    expect(can(employee, 'skills.admin')).toBe(false);
  });
});
