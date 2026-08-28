import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testDb, resetDatabase, seedRoles, seedOrg, makeWorker, ctxFor, type Fixture } from '../helpers/db';
import { can, isManagerOf, type Ctx } from '@/lib/authz';
import { applyCycle, budgetRollUp, populateCycle, increasePct, annualise, payEquityGroups } from '@/lib/comp-cycle';

let fixture: Fixture;
let hr: Ctx, finance: Ctx, manager: Ctx, otherManager: Ctx, employee: Ctx;
let managerWorkerId: string, otherManagerWorkerId: string;
let reportA: string, reportB: string, outsiderId: string;
let cycleId: string;

beforeAll(async () => {
  await resetDatabase();
  await seedRoles();
  fixture = await seedOrg();

  const hrRow = await makeWorker({ fixture, email: 'hr@cc.test', roleKeys: ['HR_ADMIN'] });
  const finRow = await makeWorker({ fixture, email: 'fin@cc.test', roleKeys: ['FINANCE'] });
  const mgrRow = await makeWorker({ fixture, email: 'mgr@cc.test', roleKeys: ['MANAGER', 'EMPLOYEE'] });
  const mgr2Row = await makeWorker({ fixture, email: 'mgr2@cc.test', roleKeys: ['MANAGER', 'EMPLOYEE'] });
  managerWorkerId = mgrRow.workerId;
  otherManagerWorkerId = mgr2Row.workerId;

  const a = await makeWorker({
    fixture, email: 'a@cc.test', roleKeys: ['EMPLOYEE'], managerId: mgrRow.workerId,
    hireDate: new Date('2020-01-06'), amount: 60000,
  });
  const b = await makeWorker({
    fixture, email: 'b@cc.test', roleKeys: ['EMPLOYEE'], managerId: mgrRow.workerId,
    hireDate: new Date('2021-03-01'), amount: 50000,
  });
  const outsider = await makeWorker({
    fixture, email: 'out@cc.test', roleKeys: ['EMPLOYEE'], managerId: mgr2Row.workerId,
    hireDate: new Date('2019-05-01'), amount: 70000,
  });
  reportA = a.workerId; reportB = b.workerId; outsiderId = outsider.workerId;

  hr = await ctxFor(hrRow.userId);
  finance = await ctxFor(finRow.userId);
  manager = await ctxFor(mgrRow.userId);
  otherManager = await ctxFor(mgr2Row.userId);
  employee = await ctxFor(a.userId);
});

afterAll(async () => {
  await testDb.$disconnect();
});

beforeEach(async () => {
  await testDb.compProposal.deleteMany();
  await testDb.compCycleBudget.deleteMany();
  await testDb.compCycle.deleteMany();
  const cycle = await testDb.compCycle.create({
    data: {
      name: 'FY27 merit',
      effectiveDate: new Date('2027-01-01T00:00:00Z'),
      budgetPct: 3.5,
      eligibility: { minTenureMonths: 6, workerTypes: ['EMPLOYEE'] },
    },
  });
  cycleId = cycle.id;
});

describe('building the population', () => {
  it('adds every eligible active worker exactly once', async () => {
    const first = await populateCycle(cycleId);
    expect(first).toBeGreaterThan(0);
    const second = await populateCycle(cycleId);
    expect(second).toBe(0); // re-running adds nobody twice
    const count = await testDb.compProposal.count({ where: { cycleId } });
    expect(count).toBe(first);
  });

  it('excludes anyone below the minimum tenure', async () => {
    const brandNew = await makeWorker({
      fixture, email: `new-${Date.now()}@cc.test`, roleKeys: ['EMPLOYEE'], hireDate: new Date(), amount: 45000,
    });
    await populateCycle(cycleId);
    const proposal = await testDb.compProposal.findFirst({ where: { cycleId, workerId: brandNew.workerId } });
    expect(proposal).toBeNull();
  });

  it('snapshots current pay so a mid-cycle change cannot shift the roll-up', async () => {
    await populateCycle(cycleId);
    const before = await testDb.compProposal.findFirstOrThrow({ where: { cycleId, workerId: reportA } });
    expect(Number(before.currentAmount)).toBe(60000);

    await testDb.compensation.updateMany({ where: { workerId: reportA, effectiveTo: null }, data: { amount: 99000 } });
    const after = await testDb.compProposal.findFirstOrThrow({ where: { cycleId, workerId: reportA } });
    expect(Number(after.currentAmount)).toBe(60000);
    await testDb.compensation.updateMany({ where: { workerId: reportA, effectiveTo: null }, data: { amount: 60000 } });
  });
});

describe('budget roll-up', () => {
  beforeEach(async () => {
    await populateCycle(cycleId);
    await testDb.compCycleBudget.create({ data: { cycleId, managerId: managerWorkerId, amount: 5000 } });
  });

  it('counts drafts as well as submitted proposals', async () => {
    await testDb.compProposal.updateMany({
      where: { cycleId, workerId: reportA },
      data: { proposedAmount: 63000, status: 'DRAFT' },
    });
    const rows = await budgetRollUp(cycleId);
    const row = rows.find((r) => r.managerId === managerWorkerId)!;
    expect(row.proposed).toBe(3000);
    expect(row.remaining).toBe(2000);
    expect(row.overBudget).toBe(false);
  });

  it('flags an overspend', async () => {
    await testDb.compProposal.updateMany({ where: { cycleId, workerId: reportA }, data: { proposedAmount: 66000 } });
    await testDb.compProposal.updateMany({ where: { cycleId, workerId: reportB }, data: { proposedAmount: 53000 } });
    const row = (await budgetRollUp(cycleId)).find((r) => r.managerId === managerWorkerId)!;
    expect(row.proposed).toBe(9000);
    expect(row.overBudget).toBe(true);
    expect(row.remaining).toBeLessThan(0);
  });

  it('ignores rejected proposals', async () => {
    await testDb.compProposal.updateMany({
      where: { cycleId, workerId: reportA },
      data: { proposedAmount: 66000, status: 'REJECTED' },
    });
    const row = (await budgetRollUp(cycleId)).find((r) => r.managerId === managerWorkerId)!;
    expect(row.proposed).toBe(0);
  });

  it('annualises an hourly proposal before charging it to the budget', async () => {
    await testDb.compProposal.updateMany({
      where: { cycleId, workerId: reportB },
      data: { rateType: 'HOURLY', currentAmount: 20, proposedAmount: 21 },
    });
    const row = (await budgetRollUp(cycleId)).find((r) => r.managerId === managerWorkerId)!;
    expect(row.proposed).toBe(2080); // one dollar an hour across a year
  });
});

describe('applying a cycle', () => {
  beforeEach(async () => {
    // Applying writes real pay history, so reset this worker to a single
    // opening row between tests — otherwise rows accumulate across cases.
    await testDb.compensation.deleteMany({ where: { workerId: reportA } });
    await testDb.compensation.create({
      data: {
        workerId: reportA, amount: 60000, currency: 'USD', rateType: 'ANNUAL',
        reason: 'HIRE', effectiveFrom: new Date('2020-01-06T00:00:00Z'),
      },
    });
    await populateCycle(cycleId);
    await testDb.compProposal.updateMany({
      where: { cycleId, workerId: reportA },
      data: { proposedAmount: 63000, status: 'APPROVED', decidedById: hr.userId },
    });
  });

  it('refuses to apply a cycle that has not been approved', async () => {
    await expect(applyCycle(cycleId, hr.userId)).rejects.toThrow(/approved/i);
  });

  it('closes the old compensation row and opens a new one', async () => {
    await testDb.compCycle.update({ where: { id: cycleId }, data: { status: 'APPROVED' } });
    const result = await applyCycle(cycleId, hr.userId);
    expect(result.applied).toBe(1);

    const rows = await testDb.compensation.findMany({
      where: { workerId: reportA },
      orderBy: { effectiveFrom: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].effectiveTo).not.toBeNull(); // history preserved, not overwritten
    expect(rows[1].effectiveTo).toBeNull();
    expect(Number(rows[1].amount)).toBe(63000);
    expect(rows[1].effectiveFrom.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    // The closing date is the day before the new row opens — no gap, no overlap.
    expect(rows[0].effectiveTo!.toISOString()).toBe('2026-12-31T00:00:00.000Z');
  });

  it('is idempotent — applying twice does not pay someone twice', async () => {
    await testDb.compCycle.update({ where: { id: cycleId }, data: { status: 'APPROVED' } });
    await applyCycle(cycleId, hr.userId);

    // Force the cycle back to APPROVED to simulate a retried job.
    await testDb.compCycle.update({ where: { id: cycleId }, data: { status: 'APPROVED' } });
    const second = await applyCycle(cycleId, hr.userId);
    expect(second.applied).toBe(0);

    const rows = await testDb.compensation.findMany({ where: { workerId: reportA } });
    expect(rows).toHaveLength(2);
  });

  it('refuses a proposal already stamped applied even if its status is reset', async () => {
    await testDb.compCycle.update({ where: { id: cycleId }, data: { status: 'APPROVED' } });
    await applyCycle(cycleId, hr.userId);

    // Somebody edits the row back to APPROVED by hand. appliedAt still stands.
    await testDb.compProposal.updateMany({
      where: { cycleId, workerId: reportA },
      data: { status: 'APPROVED' },
    });
    await testDb.compCycle.update({ where: { id: cycleId }, data: { status: 'APPROVED' } });
    const third = await applyCycle(cycleId, hr.userId);
    expect(third.applied).toBe(0);
    expect(third.skipped).toBe(1);
    expect(await testDb.compensation.count({ where: { workerId: reportA } })).toBe(2);
  });

  it('never applies a proposal that was only submitted', async () => {
    await testDb.compProposal.updateMany({
      where: { cycleId, workerId: reportB },
      data: { proposedAmount: 52000, status: 'SUBMITTED' },
    });
    await testDb.compCycle.update({ where: { id: cycleId }, data: { status: 'APPROVED' } });
    await applyCycle(cycleId, hr.userId);

    const rows = await testDb.compensation.findMany({ where: { workerId: reportB } });
    expect(rows).toHaveLength(1); // untouched
  });

  it('skips an approved proposal with no amount rather than writing a null', async () => {
    await testDb.compProposal.updateMany({
      where: { cycleId, workerId: reportB },
      data: { proposedAmount: null, status: 'APPROVED' },
    });
    await testDb.compCycle.update({ where: { id: cycleId }, data: { status: 'APPROVED' } });
    const result = await applyCycle(cycleId, hr.userId);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(await testDb.compensation.count({ where: { workerId: reportB } })).toBe(1);
  });
});

describe('who may do what', () => {
  it('lets managers plan but not approve', () => {
    expect(can(manager, 'comp.cycle')).toBe(true);
    expect(can(manager, 'comp.write')).toBe(false);
    expect(can(manager, 'comp.equity')).toBe(false);
  });

  it('gives HR and finance the approve and equity permissions', () => {
    for (const ctx of [hr, finance]) {
      expect(can(ctx, 'comp.write')).toBe(true);
      expect(can(ctx, 'comp.equity')).toBe(true);
    }
  });

  it('keeps comp planning away from ordinary employees', () => {
    expect(can(employee, 'comp.cycle')).toBe(false);
    expect(can(employee, 'comp.read')).toBe(false);
  });

  it('scopes a manager to their own reports', async () => {
    expect(await isManagerOf(manager, reportA)).toBe(true);
    expect(await isManagerOf(manager, reportB)).toBe(true);
    // The core boundary: another manager's report is out of reach.
    expect(await isManagerOf(manager, outsiderId)).toBe(false);
    expect(await isManagerOf(otherManager, reportA)).toBe(false);
  });
});

describe('pay equity grouping', () => {
  it('reports spread within a job family and level, not between people', async () => {
    await testDb.salaryBand.create({
      data: { jobFamily: 'Ops', jobLevel: 'IC2', geography: 'US', minAmount: 45000, midAmount: 55000, maxAmount: 65000 },
    });
    for (const [workerId, amount] of [[reportA, 50000], [reportB, 65000]] as const) {
      await testDb.employmentRecord.updateMany({ where: { workerId }, data: { jobFamily: 'Ops', jobLevel: 'IC2' } });
      await testDb.compensation.updateMany({ where: { workerId, effectiveTo: null }, data: { amount } });
    }
    const groups = await payEquityGroups();
    const group = groups.find((g) => g.jobFamily === 'Ops' && g.jobLevel === 'IC2')!;
    expect(group.headcount).toBe(2);
    expect(group.spread).toBeCloseTo(1.3, 1);
    expect(group.medianCompaRatio).toBeCloseTo((50000 / 55000 + 65000 / 55000) / 2, 2);
  });

  it('reports no spread for a level with one person in it', async () => {
    await testDb.salaryBand.create({
      data: { jobFamily: 'Solo', jobLevel: 'IC1', geography: 'US', minAmount: 40000, midAmount: 50000, maxAmount: 60000 },
    });
    await testDb.employmentRecord.updateMany({ where: { workerId: outsiderId }, data: { jobFamily: 'Solo', jobLevel: 'IC1' } });
    const group = (await payEquityGroups()).find((g) => g.jobFamily === 'Solo')!;
    expect(group.headcount).toBe(1);
    expect(group.spread).toBeNull();
  });
});

describe('increase maths', () => {
  it('computes a percentage increase', () => {
    expect(increasePct(60000, 63000)).toBe(5);
    expect(increasePct(60000, null)).toBeNull();
    expect(increasePct(0, 100)).toBeNull();
  });

  it('annualises by rate type', () => {
    expect(annualise(20, 'HOURLY')).toBe(41600);
    expect(annualise(5000, 'MONTHLY')).toBe(60000);
    expect(annualise(60000, 'ANNUAL')).toBe(60000);
  });
});
