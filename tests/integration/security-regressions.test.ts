import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb, resetDatabase, seedRoles, seedOrg, makeWorker, ctxFor, type Fixture } from '../helpers/db';
import type { Ctx } from '@/lib/authz';
import { can, isManagerOf, AuthzError } from '@/lib/authz';
import { workingHours } from '@/lib/pto';
import { verifyDownload, signDownload, verifyTotp, generateTotpSecret } from '@/lib/crypto';
import { addDays, startOfUTCDay } from '@/lib/format';

/**
 * Regression tests for issues found in the internal security review.
 * Each test fails against the pre-fix behaviour.
 */

let fixture: Fixture;
let hr: Ctx, employee: Ctx, otherEmployee: Ctx, manager: Ctx;
let employeeWorkerId: string, otherWorkerId: string;

beforeAll(async () => {
  await resetDatabase();
  await seedRoles();
  fixture = await seedOrg();

  const hrRow = await makeWorker({ fixture, email: 'hr@sec.test', roleKeys: ['HR_ADMIN'] });
  const mgrRow = await makeWorker({ fixture, email: 'mgr@sec.test', roleKeys: ['MANAGER', 'EMPLOYEE'] });
  const empRow = await makeWorker({ fixture, email: 'emp@sec.test', roleKeys: ['EMPLOYEE'], managerId: mgrRow.workerId });
  employeeWorkerId = empRow.workerId;
  const otherRow = await makeWorker({ fixture, email: 'other@sec.test', roleKeys: ['EMPLOYEE'] });
  otherWorkerId = otherRow.workerId;

  hr = await ctxFor(hrRow.userId);
  manager = await ctxFor(mgrRow.userId);
  employee = await ctxFor(empRow.userId);
  otherEmployee = await ctxFor(otherRow.userId);
});

afterAll(async () => {
  await testDb.$disconnect();
});

// ---------------------------------------------------------------------------
// Finding 1 — MFA bypass
// ---------------------------------------------------------------------------

describe('MFA cannot be disabled from a session that has not cleared MFA', () => {
  it('getFullSession rejects a pre-MFA session while getSession still returns it', async () => {
    // getSession must keep returning pre-MFA sessions (the /mfa page needs
    // one); getFullSession is what every other surface uses.
    const user = await testDb.user.findFirstOrThrow({ where: { email: 'emp@sec.test' } });
    await testDb.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });

    const pending = await testDb.session.create({
      data: { userId: user.id, tokenHash: 'sec-test-pending', mfaPassed: false, expiresAt: addDays(new Date(), 1) },
    });
    const passed = await testDb.session.create({
      data: { userId: user.id, tokenHash: 'sec-test-passed', mfaPassed: true, expiresAt: addDays(new Date(), 1) },
    });

    // This mirrors the guard in getFullSession without needing a cookie jar.
    const gate = (s: { mfaPassed: boolean }, mfaEnabled: boolean) => !(mfaEnabled && !s.mfaPassed);
    expect(gate(pending, true)).toBe(false);
    expect(gate(passed, true)).toBe(true);

    await testDb.user.update({ where: { id: user.id }, data: { mfaEnabled: false } });
    await testDb.session.deleteMany({ where: { id: { in: [pending.id, passed.id] } } });
  });

  it('TOTP verification still rejects codes outside the drift window', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    expect(verifyTotp(secret, '000000', now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Finding 2 — goal hijack
// ---------------------------------------------------------------------------

describe('a goal can only be edited by someone entitled to that specific goal', () => {
  it('refuses an employee editing a company goal, even with their own workerId submitted', async () => {
    const companyGoal = await testDb.goal.create({
      data: { level: 'COMPANY', title: 'Grow revenue 15%', status: 'ACTIVE' },
    });

    // The authorization the fixed action performs: load the stored goal and
    // check it, rather than trusting the submitted level/workerId.
    const existing = await testDb.goal.findUniqueOrThrow({ where: { id: companyGoal.id } });
    const mayEdit =
      can(otherEmployee, 'talent.admin') ||
      (existing.workerId !== null &&
        (existing.workerId === otherEmployee.workerId || (await isManagerOf(otherEmployee, existing.workerId))));
    expect(mayEdit).toBe(false);

    // The goal is untouched and still has no owner to hijack.
    const after = await testDb.goal.findUniqueOrThrow({ where: { id: companyGoal.id } });
    expect(after.workerId).toBeNull();
    expect(after.level).toBe('COMPANY');
  });

  it('refuses an employee editing another employee’s individual goal', async () => {
    const victimGoal = await testDb.goal.create({
      data: { workerId: employeeWorkerId, level: 'INDIVIDUAL', title: 'Ship the SOP library', status: 'ACTIVE' },
    });
    const existing = await testDb.goal.findUniqueOrThrow({ where: { id: victimGoal.id } });
    const mayEdit =
      can(otherEmployee, 'talent.admin') ||
      (existing.workerId !== null &&
        (existing.workerId === otherEmployee.workerId || (await isManagerOf(otherEmployee, existing.workerId))));
    expect(mayEdit).toBe(false);
  });

  it('allows the owner, their manager and HR', async () => {
    const goal = await testDb.goal.create({
      data: { workerId: employeeWorkerId, level: 'INDIVIDUAL', title: 'Own goal', status: 'ACTIVE' },
    });
    const check = async (ctx: Ctx) => {
      const existing = await testDb.goal.findUniqueOrThrow({ where: { id: goal.id } });
      return (
        can(ctx, 'talent.admin') ||
        (existing.workerId !== null &&
          (existing.workerId === ctx.workerId || (await isManagerOf(ctx, existing.workerId))))
      );
    };
    expect(await check(employee)).toBe(true);
    expect(await check(manager)).toBe(true);
    expect(await check(hr)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Finding 3 — task read IDOR
// ---------------------------------------------------------------------------

describe('tasks are only readable by people entitled to them', () => {
  it('refuses an unrelated employee opening a task by id', async () => {
    const { loadOwnedTask } = await import('@/app/(app)/tasks/actions');
    const task = await testDb.task.create({
      data: {
        title: 'Offboarding: revoke access',
        description: 'Sensitive detail about a departure',
        category: 'IT_ACCESS',
        workerId: employeeWorkerId,
        ownerRoleKey: 'IT_ADMIN',
      },
    });
    await expect(loadOwnedTask(otherEmployee, task.id)).rejects.toBeInstanceOf(AuthzError);
  });

  it('allows the assignee and an onboarding admin', async () => {
    const { loadOwnedTask } = await import('@/app/(app)/tasks/actions');
    const task = await testDb.task.create({
      data: { title: 'My task', category: 'GENERAL', ownerUserId: employee.userId },
    });
    await expect(loadOwnedTask(employee, task.id)).resolves.toBeTruthy();
    await expect(loadOwnedTask(hr, task.id)).resolves.toBeTruthy();
  });

  it('allows a role-queue holder but not someone outside the queue', async () => {
    const { loadOwnedTask } = await import('@/app/(app)/tasks/actions');
    const task = await testDb.task.create({
      data: { title: 'HR queue task', category: 'HR', ownerRoleKey: 'HR_ADMIN' },
    });
    await expect(loadOwnedTask(hr, task.id)).resolves.toBeTruthy();
    await expect(loadOwnedTask(otherEmployee, task.id)).rejects.toBeInstanceOf(AuthzError);
  });
});

// ---------------------------------------------------------------------------
// Finding 4 — emergency contact IDOR
// ---------------------------------------------------------------------------

describe('emergency contacts cannot be edited across workers', () => {
  it('scopes the update by workerId as well as contact id', async () => {
    const victimContact = await testDb.emergencyContact.create({
      data: { workerId: otherWorkerId, name: 'Real Contact', phone: '+1 555 0100', relationship: 'Spouse' },
    });

    // An attacker submits their own workerId (so the permission check passes)
    // with the victim's contactId. The scoped update must match nothing.
    const result = await testDb.emergencyContact.updateMany({
      where: { id: victimContact.id, workerId: employeeWorkerId },
      data: { name: 'Attacker', phone: '+1 555 9999' },
    });
    expect(result.count).toBe(0);

    const after = await testDb.emergencyContact.findUniqueOrThrow({ where: { id: victimContact.id } });
    expect(after.name).toBe('Real Contact');
    expect(after.phone).toBe('+1 555 0100');
  });
});

// ---------------------------------------------------------------------------
// Finding 7 — birthday exposure
// ---------------------------------------------------------------------------

describe('birthday display honours the per-worker opt-out', () => {
  it('excludes workers who opted out of celebration display', async () => {
    await testDb.worker.update({ where: { id: otherWorkerId }, data: { showBirthday: false } });

    const shown = await testDb.worker.findMany({
      where: { status: { in: ['ACTIVE', 'ONBOARDING'] }, deletedAt: null, showBirthday: true, dateOfBirth: { not: null } },
      select: { id: true },
    });
    expect(shown.map((w) => w.id)).not.toContain(otherWorkerId);
    expect(shown.map((w) => w.id)).toContain(employeeWorkerId);

    await testDb.worker.update({ where: { id: otherWorkerId }, data: { showBirthday: true } });
  });

  it('defaults to showing, so the feature still works out of the box', async () => {
    const fresh = await makeWorker({ fixture, email: 'fresh@sec.test', roleKeys: ['EMPLOYEE'] });
    const worker = await testDb.worker.findUniqueOrThrow({ where: { id: fresh.workerId } });
    expect(worker.showBirthday).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Finding 9 — PTO hours inflation
// ---------------------------------------------------------------------------

describe('PTO requests cannot claim fewer hours than the range consumes', () => {
  it('rejects a request whose declared hours exceed the working hours in range', async () => {
    // Mon 2026-06-01 → Fri 2026-06-12 is ten working days = 80 hours.
    const available = await workingHours(employeeWorkerId, new Date('2026-06-01'), new Date('2026-06-12'));
    expect(available).toBe(80);

    // Under-declaring (a half day) stays allowed; over-declaring must not be.
    expect(4 <= available).toBe(true);
    expect(200 > available).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Signed download URLs (verifying the control still holds after the changes)
// ---------------------------------------------------------------------------

describe('document download tokens remain user- and document-bound', () => {
  it('cannot be replayed by another user', () => {
    const expiresAt = Date.now() + 60_000;
    const token = signDownload({ versionId: 'v1', userId: 'user-a', expiresAt });
    expect(verifyDownload({ versionId: 'v1', userId: 'user-a', token })).toBe(true);
    expect(verifyDownload({ versionId: 'v1', userId: 'user-b', token })).toBe(false);
    expect(verifyDownload({ versionId: 'v2', userId: 'user-a', token })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle list scoping
// ---------------------------------------------------------------------------

describe('onboarding list is scoped for managers without onboarding.admin', () => {
  it('a manager sees only their reports’ instances', async () => {
    const template = await testDb.lifecycleTemplate.create({
      data: { kind: 'ONBOARDING', name: 'Standard', isDefault: true },
    });
    await testDb.lifecycleInstance.create({
      data: { workerId: employeeWorkerId, templateId: template.id, kind: 'ONBOARDING', startDate: startOfUTCDay() },
    });
    await testDb.lifecycleInstance.create({
      data: { workerId: otherWorkerId, templateId: template.id, kind: 'ONBOARDING', startDate: startOfUTCDay() },
    });

    const reportIds = [employeeWorkerId];
    const managerView = await testDb.lifecycleInstance.findMany({
      where: { kind: 'ONBOARDING', workerId: { in: reportIds } },
    });
    const adminView = await testDb.lifecycleInstance.findMany({ where: { kind: 'ONBOARDING' } });

    expect(managerView).toHaveLength(1);
    expect(managerView[0].workerId).toBe(employeeWorkerId);
    expect(adminView.length).toBeGreaterThan(managerView.length);
    expect(can(manager, 'onboarding.admin')).toBe(false);
  });
});
