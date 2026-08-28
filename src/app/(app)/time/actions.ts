'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireCtxAction, can, isManagerOf, AuthzError } from '@/lib/authz';
import { ptoBalance, workingHours } from '@/lib/pto';
import { audit } from '@/lib/audit';
import { notifyUser, notifyRole } from '@/lib/notify';
import { recordTimeline } from '@/lib/timeline';
import { emitEvent } from '@/lib/workflows';
import { fullName, startOfUTCDay, addDays } from '@/lib/format';
import type { ActionResult } from '@/app/(auth)/actions';

// ---------------------------------------------------------------------------
// PTO requests
// ---------------------------------------------------------------------------

export async function requestPtoAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    if (!ctx.workerId) return { error: 'Your account is not linked to a worker profile.' };
    const policyId = String(formData.get('policyId') ?? '');
    const start = new Date(String(formData.get('startDate') ?? ''));
    const end = new Date(String(formData.get('endDate') ?? ''));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { error: 'Pick start and end dates.' };
    if (end < start) return { error: 'End date must be on or after the start date.' };

    const assignment = await db.ptoPolicyAssignment.findFirst({
      where: { workerId: ctx.workerId, policyId, endDate: null },
      include: { policy: true },
    });
    if (!assignment) return { error: 'That leave policy is not assigned to you.' };

    // The optional hours field exists for half-days, so it may be lower than
    // the range implies — but never higher, or someone could book two weeks
    // off while debiting half an hour.
    const availableHours = await workingHours(ctx.workerId, start, end);
    const requestedHours = formData.get('hours') ? Number(formData.get('hours')) : availableHours;
    if (!Number.isFinite(requestedHours) || requestedHours <= 0) {
      return { error: 'The selected range contains no working hours.' };
    }
    if (availableHours <= 0) return { error: 'The selected range contains no working days.' };
    if (requestedHours > availableHours) {
      return { error: `That range covers ${availableHours} working hours — you cannot request more than that.` };
    }
    const hours = requestedHours;

    const balance = await ptoBalance(ctx.workerId, policyId);
    const pendingAgg = await db.ptoRequest.aggregate({
      where: { workerId: ctx.workerId, policyId, status: 'PENDING' },
      _sum: { hours: true },
    });
    const available = balance - Number(pendingAgg._sum.hours ?? 0);
    if (!assignment.policy.allowNegative && hours > available) {
      return { error: `Not enough balance: ${available.toFixed(1)}h available, ${hours.toFixed(1)}h requested.` };
    }

    const overlap = await db.ptoRequest.findFirst({
      where: {
        workerId: ctx.workerId,
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: end },
        endDate: { gte: start },
      },
    });
    if (overlap) return { error: 'You already have a request covering those dates.' };

    const request = await db.ptoRequest.create({
      data: {
        workerId: ctx.workerId,
        policyId,
        startDate: start,
        endDate: end,
        hours,
        note: String(formData.get('note') ?? '') || null,
        status: assignment.policy.requiresApproval ? 'PENDING' : 'APPROVED',
      },
    });

    if (!assignment.policy.requiresApproval) {
      await db.ptoTransaction.create({
        data: { workerId: ctx.workerId, policyId, kind: 'USAGE', hours: -hours, effectiveDate: start, requestId: request.id },
      });
    } else {
      const employment = await db.employmentRecord.findFirst({
        where: { workerId: ctx.workerId, effectiveTo: null },
        include: { manager: { include: { user: { select: { id: true } } } } },
      });
      const worker = await db.worker.findUniqueOrThrow({ where: { id: ctx.workerId } });
      const payload = {
        kind: 'APPROVAL' as const,
        title: `PTO request from ${fullName(worker)}`,
        body: `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)} (${hours}h)`,
        href: '/time/pto?tab=approvals',
        email: true,
      };
      if (employment?.manager?.user?.id) await notifyUser(employment.manager.user.id, payload);
      else await notifyRole('HR_ADMIN', payload);
    }
    await emitEvent({ type: 'PTO_SUBMITTED', workerId: ctx.workerId });
    revalidatePath('/time/pto');
    return { success: assignment.policy.requiresApproval ? 'Request submitted for approval.' : 'Time off booked.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'Could not submit the request.' };
  }
}

export async function decidePtoAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    const requestId = String(formData.get('requestId') ?? '');
    const decision = String(formData.get('decision') ?? '');
    if (decision !== 'APPROVED' && decision !== 'DENIED') return { error: 'Invalid decision.' };

    const request = await db.ptoRequest.findUnique({
      where: { id: requestId },
      include: { worker: { include: { user: { select: { id: true } } } }, policy: true },
    });
    if (!request || request.status !== 'PENDING') return { error: 'This request has already been decided.' };

    const allowed = can(ctx, 'pto.admin') || (can(ctx, 'pto.approve') && (await isManagerOf(ctx, request.workerId)));
    if (!allowed) throw new AuthzError('Only the worker’s manager or HR can decide this request.');
    if (ctx.workerId === request.workerId) throw new AuthzError('You cannot approve your own request.');

    await db.$transaction(async (tx) => {
      await tx.ptoRequest.update({
        where: { id: requestId },
        data: {
          status: decision,
          approverId: ctx.userId,
          decidedAt: new Date(),
          decisionNote: String(formData.get('note') ?? '') || null,
        },
      });
      if (decision === 'APPROVED') {
        await tx.ptoTransaction.create({
          data: {
            workerId: request.workerId,
            policyId: request.policyId,
            kind: 'USAGE',
            hours: -Number(request.hours),
            effectiveDate: request.startDate,
            requestId,
            createdById: ctx.userId,
          },
        });
      }
    });
    if (request.worker.user?.id) {
      await notifyUser(request.worker.user.id, {
        kind: 'INFO',
        title: `Your time off was ${decision.toLowerCase()}`,
        body: `${request.policy.name}: ${request.startDate.toISOString().slice(0, 10)} → ${request.endDate.toISOString().slice(0, 10)}`,
        href: '/time/pto',
        email: true,
      });
    }
    await audit(ctx, `pto.${decision.toLowerCase()}`, { targetType: 'PtoRequest', targetId: requestId });
    if (decision === 'APPROVED') {
      await recordTimeline({
        workerId: request.workerId,
        kind: 'LEAVE',
        title: `Time off approved (${request.policy.name})`,
        visibility: 'MANAGER',
        actorUserId: ctx.userId,
      });
      await emitEvent({ type: 'PTO_APPROVED', workerId: request.workerId });
    }
    revalidatePath('/time/pto');
    return { success: `Request ${decision.toLowerCase()}.` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'Could not record the decision.' };
  }
}

export async function cancelPtoAction(formData: FormData): Promise<void> {
  const ctx = await requireCtxAction();
  const requestId = String(formData.get('requestId') ?? '');
  const request = await db.ptoRequest.findUnique({ where: { id: requestId } });
  if (!request) return;
  if (request.workerId !== ctx.workerId && !can(ctx, 'pto.admin')) throw new AuthzError();
  if (request.status === 'CANCELED' || request.status === 'DENIED') return;

  await db.$transaction(async (tx) => {
    await tx.ptoRequest.update({ where: { id: requestId }, data: { status: 'CANCELED' } });
    if (request.status === 'APPROVED') {
      // Reverse the usage so the ledger stays balanced.
      await tx.ptoTransaction.create({
        data: {
          workerId: request.workerId,
          policyId: request.policyId,
          kind: 'ADJUSTMENT',
          hours: Number(request.hours),
          effectiveDate: new Date(),
          note: 'Request canceled — usage reversed',
          requestId,
          createdById: ctx.userId,
        },
      });
    }
  });
  await audit(ctx, 'pto.canceled', { targetType: 'PtoRequest', targetId: requestId });
  revalidatePath('/time/pto');
}

export async function adjustBalanceAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    if (!can(ctx, 'pto.admin')) throw new AuthzError();
    const workerId = String(formData.get('workerId') ?? '');
    const policyId = String(formData.get('policyId') ?? '');
    const hours = Number(formData.get('hours'));
    if (!Number.isFinite(hours) || hours === 0) return { error: 'Enter a non-zero hour adjustment (± allowed).' };
    const note = String(formData.get('note') ?? '').trim();
    if (!note) return { error: 'A reason is required for manual adjustments.' };
    await db.ptoTransaction.create({
      data: { workerId, policyId, kind: 'ADJUSTMENT', hours, effectiveDate: new Date(), note, createdById: ctx.userId },
    });
    await audit(ctx, 'pto.balance_adjusted', { targetType: 'Worker', targetId: workerId, metadata: { policyId, hours, note } });
    revalidatePath('/time/pto');
    return { success: 'Balance adjusted.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not adjust the balance.' };
  }
}

// ---------------------------------------------------------------------------
// Time tracking
// ---------------------------------------------------------------------------

function weekStartOf(d: Date): Date {
  const day = startOfUTCDay(d);
  const dow = (day.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(day, -dow);
}

async function ensureTimesheet(workerId: string, forDate: Date) {
  const weekStart = weekStartOf(forDate);
  return db.timesheet.upsert({
    where: { workerId_weekStart: { workerId, weekStart } },
    create: { workerId, weekStart },
    update: {},
  });
}

export async function clockAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    if (!ctx.workerId) return { error: 'Your account is not linked to a worker profile.' };
    const now = new Date();
    const sheet = await ensureTimesheet(ctx.workerId, now);
    if (sheet.status === 'APPROVED') return { error: 'This week is already approved.' };

    const open = await db.timeEntry.findFirst({
      where: { timesheet: { workerId: ctx.workerId }, clockIn: { not: null }, clockOut: null },
      orderBy: { clockIn: 'desc' },
    });
    const mode = String(formData.get('mode') ?? '');
    if (mode === 'in') {
      if (open) return { error: 'You are already clocked in.' };
      await db.timeEntry.create({
        data: { timesheetId: sheet.id, date: startOfUTCDay(now), clockIn: now },
      });
      revalidatePath('/time/tracking');
      return { success: `Clocked in at ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.` };
    }
    if (mode === 'out') {
      if (!open) return { error: 'You are not clocked in.' };
      await db.timeEntry.update({ where: { id: open.id }, data: { clockOut: now } });
      revalidatePath('/time/tracking');
      return { success: `Clocked out at ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.` };
    }
    return { error: 'Unknown clock mode.' };
  } catch {
    return { error: 'Could not record the punch.' };
  }
}

export async function saveManualEntryAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    if (!ctx.workerId) return { error: 'Your account is not linked to a worker profile.' };
    const date = new Date(String(formData.get('date') ?? ''));
    if (Number.isNaN(date.getTime())) return { error: 'Pick a date.' };
    const hours = Number(formData.get('hours'));
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return { error: 'Enter hours between 0 and 24.' };
    const sheet = await ensureTimesheet(ctx.workerId, date);
    if (sheet.status === 'APPROVED' || sheet.status === 'SUBMITTED') {
      return { error: 'That week has been submitted — ask your manager to reject it to make corrections.' };
    }
    await db.timeEntry.create({
      data: {
        timesheetId: sheet.id,
        date: startOfUTCDay(date),
        manualHours: hours,
        projectCode: String(formData.get('projectCode') ?? '') || null,
        note: String(formData.get('note') ?? '') || null,
        editedById: ctx.userId,
      },
    });
    revalidatePath('/time/tracking');
    return { success: 'Entry added.' };
  } catch {
    return { error: 'Could not save the entry.' };
  }
}

export async function submitTimesheetAction(formData: FormData): Promise<void> {
  const ctx = await requireCtxAction();
  const sheetId = String(formData.get('timesheetId') ?? '');
  const sheet = await db.timesheet.findUniqueOrThrow({ where: { id: sheetId } });
  if (sheet.workerId !== ctx.workerId) throw new AuthzError();
  await db.timesheet.update({
    where: { id: sheetId },
    data: { status: 'SUBMITTED', submittedAt: new Date() },
  });
  await audit(ctx, 'timesheet.submitted', { targetType: 'Timesheet', targetId: sheetId });
  revalidatePath('/time/tracking');
}

export async function decideTimesheetAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    const sheetId = String(formData.get('timesheetId') ?? '');
    const decision = String(formData.get('decision') ?? '');
    const sheet = await db.timesheet.findUniqueOrThrow({ where: { id: sheetId } });
    const allowed = can(ctx, 'time.admin') || (can(ctx, 'time.approve') && (await isManagerOf(ctx, sheet.workerId)));
    if (!allowed) throw new AuthzError();
    if (decision === 'APPROVED') {
      await db.timesheet.update({
        where: { id: sheetId },
        data: { status: 'APPROVED', approvedById: ctx.userId, approvedAt: new Date() },
      });
    } else {
      await db.timesheet.update({ where: { id: sheetId }, data: { status: 'REJECTED' } });
    }
    await audit(ctx, `timesheet.${decision.toLowerCase()}`, { targetType: 'Timesheet', targetId: sheetId });
    revalidatePath('/time/tracking');
    return { success: `Timesheet ${decision.toLowerCase()}.` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not record the decision.' };
  }
}
