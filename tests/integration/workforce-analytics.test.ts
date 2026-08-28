import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb, resetDatabase, seedRoles, seedOrg, makeWorker, ctxFor, type Fixture } from '../helpers/db';
import { can, type Ctx } from '@/lib/authz';
import { earlyAttritionCohorts, timeToFill, compaRatios, retentionSignals } from '@/lib/analytics/workforce';

let fixture: Fixture;
let hr: Ctx, exec: Ctx, finance: Ctx, manager: Ctx, employee: Ctx, recruiter: Ctx;
let underpaidId: string;

const ago = (days: number) => new Date(Date.now() - days * 86_400_000);

beforeAll(async () => {
  await resetDatabase();
  await seedRoles();
  fixture = await seedOrg();

  const hrRow = await makeWorker({ fixture, email: 'hr@wf.test', roleKeys: ['HR_ADMIN'] });
  const execRow = await makeWorker({ fixture, email: 'exec@wf.test', roleKeys: ['EXECUTIVE'] });
  const finRow = await makeWorker({ fixture, email: 'fin@wf.test', roleKeys: ['FINANCE'] });
  const mgrRow = await makeWorker({ fixture, email: 'mgr@wf.test', roleKeys: ['MANAGER', 'EMPLOYEE'] });
  const empRow = await makeWorker({ fixture, email: 'emp@wf.test', roleKeys: ['EMPLOYEE'], managerId: mgrRow.workerId });
  const recRow = await makeWorker({ fixture, email: 'rec@wf.test', roleKeys: ['RECRUITER'] });
  hr = await ctxFor(hrRow.userId);
  exec = await ctxFor(execRow.userId);
  finance = await ctxFor(finRow.userId);
  manager = await ctxFor(mgrRow.userId);
  employee = await ctxFor(empRow.userId);
  recruiter = await ctxFor(recRow.userId);

  // A band to compare pay against, and someone paid below its floor.
  await testDb.salaryBand.create({
    data: { jobFamily: 'Warehouse', jobLevel: 'IC1', geography: 'US', minAmount: 40000, midAmount: 46000, maxAmount: 54000 },
  });
  const underpaid = await makeWorker({
    fixture, email: 'underpaid@wf.test', roleKeys: ['EMPLOYEE'], managerId: mgrRow.workerId,
    hireDate: ago(1200), amount: 34000,
  });
  underpaidId = underpaid.workerId;
  await testDb.employmentRecord.updateMany({
    where: { workerId: underpaidId },
    data: { jobFamily: 'Warehouse', jobLevel: 'IC1' },
  });

  // Two early leavers and one who stayed, all hired well in the past so the
  // cohort has matured past its own 90-day window.
  for (const [i, servedDays] of [[0, 40], [1, 60], [2, 900]] as const) {
    const w = await makeWorker({
      fixture, email: `cohort${i}@wf.test`, roleKeys: ['EMPLOYEE'], hireDate: ago(700),
    });
    if (servedDays < 90) {
      await testDb.worker.update({
        where: { id: w.workerId },
        data: { status: 'TERMINATED', terminationDate: ago(700 - servedDays), voluntaryTermination: true },
      });
    }
  }
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe('early attrition cohorts', () => {
  it('computes a 90-day rate for a matured cohort', async () => {
    const rows = await earlyAttritionCohorts({ quarters: 12 });
    const withHires = rows.filter((r) => r.hired > 0);
    expect(withHires.length).toBeGreaterThan(0);
    const cohort = withHires.find((r) => r.leftWithin90Days > 0);
    expect(cohort).toBeDefined();
    expect(cohort!.ninetyDayAttritionPct).not.toBeNull();
    expect(cohort!.ninetyDayAttritionPct!).toBeGreaterThan(0);
  });

  it('reports “too early” rather than zero for a cohort inside its own window', async () => {
    await makeWorker({ fixture, email: 'brandnew@wf.test', roleKeys: ['EMPLOYEE'], hireDate: new Date() });
    const rows = await earlyAttritionCohorts({ quarters: 12 });
    const thisQuarter = rows.at(-1)!;
    expect(thisQuarter.hired).toBeGreaterThan(0);
    expect(thisQuarter.ninetyDayAttritionPct).toBeNull();
  });

  it('counts a leaver in the cohort they were hired into, not the one they left in', async () => {
    const rows = await earlyAttritionCohorts({ quarters: 12 });
    const total = rows.reduce((s, r) => s + r.leftWithin90Days, 0);
    expect(total).toBe(2);
  });
});

describe('time to fill', () => {
  it('measures from opening the requisition to the accepted offer', async () => {
    const stage = await testDb.pipelineStage.create({ data: { name: 'Applied', order: 1 } });
    const job = await testDb.jobRequisition.create({
      data: { title: 'Picker', status: 'FILLED', departmentId: fixture.departmentId, openedAt: ago(40) },
    });
    const candidate = await testDb.candidate.create({ data: { firstName: 'Pat', lastName: 'Quinn' } });
    const application = await testDb.application.create({
      data: { candidateId: candidate.id, requisitionId: job.id, stageId: stage.id },
    });
    await testDb.offer.create({
      data: {
        applicationId: application.id, requisitionId: job.id,
        title: 'Picker', amount: 42000, rateType: 'ANNUAL', status: 'ACCEPTED', respondedAt: ago(10),
      },
    });

    const rows = await timeToFill();
    const row = rows.find((r) => r.filled > 0)!;
    expect(row.medianDays).toBeCloseTo(30, 0);
  });

  it('tracks how long open requisitions have been waiting', async () => {
    await testDb.jobRequisition.create({
      data: { title: 'Driver', status: 'OPEN', departmentId: fixture.departmentId, openedAt: ago(75) },
    });
    const rows = await timeToFill();
    const row = rows.find((r) => r.openNow > 0)!;
    expect(row.oldestOpenDays).toBeGreaterThanOrEqual(74);
  });
});

describe('pay position', () => {
  it('identifies someone paid below their band minimum', async () => {
    const rows = await compaRatios();
    const row = rows.find((r) => r.workerId === underpaidId);
    expect(row).toBeDefined();
    expect(row!.position).toBe('BELOW_MIN');
    expect(row!.compaRatio).toBeCloseTo(34000 / 46000, 2);
  });

  it('annualises an hourly rate before comparing to an annual band', async () => {
    const hourly = await makeWorker({
      fixture, email: 'hourly@wf.test', roleKeys: ['EMPLOYEE'], amount: 22,
    });
    await testDb.employmentRecord.updateMany({
      where: { workerId: hourly.workerId }, data: { jobFamily: 'Warehouse', jobLevel: 'IC1' },
    });
    await testDb.compensation.updateMany({ where: { workerId: hourly.workerId }, data: { rateType: 'HOURLY' } });

    const row = (await compaRatios()).find((r) => r.workerId === hourly.workerId)!;
    expect(row.amount).toBe(22 * 2080); // 45,760 — inside the band, not below it
    expect(row.position).toBe('IN_RANGE');
  });

  it('skips workers with no band defined for their role rather than guessing', async () => {
    const rows = await compaRatios();
    // Everyone in the default fixture is "Operations Associate" with no band.
    expect(rows.every((r) => r.jobFamily === 'Warehouse')).toBe(true);
  });
});

describe('retention signals', () => {
  it('flags the underpaid long-tenured worker and explains why', async () => {
    const rows = await retentionSignals();
    const row = rows.find((r) => r.workerId === underpaidId)!;
    expect(row.signal.factors.map((f) => f.id)).toContain('below_band');
    expect(row.signal.band).not.toBe('LOW');
    for (const factor of row.signal.factors) {
      expect(factor.suggestion).toBeTruthy();
    }
  });

  it('never returns anyone who has left', async () => {
    const rows = await retentionSignals();
    const ids = rows.map((r) => r.workerId);
    const terminated = await testDb.worker.findMany({ where: { status: 'TERMINATED' }, select: { id: true } });
    for (const t of terminated) expect(ids).not.toContain(t.id);
  });

  it('can be scoped to one manager’s reports', async () => {
    const mgrWorker = await testDb.worker.findFirstOrThrow({ where: { workEmail: 'mgr@wf.test' } });
    const rows = await retentionSignals({ managerId: mgrWorker.id });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.workerId)).toContain(underpaidId);
    expect(rows.map((r) => r.workerId)).not.toContain(mgrWorker.id);
  });
});

describe('who may see workforce analytics', () => {
  it('is limited to HR, executives and finance', () => {
    expect(can(hr, 'insights.workforce')).toBe(true);
    expect(can(exec, 'insights.workforce')).toBe(true);
    expect(can(finance, 'insights.workforce')).toBe(true);
  });

  it('is not available to managers, recruiters or employees', () => {
    expect(can(manager, 'insights.workforce')).toBe(false);
    expect(can(recruiter, 'insights.workforce')).toBe(false);
    expect(can(employee, 'insights.workforce')).toBe(false);
  });
});
