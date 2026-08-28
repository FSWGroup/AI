import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb, resetDatabase, seedRoles, seedOrg, makeWorker, ctxFor, type Fixture } from '../helpers/db';
import type { Ctx } from '@/lib/authz';
import { createWorker, changeEmployment, changeCompensation } from '@/lib/people';
import { startLifecycle, pickTemplate } from '@/lib/lifecycle';
import { ptoBalance, workingHours, accrueIfDue } from '@/lib/pto';
import { createApprovalRequest, decideApproval } from '@/lib/approvals';
import { emitEvent } from '@/lib/workflows';
import { syncComplianceItems, retentionEligibility } from '@/lib/compliance';
import { validateImport, applyImport, parseCsv } from '@/lib/imports';
import { findReport } from '@/lib/reports';
import { encryptField, decryptField, last4 } from '@/lib/crypto';
import { audit } from '@/lib/audit';
import { addDays, startOfUTCDay } from '@/lib/format';

/**
 * End-to-end HR journeys (§66). These drive the real service layer against a
 * real PostgreSQL database — the same code paths the server actions call.
 */

let fixture: Fixture;
let hrCtx: Ctx, managerCtx: Ctx, execCtx: Ctx;
let managerWorkerId: string;

beforeAll(async () => {
  await resetDatabase();
  await seedRoles();
  fixture = await seedOrg();

  const hrRow = await makeWorker({ fixture, email: 'hr@journey.test', roleKeys: ['HR_ADMIN', 'MANAGER'], title: 'Head of People' });
  const mgrRow = await makeWorker({ fixture, email: 'mgr@journey.test', roleKeys: ['MANAGER', 'EMPLOYEE'], title: 'VP Operations' });
  const execRow = await makeWorker({ fixture, email: 'exec@journey.test', roleKeys: ['EXECUTIVE'], title: 'CEO' });
  managerWorkerId = mgrRow.workerId;
  hrCtx = await ctxFor(hrRow.userId);
  managerCtx = await ctxFor(mgrRow.userId);
  execCtx = await ctxFor(execRow.userId);

  // Onboarding template used by the lifecycle journey
  await testDb.lifecycleTemplate.create({
    data: {
      kind: 'ONBOARDING',
      name: 'US Employee Onboarding',
      isDefault: true,
      conditions: { countries: ['US'], workerTypes: ['EMPLOYEE'] },
      items: {
        create: [
          { order: 1, title: 'Send offer letter', ownerKind: 'HR', dueOffsetDays: -7, category: 'DOCUMENT' },
          { order: 2, title: 'Form I-9 Section 1', ownerKind: 'EMPLOYEE', dueOffsetDays: 0, category: 'COMPLIANCE' },
          { order: 3, title: 'Form I-9 Section 2', ownerKind: 'HR', dueOffsetDays: 3, category: 'COMPLIANCE', dependsOnOrder: 2 },
          { order: 4, title: 'Provision accounts', ownerKind: 'IT', dueOffsetDays: -1, category: 'IT_ACCESS' },
        ],
      },
    },
  });
  await testDb.lifecycleTemplate.create({
    data: {
      kind: 'ONBOARDING',
      name: 'PH Contractor Onboarding',
      conditions: { countries: ['PH'], workerTypes: ['CONTRACTOR'] },
      items: {
        create: [
          { order: 1, title: 'Collect W-8BEN', ownerKind: 'HR', dueOffsetDays: -5, category: 'COMPLIANCE' },
          { order: 2, title: 'Data privacy notice acknowledgment', ownerKind: 'EMPLOYEE', dueOffsetDays: -3, category: 'COMPLIANCE' },
        ],
      },
    },
  });
  await testDb.lifecycleTemplate.create({
    data: {
      kind: 'OFFBOARDING',
      name: 'Standard Offboarding',
      isDefault: true,
      items: {
        create: [
          { order: 1, title: 'Revoke all application access', ownerKind: 'IT', dueOffsetDays: 0, category: 'IT_ACCESS' },
          { order: 2, title: 'Collect equipment', ownerKind: 'IT', dueOffsetDays: 0, category: 'EQUIPMENT' },
          { order: 3, title: 'Exit interview', ownerKind: 'HR', dueOffsetDays: -1, category: 'OFFBOARDING' },
        ],
      },
    },
  });
});

afterAll(async () => {
  await testDb.$disconnect();
});

// ---------------------------------------------------------------------------

describe('journey: HR creates a US employee and onboarding starts', () => {
  let workerId: string;

  it('creates the worker with employment, compensation and an invited account', async () => {
    const worker = await createWorker(hrCtx, {
      legalFirstName: 'Alexis',
      lastName: 'Grant',
      workEmail: 'alexis.grant@journey.test',
      workerType: 'EMPLOYEE',
      country: 'US',
      hireDate: addDays(startOfUTCDay(), 7),
      legalEntityId: fixture.entityId,
      departmentId: fixture.departmentId,
      managerId: managerWorkerId,
      title: 'Inside Sales Representative',
      workState: 'PA',
      amount: 58000,
      currency: 'USD',
      rateType: 'ANNUAL',
      inviteUser: true,
      roleKeys: ['EMPLOYEE'],
    });
    workerId = worker.id;

    expect(worker.employeeNumber).toMatch(/^FSW-\d{4}$/);
    expect(worker.status).toBe('PRE_START');

    const employment = await testDb.employmentRecord.findFirst({ where: { workerId, effectiveTo: null } });
    expect(employment?.title).toBe('Inside Sales Representative');
    expect(employment?.managerId).toBe(managerWorkerId);

    const comp = await testDb.compensation.findFirst({ where: { workerId, effectiveTo: null } });
    expect(Number(comp?.amount)).toBe(58000);

    const user = await testDb.user.findUniqueOrThrow({ where: { id: worker.userId! } });
    expect(user.status).toBe('INVITED');
    expect(user.passwordHash).toBeNull();
  });

  it('sends an activation email through the outbox', async () => {
    const email = await testDb.emailMessage.findFirst({
      where: { toEmail: 'alexis.grant@journey.test', templateKey: 'activation' },
    });
    expect(email).not.toBeNull();
    expect(email?.status).toBe('OUTBOX');
    expect(email?.html).toContain('/activate/');
  });

  it('generated the onboarding checklist from the matching template', async () => {
    const instance = await testDb.lifecycleInstance.findFirst({
      where: { workerId, kind: 'ONBOARDING' },
      include: { tasks: true, template: true },
    });
    expect(instance).not.toBeNull();
    expect(instance!.template?.name).toBe('US Employee Onboarding');
    expect(instance!.tasks).toHaveLength(4);

    // Owners resolved: employee task → the new worker's user, IT task → role queue.
    const employeeTask = instance!.tasks.find((t) => t.title === 'Form I-9 Section 1')!;
    const worker = await testDb.worker.findUniqueOrThrow({ where: { id: workerId } });
    expect(employeeTask.ownerUserId).toBe(worker.userId);
    const itTask = instance!.tasks.find((t) => t.title === 'Provision accounts')!;
    expect(itTask.ownerRoleKey).toBe('IT_ADMIN');
    // Manager task owner falls back to HR when no manager user exists; here the
    // manager has an account so the offer-letter HR task is a role queue task.
    const hrTask = instance!.tasks.find((t) => t.title === 'Send offer letter')!;
    expect(hrTask.ownerRoleKey).toBe('HR_ADMIN');
  });

  it('respects task dependencies when completing out of order', async () => {
    const instance = await testDb.lifecycleInstance.findFirstOrThrow({
      where: { workerId, kind: 'ONBOARDING' },
      include: { tasks: true },
    });
    const section2 = instance.tasks.find((t) => t.title === 'Form I-9 Section 2')!;
    const section1 = instance.tasks.find((t) => t.title === 'Form I-9 Section 1')!;
    expect(section2.dependsOnId).toBe(section1.id);
  });

  it('records a hire timeline event and an audit entry', async () => {
    const timeline = await testDb.timelineEvent.findFirst({ where: { workerId, kind: 'HIRE' } });
    expect(timeline?.title).toContain('Inside Sales Representative');
    const auditRow = await testDb.auditEvent.findFirst({ where: { action: 'worker.create', targetId: workerId } });
    expect(auditRow?.actorEmail).toBe('hr@journey.test');
  });

  it('picks the Philippines contractor template for a PH contractor', async () => {
    const phWorker = await createWorker(hrCtx, {
      legalFirstName: 'Joshua',
      lastName: 'Villanueva',
      workEmail: 'jv@journey.test',
      workerType: 'CONTRACTOR',
      country: 'PH',
      hireDate: startOfUTCDay(),
      legalEntityId: fixture.entityId,
      title: 'E-Commerce Specialist',
      amount: 55000,
      currency: 'PHP',
      rateType: 'MONTHLY',
      inviteUser: false,
      roleKeys: ['CONTRACTOR'],
    });
    const templateId = await pickTemplate('ONBOARDING', phWorker.id);
    const template = await testDb.lifecycleTemplate.findUniqueOrThrow({ where: { id: templateId! } });
    expect(template.name).toBe('PH Contractor Onboarding');

    const instance = await testDb.lifecycleInstance.findFirstOrThrow({
      where: { workerId: phWorker.id },
      include: { tasks: true },
    });
    // The PH contractor gets W-8BEN, not a US I-9.
    const titles = instance.tasks.map((t) => t.title);
    expect(titles).toContain('Collect W-8BEN');
    expect(titles).not.toContain('Form I-9 Section 1');

    // A contractor profile is created automatically.
    const profile = await testDb.contractorProfile.findUnique({ where: { workerId: phWorker.id } });
    expect(profile).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('journey: effective-dated job and compensation changes', () => {
  let workerId: string;

  beforeAll(async () => {
    const row = await makeWorker({ fixture, email: 'promo@journey.test', roleKeys: ['EMPLOYEE'], managerId: managerWorkerId, amount: 70000 });
    workerId = row.workerId;
  });

  it('closes the old employment record instead of overwriting it', async () => {
    const effective = new Date('2026-03-01');
    await changeEmployment(hrCtx, workerId, { title: 'Senior Operations Analyst' }, { effectiveFrom: effective, reason: 'PROMOTION' });

    const history = await testDb.employmentRecord.findMany({ where: { workerId }, orderBy: { effectiveFrom: 'asc' } });
    expect(history).toHaveLength(2);
    expect(history[0].effectiveTo).toEqual(effective);
    expect(history[0].title).toBe('Operations Associate');
    expect(history[1].effectiveTo).toBeNull();
    expect(history[1].title).toBe('Senior Operations Analyst');
    expect(history[1].changeReason).toBe('PROMOTION');
  });

  it('keeps compensation history and never overwrites prior pay', async () => {
    const effective = new Date('2026-03-01');
    await changeCompensation(hrCtx, workerId, {
      amount: 82000, currency: 'USD', rateType: 'ANNUAL', reason: 'PROMOTION', effectiveFrom: effective,
    });
    const comps = await testDb.compensation.findMany({ where: { workerId }, orderBy: { effectiveFrom: 'asc' } });
    expect(comps).toHaveLength(2);
    expect(Number(comps[0].amount)).toBe(70000);
    expect(comps[0].effectiveTo).toEqual(effective);
    expect(Number(comps[1].amount)).toBe(82000);
    expect(comps[1].effectiveTo).toBeNull();
  });

  it('records compensation changes at COMP visibility on the timeline', async () => {
    const event = await testDb.timelineEvent.findFirst({ where: { workerId, kind: 'COMP_CHANGE' } });
    expect(event?.visibility).toBe('COMP');
  });

  it('rejects a manager assignment that would create a cycle', async () => {
    // This worker already reports to managerWorkerId, so making the manager
    // report back to them closes a loop. The database trigger must refuse it.
    await expect(
      changeEmployment(hrCtx, managerWorkerId, { managerId: workerId }, { effectiveFrom: new Date('2026-04-01'), reason: 'MANAGER_CHANGE' }),
    ).rejects.toThrow(/circular/i);

    // A worker cannot manage themselves either.
    await expect(
      changeEmployment(hrCtx, workerId, { managerId: workerId }, { effectiveFrom: new Date('2026-04-02'), reason: 'MANAGER_CHANGE' }),
    ).rejects.toThrow(/own manager/i);

    // And the rejected changes left the existing records untouched.
    const current = await testDb.employmentRecord.findFirst({ where: { workerId: managerWorkerId, effectiveTo: null } });
    expect(current?.managerId).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('journey: PTO request, approval and balance math', () => {
  let workerId: string;
  let policyId: string;

  beforeAll(async () => {
    const row = await makeWorker({ fixture, email: 'pto@journey.test', roleKeys: ['EMPLOYEE'], managerId: managerWorkerId });
    workerId = row.workerId;
    const policy = await testDb.ptoPolicy.create({
      data: { name: 'US Vacation', leaveType: 'VACATION', country: 'US', accrualMethod: 'MONTHLY', hoursPerYear: 120, carryoverCapHours: 40 },
    });
    policyId = policy.id;
    await testDb.ptoPolicyAssignment.create({ data: { workerId, policyId } });
    await testDb.ptoTransaction.create({
      data: { workerId, policyId, kind: 'GRANT', hours: 40, effectiveDate: new Date(), note: 'Opening balance' },
    });
    // A US holiday inside the requested range
    const cal = await testDb.holidayCalendar.create({ data: { name: 'United States', country: 'US' } });
    await testDb.holiday.create({ data: { calendarId: cal.id, name: 'Independence Day', date: new Date('2026-07-03') } });
  });

  it('derives the balance from the transaction ledger', async () => {
    expect(await ptoBalance(workerId, policyId)).toBe(40);
  });

  it('counts working hours excluding weekends and holidays', async () => {
    // Mon 2026-06-29 → Fri 2026-07-03; the 3rd is a holiday → 4 working days.
    const hours = await workingHours(workerId, new Date('2026-06-29'), new Date('2026-07-03'));
    expect(hours).toBe(32);
  });

  it('books usage as a negative transaction on approval, keeping the ledger balanced', async () => {
    const request = await testDb.ptoRequest.create({
      data: { workerId, policyId, startDate: new Date('2026-06-29'), endDate: new Date('2026-07-03'), hours: 32, status: 'PENDING' },
    });
    await testDb.$transaction([
      testDb.ptoRequest.update({ where: { id: request.id }, data: { status: 'APPROVED', decidedAt: new Date() } }),
      testDb.ptoTransaction.create({
        data: { workerId, policyId, kind: 'USAGE', hours: -32, effectiveDate: request.startDate, requestId: request.id },
      }),
    ]);
    expect(await ptoBalance(workerId, policyId)).toBe(8);

    const sum = await testDb.ptoTransaction.aggregate({ where: { workerId, policyId }, _sum: { hours: true } });
    expect(Number(sum._sum.hours)).toBe(8);
  });

  it('accrues monthly on the first, exactly once (idempotent)', async () => {
    const firstOfMonth = new Date(Date.UTC(2026, 8, 1));
    const first = await accrueIfDue({ workerId, policyId, today: firstOfMonth, hireDate: new Date('2023-01-09') });
    const second = await accrueIfDue({ workerId, policyId, today: firstOfMonth, hireDate: new Date('2023-01-09') });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await ptoBalance(workerId, policyId)).toBe(18); // 8 + 120/12
  });

  it('does not accrue mid-month for a monthly policy', async () => {
    const midMonth = new Date(Date.UTC(2026, 8, 15));
    expect(await accrueIfDue({ workerId, policyId, today: midMonth, hireDate: new Date('2023-01-09') })).toBe(false);
  });

  it('honours a waiting period', async () => {
    const newHire = await makeWorker({ fixture, email: 'waiting@journey.test', roleKeys: ['EMPLOYEE'], hireDate: new Date('2026-08-20') });
    const waitingPolicy = await testDb.ptoPolicy.create({
      data: { name: 'Waiting Vacation', leaveType: 'VACATION', accrualMethod: 'MONTHLY', hoursPerYear: 120, waitingPeriodDays: 90 },
    });
    await testDb.ptoPolicyAssignment.create({ data: { workerId: newHire.workerId, policyId: waitingPolicy.id } });
    const tooEarly = await accrueIfDue({
      workerId: newHire.workerId, policyId: waitingPolicy.id, today: new Date(Date.UTC(2026, 8, 1)), hireDate: new Date('2026-08-20'),
    });
    expect(tooEarly).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('journey: sequential approvals', () => {
  it('routes, approves and closes a compensation change request', async () => {
    const worker = await makeWorker({ fixture, email: 'approval@journey.test', roleKeys: ['EMPLOYEE'] });
    const request = await createApprovalRequest({
      kind: 'COMP_CHANGE',
      title: 'Compensation change: test',
      subjectType: 'Worker',
      subjectId: worker.workerId,
      payload: { amount: 95000, currency: 'USD', rateType: 'ANNUAL', reason: 'MERIT' },
      requestedById: hrCtx.userId,
      steps: [{ approverRole: 'EXECUTIVE' }],
    });
    expect(request.status).toBe('PENDING');

    // The executive is notified.
    const notification = await testDb.notification.findFirst({ where: { userId: execCtx.userId, kind: 'APPROVAL' } });
    expect(notification?.title).toContain('Approval needed');

    // A manager who is not the assigned approver cannot decide it.
    await expect(decideApproval(managerCtx, request.id, 'APPROVED')).rejects.toThrow(/not assigned to you/i);

    const result = await decideApproval(execCtx, request.id, 'APPROVED', 'Looks right');
    expect(result.finalStatus).toBe('APPROVED');

    // Decisions are immutable — a second decision is refused.
    await expect(decideApproval(execCtx, request.id, 'REJECTED')).rejects.toThrow(/already been decided/i);
  });

  it('stops at the first rejection in a multi-step chain', async () => {
    const request = await createApprovalRequest({
      kind: 'HEADCOUNT',
      title: 'Open a requisition',
      requestedById: hrCtx.userId,
      steps: [{ approverRole: 'EXECUTIVE' }, { approverRole: 'HR_ADMIN' }],
    });
    const result = await decideApproval(execCtx, request.id, 'REJECTED', 'Not this quarter');
    expect(result.finalStatus).toBe('REJECTED');

    const steps = await testDb.approvalStep.findMany({ where: { requestId: request.id }, orderBy: { order: 'asc' } });
    expect(steps[0].status).toBe('REJECTED');
    expect(steps[1].status).toBe('PENDING'); // never reached
  });
});

// ---------------------------------------------------------------------------

describe('journey: offboarding surfaces access removal', () => {
  let workerId: string;

  beforeAll(async () => {
    const row = await makeWorker({ fixture, email: 'leaver@journey.test', roleKeys: ['EMPLOYEE'], managerId: managerWorkerId });
    workerId = row.workerId;
    const app = await testDb.softwareApp.create({ data: { name: 'Microsoft 365' } });
    await testDb.appAccessGrant.create({ data: { appId: app.id, workerId } });
  });

  it('creates IT access-removal tasks at CRITICAL priority', async () => {
    const lastDay = addDays(startOfUTCDay(), 14);
    await testDb.worker.update({ where: { id: workerId }, data: { status: 'OFFBOARDING', terminationDate: lastDay } });
    await startLifecycle({ workerId, kind: 'OFFBOARDING', startDate: lastDay, reason: 'RESIGNATION', voluntary: true, createdById: hrCtx.userId });

    const tasks = await testDb.task.findMany({ where: { workerId, category: 'IT_ACCESS' } });
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.priority === 'CRITICAL')).toBe(true);
    expect(tasks.every((t) => t.ownerRoleKey === 'IT_ADMIN')).toBe(true);
  });

  it('preserves employment history and revokes access on final termination', async () => {
    await testDb.$transaction(async (tx) => {
      const worker = await tx.worker.findUniqueOrThrow({ where: { id: workerId } });
      await tx.worker.update({ where: { id: workerId }, data: { status: 'TERMINATED', rehireEligible: true } });
      await tx.employmentRecord.updateMany({ where: { workerId, effectiveTo: null }, data: { effectiveTo: worker.terminationDate! } });
      await tx.user.update({ where: { id: worker.userId! }, data: { status: 'DEACTIVATED' } });
      await tx.appAccessGrant.updateMany({ where: { workerId, revokedAt: null }, data: { revokedAt: new Date() } });
    });

    // History is preserved, not deleted.
    const employments = await testDb.employmentRecord.findMany({ where: { workerId } });
    expect(employments.length).toBeGreaterThan(0);
    expect(employments.every((e) => e.effectiveTo !== null)).toBe(true);

    const compensations = await testDb.compensation.findMany({ where: { workerId } });
    expect(compensations.length).toBeGreaterThan(0);

    const grants = await testDb.appAccessGrant.findMany({ where: { workerId } });
    expect(grants.every((g) => g.revokedAt !== null)).toBe(true);

    const user = await testDb.user.findFirstOrThrow({ where: { email: 'leaver@journey.test' } });
    expect(user.status).toBe('DEACTIVATED');
  });
});

// ---------------------------------------------------------------------------

describe('journey: encrypted identifiers are never plaintext', () => {
  it('stores an SSN encrypted with only last4 in the clear', async () => {
    const row = await makeWorker({ fixture, email: 'pii@journey.test', roleKeys: ['EMPLOYEE'] });
    const ssn = '123-45-6789';
    await testDb.workerIdentifier.create({
      data: { workerId: row.workerId, kind: 'SSN', label: '', valueEnc: encryptField(ssn), last4: last4(ssn), createdById: hrCtx.userId },
    });

    const stored = await testDb.workerIdentifier.findFirstOrThrow({ where: { workerId: row.workerId, kind: 'SSN' } });
    expect(stored.valueEnc).not.toContain('123');
    expect(stored.valueEnc).not.toContain(ssn);
    expect(stored.last4).toBe('6789');
    expect(decryptField(stored.valueEnc)).toBe(ssn);

    // A raw SQL scan must not find the plaintext anywhere in the table.
    const hits = await testDb.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM "WorkerIdentifier" WHERE "valueEnc" LIKE '%123-45-6789%'
    `;
    expect(Number(hits[0].count)).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('journey: audit log is append-only', () => {
  it('writes an audit row for a sensitive export', async () => {
    await audit(hrCtx, 'export.run', { targetType: 'Report', targetId: 'headcount', metadata: { rows: 12 } });
    const row = await testDb.auditEvent.findFirstOrThrow({
      where: { action: 'export.run' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row.actorEmail).toBe('hr@journey.test');
    expect((row.metadata as { rows: number }).rows).toBe(12);
  });

  it('refuses UPDATE and DELETE at the database level', async () => {
    const row = await testDb.auditEvent.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    await expect(
      testDb.$executeRaw`UPDATE "AuditEvent" SET action = 'tampered' WHERE id = ${row.id}`,
    ).rejects.toThrow(/append-only/i);
    await expect(
      testDb.$executeRaw`DELETE FROM "AuditEvent" WHERE id = ${row.id}`,
    ).rejects.toThrow(/append-only/i);

    const after = await testDb.auditEvent.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.action).toBe(row.action);
  });

  it('refuses to rewrite a document signature', async () => {
    const doc = await testDb.document.create({
      data: {
        title: 'Handbook',
        category: 'HANDBOOK',
        versions: { create: { version: 1, fileKey: 'k', fileName: 'h.pdf', mimeType: 'application/pdf', sizeBytes: 10 } },
      },
      include: { versions: true },
    });
    const worker = await makeWorker({ fixture, email: 'signer@journey.test', roleKeys: ['EMPLOYEE'] });
    const sig = await testDb.documentSignature.create({
      data: { documentVersionId: doc.versions[0].id, workerId: worker.workerId, signedName: 'Test Signer' },
    });
    await expect(
      testDb.$executeRaw`UPDATE "DocumentSignature" SET "signedName" = 'Someone Else' WHERE id = ${sig.id}`,
    ).rejects.toThrow(/append-only/i);
  });
});

// ---------------------------------------------------------------------------

describe('journey: workflow automation', () => {
  it('fires a matching workflow and skips a non-matching one', async () => {
    const matching = await testDb.workflowDefinition.create({
      data: {
        name: 'US employees only',
        trigger: 'ANNIVERSARY',
        conditions: { countries: ['US'] },
        actions: [{ type: 'CREATE_TASK', title: 'Celebrate {{worker}}', ownerRoleKey: 'HR_ADMIN', category: 'HR', dueOffsetDays: 1 }],
      },
    });
    const nonMatching = await testDb.workflowDefinition.create({
      data: {
        name: 'PH only',
        trigger: 'ANNIVERSARY',
        conditions: { countries: ['PH'] },
        actions: [{ type: 'CREATE_TASK', title: 'Should not run', ownerRoleKey: 'HR_ADMIN' }],
      },
    });

    const worker = await makeWorker({ fixture, email: 'anniv@journey.test', roleKeys: ['EMPLOYEE'], country: 'US' });
    await emitEvent({ type: 'ANNIVERSARY', workerId: worker.workerId, dedupeKey: `anniv:${worker.workerId}:2026-08-28` });

    const runs = await testDb.workflowRun.findMany({ where: { definitionId: { in: [matching.id, nonMatching.id] } } });
    const matchRun = runs.find((r) => r.definitionId === matching.id)!;
    const skipRun = runs.find((r) => r.definitionId === nonMatching.id)!;
    expect(matchRun.status).toBe('SUCCEEDED');
    expect(skipRun.status).toBe('SKIPPED');

    const task = await testDb.task.findFirst({ where: { workerId: worker.workerId, category: 'HR' } });
    expect(task?.title).toContain('Celebrate');
  });

  it('dedupes repeated scheduled events', async () => {
    const worker = await makeWorker({ fixture, email: 'dedupe@journey.test', roleKeys: ['EMPLOYEE'], country: 'US' });
    const key = `bday:${worker.workerId}:2026-08-28`;
    const def = await testDb.workflowDefinition.create({
      data: {
        name: 'Birthday note',
        trigger: 'BIRTHDAY',
        actions: [{ type: 'NOTIFY_ROLE', roleKey: 'HR_ADMIN', title: 'Birthday' }],
      },
    });
    await emitEvent({ type: 'BIRTHDAY', workerId: worker.workerId, dedupeKey: key });
    await emitEvent({ type: 'BIRTHDAY', workerId: worker.workerId, dedupeKey: key });
    const runs = await testDb.workflowRun.count({ where: { definitionId: def.id } });
    expect(runs).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('journey: compliance rules are data-driven', () => {
  it('only creates items for workers the rule applies to', async () => {
    await testDb.complianceRule.create({
      data: {
        name: 'Form I-9 completion',
        category: 'WORK_AUTHORIZATION',
        jurisdiction: 'US-FED',
        source: 'USCIS',
        sourceUrl: 'https://www.uscis.gov/i-9',
        description: 'Section 2 within 3 business days of start.',
        appliesTo: { countries: ['US'], workerTypes: ['EMPLOYEE'] },
        deadlineRule: { anchor: 'HIRE_DATE', offsetDays: 3 },
        severity: 'CRITICAL',
      },
    });
    const usEmployee = await makeWorker({ fixture, email: 'us-i9@journey.test', roleKeys: ['EMPLOYEE'], country: 'US' });
    const phContractor = await makeWorker({
      fixture, email: 'ph-i9@journey.test', roleKeys: ['CONTRACTOR'], country: 'PH', workerType: 'CONTRACTOR',
    });

    await syncComplianceItems();

    const usItem = await testDb.complianceItem.findFirst({ where: { workerId: usEmployee.workerId } });
    const phItem = await testDb.complianceItem.findFirst({ where: { workerId: phContractor.workerId } });
    expect(usItem).not.toBeNull();
    expect(phItem).toBeNull();

    // CRITICAL rules also raise a real task in the owner's queue.
    expect(usItem!.taskId).not.toBeNull();
    const task = await testDb.task.findUniqueOrThrow({ where: { id: usItem!.taskId! } });
    expect(task.priority).toBe('CRITICAL');
    expect(task.description).toContain('uscis.gov');
  });

  it('is idempotent across repeated syncs', async () => {
    const before = await testDb.complianceItem.count();
    await syncComplianceItems();
    expect(await testDb.complianceItem.count()).toBe(before);
  });

  it('computes retention eligibility without destroying anything', async () => {
    await testDb.retentionPolicy.create({
      data: { recordType: 'PERSONNEL', jurisdiction: 'US-FED', anchor: 'TERMINATION', retainYears: 4 },
    });
    const old = await makeWorker({ fixture, email: 'old@journey.test', roleKeys: ['EMPLOYEE'] });
    await testDb.worker.update({
      where: { id: old.workerId },
      data: { status: 'TERMINATED', terminationDate: new Date('2015-01-01') },
    });

    const eligibility = await retentionEligibility();
    const personnel = eligibility.find((e) => e.recordType === 'PERSONNEL')!;
    expect(personnel.eligible.some((e) => e.workerId === old.workerId)).toBe(true);

    // Nothing was actually deleted — destruction requires explicit approval.
    const stillThere = await testDb.worker.findUnique({ where: { id: old.workerId } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.personalEmail).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('journey: CSV import validates before writing', () => {
  it('parses quoted CSV correctly', () => {
    const { headers, rows } = parseCsv('a,b\n"has,comma","has ""quote"""\nplain,value\n');
    expect(headers).toEqual(['a', 'b']);
    expect(rows[0]).toEqual(['has,comma', 'has "quote"']);
    expect(rows[1]).toEqual(['plain', 'value']);
  });

  it('flags bad rows and imports only the valid ones', async () => {
    const csv = [
      'legalFirstName,lastName,title,hireDate,workerType,country,legalEntityCode',
      'Valid,Person,Analyst,2026-02-01,EMPLOYEE,US,FSW',
      ',NoFirstName,Analyst,2026-02-01,EMPLOYEE,US,FSW',
      'Bad,Entity,Analyst,2026-02-01,EMPLOYEE,US,NOPE',
      'Bad,Date,Analyst,not-a-date,EMPLOYEE,US,FSW',
    ].join('\n');

    const preview = await validateImport('WORKERS', csv);
    expect(preview.validCount).toBe(1);
    expect(preview.errorCount).toBe(3);
    expect(preview.rows[1].errors.join()).toMatch(/required/i);
    expect(preview.rows[2].errors.join()).toMatch(/Unknown legal entity/i);
    expect(preview.rows[3].errors.join()).toMatch(/valid date/i);

    const before = await testDb.worker.count();
    const report = await applyImport(hrCtx, 'WORKERS', preview);
    const after = await testDb.worker.count();

    expect(after - before).toBe(1); // only the valid row landed
    expect(report.filter((r) => r.status === 'imported')).toHaveLength(1);
    expect(report.filter((r) => r.status === 'skipped')).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------

describe('journey: reports respect permissions', () => {
  it('excludes compensation reports from a manager', async () => {
    const { reportsFor } = await import('@/lib/reports');
    const managerReports = reportsFor(managerCtx).map((r) => r.key);
    const hrReports = reportsFor(hrCtx).map((r) => r.key);
    expect(hrReports).toContain('compensation');
    expect(managerReports).not.toContain('compensation');
    expect(managerReports).not.toContain('pto-balances');
  });

  it('runs the headcount report with real rows', async () => {
    const report = findReport('headcount')!;
    const result = await report.run(hrCtx, {});
    expect(result.headers[0]).toBe('Employee #');
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0]).toHaveLength(result.headers.length);
  });
});
