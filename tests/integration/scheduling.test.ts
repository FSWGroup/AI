import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testDb, resetDatabase, seedRoles, seedOrg, makeWorker, ctxFor, type Fixture } from '../helpers/db';
import { can, type Ctx } from '@/lib/authz';
import { projectOvertime, weeklyBreakFindings, scheduledLaborCost, weekStart } from '@/lib/scheduling';

let fixture: Fixture;
let manager: Ctx, employee: Ctx, hr: Ctx;
let hourlyId: string, exemptId: string;

/** A fixed future Monday, so tests never straddle "now". */
const MONDAY = new Date('2027-03-01T00:00:00Z');
const dayAt = (dayOffset: number, hour: number) =>
  new Date(MONDAY.getTime() + dayOffset * 86_400_000 + hour * 3_600_000);

beforeAll(async () => {
  await resetDatabase();
  await seedRoles();
  fixture = await seedOrg();
  const mgrRow = await makeWorker({ fixture, email: 'mgr@sch.test', roleKeys: ['MANAGER', 'EMPLOYEE'] });
  const hrRow = await makeWorker({ fixture, email: 'hr@sch.test', roleKeys: ['HR_ADMIN'] });
  const hourly = await makeWorker({
    fixture, email: 'hourly@sch.test', roleKeys: ['EMPLOYEE'], managerId: mgrRow.workerId, amount: 22,
  });
  const exempt = await makeWorker({
    fixture, email: 'exempt@sch.test', roleKeys: ['EMPLOYEE'], managerId: mgrRow.workerId, amount: 90000,
  });
  hourlyId = hourly.workerId;
  exemptId = exempt.workerId;

  await testDb.compensation.updateMany({ where: { workerId: hourlyId }, data: { rateType: 'HOURLY' } });
  await testDb.employmentRecord.updateMany({ where: { workerId: hourlyId }, data: { flsaStatus: 'NON_EXEMPT', payBasis: 'HOURLY' } });
  await testDb.employmentRecord.updateMany({ where: { workerId: exemptId }, data: { flsaStatus: 'EXEMPT' } });

  manager = await ctxFor(mgrRow.userId);
  hr = await ctxFor(hrRow.userId);
  employee = await ctxFor(hourly.userId);

  await testDb.breakRule.create({
    data: {
      jurisdiction: 'US-PA', name: '30-minute meal after 6 hours',
      afterMinutes: 360, breakMinutes: 30, kind: 'MEAL', paid: false,
      sourceUrl: 'https://example.invalid/pa',
    },
  });
});

afterAll(async () => {
  await testDb.$disconnect();
});

beforeEach(async () => {
  await testDb.shiftAssignment.deleteMany();
  await testDb.shift.deleteMany();
  await testDb.timesheet.deleteMany();
});

async function makeShift(opts: {
  dayOffset: number; startHour: number; endHour: number; breakMinutes?: number;
  status?: string; workerId?: string;
}) {
  const shift = await testDb.shift.create({
    data: {
      date: new Date(MONDAY.getTime() + opts.dayOffset * 86_400_000),
      startsAt: dayAt(opts.dayOffset, opts.startHour),
      endsAt: dayAt(opts.dayOffset, opts.endHour),
      breakMinutes: opts.breakMinutes ?? 30,
      status: opts.status ?? 'PUBLISHED',
      locationId: fixture.locationId,
      role: 'Picker',
    },
  });
  if (opts.workerId) {
    await testDb.shiftAssignment.create({ data: { shiftId: shift.id, workerId: opts.workerId } });
  }
  return shift;
}

describe('overtime forecasting', () => {
  it('projects scheduled hours and flags the overage before it happens', async () => {
    // Five 8.5-hour shifts with a 30-minute break = 40 hours, plus one more.
    for (let d = 0; d < 5; d++) {
      await makeShift({ dayOffset: d, startHour: 6, endHour: 14.5, workerId: hourlyId });
    }
    await makeShift({ dayOffset: 5, startHour: 6, endHour: 12, workerId: hourlyId });

    const rows = await projectOvertime(MONDAY);
    const row = rows.find((r) => r.workerId === hourlyId)!;
    expect(row.scheduledHours).toBeCloseTo(45.5, 1);
    expect(row.overtimeHours).toBeCloseTo(5.5, 1);
    expect(row.countsForOvertime).toBe(true);
  });

  it('does not accrue overtime for an exempt employee', async () => {
    for (let d = 0; d < 6; d++) {
      await makeShift({ dayOffset: d, startHour: 6, endHour: 16, workerId: exemptId });
    }
    const row = (await projectOvertime(MONDAY)).find((r) => r.workerId === exemptId)!;
    expect(row.projectedHours).toBeGreaterThan(40);
    expect(row.overtimeHours).toBe(0);
    expect(row.countsForOvertime).toBe(false);
  });

  it('ignores draft shifts — a schedule nobody has seen is not a commitment', async () => {
    for (let d = 0; d < 6; d++) {
      await makeShift({ dayOffset: d, startHour: 6, endHour: 16, status: 'DRAFT', workerId: hourlyId });
    }
    const rows = await projectOvertime(MONDAY);
    expect(rows.find((r) => r.workerId === hourlyId)).toBeUndefined();
  });

  it('adds hours already worked to hours still scheduled', async () => {
    const timesheet = await testDb.timesheet.create({
      data: { workerId: hourlyId, weekStart: weekStart(MONDAY), status: 'SUBMITTED' },
    });
    await testDb.timeEntry.create({
      data: { timesheetId: timesheet.id, date: MONDAY, manualHours: 36 },
    });
    await makeShift({ dayOffset: 4, startHour: 6, endHour: 14.5, workerId: hourlyId });

    const row = (await projectOvertime(MONDAY)).find((r) => r.workerId === hourlyId)!;
    expect(row.workedHours).toBe(36);
    expect(row.scheduledHours).toBeCloseTo(8, 1);
    expect(row.projectedHours).toBeCloseTo(44, 1);
    expect(row.overtimeHours).toBeCloseTo(4, 1);
  });
});

describe('break findings', () => {
  it('finds a published shift scheduled with too short a break', async () => {
    await makeShift({ dayOffset: 0, startHour: 6, endHour: 15, breakMinutes: 15, workerId: hourlyId });
    const findings = await weeklyBreakFindings(MONDAY);
    expect(findings).toHaveLength(1);
    expect(findings[0].requiredMinutes).toBe(30);
    expect(findings[0].jurisdiction).toBe('US-PA');
    expect(findings[0].sourceUrl).toContain('example.invalid');
  });

  it('passes a compliant shift', async () => {
    await makeShift({ dayOffset: 0, startHour: 6, endHour: 15, breakMinutes: 30, workerId: hourlyId });
    expect(await weeklyBreakFindings(MONDAY)).toHaveLength(0);
  });

  it('does not check draft shifts', async () => {
    await makeShift({ dayOffset: 0, startHour: 6, endHour: 15, breakMinutes: 0, status: 'DRAFT', workerId: hourlyId });
    expect(await weeklyBreakFindings(MONDAY)).toHaveLength(0);
  });
});

describe('labour cost', () => {
  it('prices scheduled hours at the hourly rate', async () => {
    await makeShift({ dayOffset: 0, startHour: 6, endHour: 14.5, workerId: hourlyId });
    const rows = await scheduledLaborCost(MONDAY);
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduledHours).toBeCloseTo(8, 1);
    expect(rows[0].estimatedCost).toBeCloseTo(8 * 22, 0);
  });

  it('derives an hourly equivalent for a salaried worker', async () => {
    await makeShift({ dayOffset: 0, startHour: 6, endHour: 14.5, workerId: exemptId });
    const rows = await scheduledLaborCost(MONDAY);
    expect(rows[0].estimatedCost).toBeCloseTo(8 * (90000 / 2080), 0);
  });

  it('counts each person once even across several shifts', async () => {
    await makeShift({ dayOffset: 0, startHour: 6, endHour: 14.5, workerId: hourlyId });
    await makeShift({ dayOffset: 1, startHour: 6, endHour: 14.5, workerId: hourlyId });
    const rows = await scheduledLaborCost(MONDAY);
    expect(rows[0].workers).toBe(1);
    expect(rows[0].scheduledHours).toBeCloseTo(16, 1);
  });
});

describe('who may see and change a schedule', () => {
  it('lets managers build and publish schedules', () => {
    expect(can(manager, 'schedule.write')).toBe(true);
    expect(can(manager, 'schedule.read')).toBe(true);
  });

  it('does not give an ordinary employee the whole schedule', () => {
    expect(can(employee, 'schedule.read')).toBe(false);
    expect(can(employee, 'schedule.write')).toBe(false);
  });

  it('gives HR full scheduling access', () => {
    expect(can(hr, 'schedule.write')).toBe(true);
  });
});
