'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { notifyUser } from '@/lib/notify';
import { overlaps, shiftHours, projectOvertime, FLSA_WEEKLY_THRESHOLD } from '@/lib/scheduling';
import type { ActionResult } from '@/app/(auth)/actions';

export async function saveShiftAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('schedule.write');
    const id = String(formData.get('shiftId') ?? '');
    const dateRaw = String(formData.get('date') ?? '');
    const startTime = String(formData.get('startTime') ?? '');
    const endTime = String(formData.get('endTime') ?? '');
    if (!dateRaw || !startTime || !endTime) return { error: 'Pick a date, a start and an end.' };

    const startsAt = new Date(`${dateRaw}T${startTime}:00Z`);
    let endsAt = new Date(`${dateRaw}T${endTime}:00Z`);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return { error: 'Invalid time.' };
    // An overnight shift ends on the following day.
    if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 86_400_000);
    if ((endsAt.getTime() - startsAt.getTime()) / 3_600_000 > 24) {
      return { error: 'A shift cannot be longer than 24 hours.' };
    }

    const breakMinutes = Number(formData.get('breakMinutes'));
    const data = {
      date: new Date(`${dateRaw}T00:00:00Z`),
      startsAt,
      endsAt,
      breakMinutes: Number.isFinite(breakMinutes) && breakMinutes >= 0 ? breakMinutes : 30,
      locationId: String(formData.get('locationId') ?? '') || null,
      departmentId: String(formData.get('departmentId') ?? '') || null,
      role: String(formData.get('role') ?? '') || null,
      note: String(formData.get('note') ?? '') || null,
    };

    const shift = id
      ? await db.shift.update({ where: { id }, data })
      : await db.shift.create({ data });
    await audit(ctx, id ? 'schedule.shift_updated' : 'schedule.shift_created', {
      targetType: 'Shift',
      targetId: shift.id,
    });
    revalidatePath('/time/schedule');
    return { success: 'Shift saved as a draft. Publish the week when the schedule is settled.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the shift.' };
  }
}

export async function deleteShiftAction(formData: FormData): Promise<void> {
  const ctx = await requirePermission('schedule.write');
  const id = String(formData.get('shiftId') ?? '');
  const shift = await db.shift.findUnique({ where: { id } });
  if (!shift) return;
  if (shift.status === 'PUBLISHED') {
    // Published shifts are cancelled, not deleted — people have seen them.
    await db.shift.update({ where: { id }, data: { status: 'CANCELED' } });
    await audit(ctx, 'schedule.shift_canceled', { targetType: 'Shift', targetId: id });
  } else {
    await db.shift.delete({ where: { id } });
    await audit(ctx, 'schedule.shift_deleted', { targetType: 'Shift', targetId: id });
  }
  revalidatePath('/time/schedule');
}

/**
 * Assign someone to a shift.
 *
 * Refuses a double-booking outright: a worker cannot be in two places at once,
 * and finding that out on the day is how a shift goes uncovered.
 */
export async function assignShiftAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('schedule.write');
    const shiftId = String(formData.get('shiftId') ?? '');
    const workerId = String(formData.get('workerId') ?? '');
    if (!workerId) return { error: 'Pick someone.' };

    const shift = await db.shift.findUniqueOrThrow({ where: { id: shiftId } });
    const sameDay = await db.shiftAssignment.findMany({
      where: {
        workerId,
        status: { in: ['ASSIGNED', 'ACCEPTED'] },
        shift: { status: { not: 'CANCELED' }, date: shift.date },
      },
      include: { shift: { select: { id: true, startsAt: true, endsAt: true } } },
    });
    const clash = sameDay.find((a) => a.shift.id !== shiftId && overlaps(shift, a.shift));
    if (clash) {
      return { error: 'That person is already on an overlapping shift that day.' };
    }

    await db.shiftAssignment.upsert({
      where: { shiftId_workerId: { shiftId, workerId } },
      create: { shiftId, workerId, assignedById: ctx.userId },
      update: { status: 'ASSIGNED' },
    });
    await audit(ctx, 'schedule.assigned', {
      targetType: 'Shift',
      targetId: shiftId,
      metadata: { workerId },
    });

    // Warn, do not block: sometimes the overtime is the right call.
    const projection = await projectOvertime(shift.date);
    const row = projection.find((p) => p.workerId === workerId);
    revalidatePath('/time/schedule');
    if (row && row.overtimeHours > 0) {
      return {
        success: `Assigned. Heads up: this puts them at ${row.projectedHours}h for the week — ${row.overtimeHours}h over the ${FLSA_WEEKLY_THRESHOLD}h threshold.`,
      };
    }
    return { success: 'Assigned.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not assign the shift.' };
  }
}

export async function unassignShiftAction(formData: FormData): Promise<void> {
  const ctx = await requirePermission('schedule.write');
  const assignmentId = String(formData.get('assignmentId') ?? '');
  const assignment = await db.shiftAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment) return;
  await db.shiftAssignment.delete({ where: { id: assignmentId } });
  await audit(ctx, 'schedule.unassigned', {
    targetType: 'Shift',
    targetId: assignment.shiftId,
    metadata: { workerId: assignment.workerId },
  });
  revalidatePath('/time/schedule');
}

/**
 * Publish a week's draft shifts.
 *
 * Publishing is deliberately a single explicit act for the whole week rather
 * than per shift, so a schedule is never half-changed in front of the people
 * working it. Everyone assigned gets told.
 */
export async function publishWeekAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('schedule.write');
    const weekStartRaw = String(formData.get('weekStart') ?? '');
    const start = new Date(`${weekStartRaw}T00:00:00Z`);
    if (Number.isNaN(start.getTime())) return { error: 'Invalid week.' };
    const end = new Date(start.getTime() + 7 * 86_400_000);

    const drafts = await db.shift.findMany({
      where: { status: 'DRAFT', date: { gte: start, lt: end } },
      include: { assignments: { include: { worker: { select: { userId: true } } } } },
    });
    if (drafts.length === 0) return { error: 'No draft shifts to publish this week.' };

    await db.shift.updateMany({
      where: { id: { in: drafts.map((d) => d.id) } },
      data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: ctx.userId },
    });

    const notified = new Set<string>();
    for (const shift of drafts) {
      for (const a of shift.assignments) {
        if (a.worker.userId && !notified.has(a.worker.userId)) {
          notified.add(a.worker.userId);
          await notifyUser(a.worker.userId, {
            title: 'Your schedule is published',
            body: `The week of ${weekStartRaw} is now available.`,
            href: '/time/schedule',
          });
        }
      }
    }
    await audit(ctx, 'schedule.published', {
      metadata: { weekStart: weekStartRaw, shifts: drafts.length, notified: notified.size },
    });
    revalidatePath('/time/schedule');
    return { success: `Published ${drafts.length} shift(s). ${notified.size} people notified.` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not publish the week.' };
  }
}

export { shiftHours };
