'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireCtxAction, requirePermission, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { recordTimeline } from '@/lib/timeline';
import { audienceWorkerIds, type Audience } from '@/lib/audience';
import { addDays } from '@/lib/format';
import type { ActionResult } from '@/app/(auth)/actions';

export async function saveCourseAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('training.admin');
    const title = String(formData.get('title') ?? '').trim();
    if (!title) return { error: 'Course title is required.' };
    const course = await db.trainingCourse.create({
      data: {
        title,
        category: String(formData.get('category') ?? 'OTHER'),
        description: String(formData.get('description') ?? '') || null,
        contentUrl: String(formData.get('contentUrl') ?? '') || null,
        durationMin: formData.get('durationMin') ? Number(formData.get('durationMin')) : null,
        dueDays: Number(formData.get('dueDays') ?? 30) || 30,
        recurrenceMonths: formData.get('recurrenceMonths') ? Number(formData.get('recurrenceMonths')) : null,
        autoAssign: formData.get('autoAssign') === 'on',
      },
    });
    await audit(ctx, 'training.course_created', { targetType: 'TrainingCourse', targetId: course.id });
    revalidatePath('/training');
    return { success: 'Course created.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the course.' };
  }
}

export async function assignTrainingAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('training.admin');
    const courseId = String(formData.get('courseId') ?? '');
    const course = await db.trainingCourse.findUniqueOrThrow({ where: { id: courseId } });
    const target = String(formData.get('target') ?? '');

    let workerIds: string[];
    if (target === 'ALL' || target === 'RULES') {
      workerIds = await audienceWorkerIds(target === 'RULES' ? (course.assignmentRules as Audience) : {});
    } else {
      workerIds = [target];
    }
    let created = 0;
    for (const workerId of workerIds) {
      const existing = await db.trainingAssignment.findFirst({
        where: { courseId, workerId, status: { in: ['ASSIGNED', 'IN_PROGRESS', 'OVERDUE'] } },
      });
      if (existing) continue;
      await db.trainingAssignment.create({
        data: { courseId, workerId, dueDate: addDays(new Date(), course.dueDays) },
      });
      created++;
    }
    await audit(ctx, 'training.assigned', { targetType: 'TrainingCourse', targetId: courseId, metadata: { count: created } });
    revalidatePath('/training');
    return { success: `Assigned to ${created} worker${created === 1 ? '' : 's'}.` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not assign the training.' };
  }
}

export async function completeTrainingAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    const assignmentId = String(formData.get('assignmentId') ?? '');
    const assignment = await db.trainingAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
      include: { course: true },
    });
    const isAdmin = ctx.permissions.has('training.admin');
    if (assignment.workerId !== ctx.workerId && !isAdmin) throw new AuthzError();

    const status = String(formData.get('status') ?? 'COMPLETED');
    if (status === 'IN_PROGRESS') {
      await db.trainingAssignment.update({ where: { id: assignmentId }, data: { status: 'IN_PROGRESS' } });
    } else {
      await db.trainingAssignment.update({
        where: { id: assignmentId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          score: formData.get('score') ? Number(formData.get('score')) : null,
          expiresAt: assignment.course.recurrenceMonths
            ? addDays(new Date(), assignment.course.recurrenceMonths * 30)
            : null,
        },
      });
      await recordTimeline({
        workerId: assignment.workerId,
        kind: 'TRAINING',
        title: `Completed training: ${assignment.course.title}`,
        visibility: 'MANAGER',
        actorUserId: ctx.userId,
      });
    }
    revalidatePath('/training');
    return { success: status === 'COMPLETED' ? 'Marked complete.' : 'Marked in progress.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not update the training.' };
  }
}
