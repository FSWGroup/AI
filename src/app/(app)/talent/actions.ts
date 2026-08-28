'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireCtxAction, can, isManagerOf, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { recordTimeline } from '@/lib/timeline';
import { notifyUser } from '@/lib/notify';
import { emitEvent } from '@/lib/workflows';
import type { ActionResult } from '@/app/(auth)/actions';

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export async function saveGoalAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    const goalId = String(formData.get('goalId') ?? '');
    const title = String(formData.get('title') ?? '').trim();
    if (!title) return { error: 'Goal title is required.' };
    const level = String(formData.get('level') ?? 'INDIVIDUAL');
    let workerId = String(formData.get('workerId') ?? '') || ctx.workerId;

    if (level !== 'INDIVIDUAL') {
      if (!can(ctx, 'talent.admin')) throw new AuthzError('Only HR can create company/department goals.');
      workerId = null;
    } else if (workerId !== ctx.workerId) {
      const allowed = can(ctx, 'talent.admin') || (workerId && (await isManagerOf(ctx, workerId)));
      if (!allowed) throw new AuthzError();
    }

    const data = {
      title,
      description: String(formData.get('description') ?? '') || null,
      level,
      workerId: level === 'INDIVIDUAL' ? workerId : null,
      weight: formData.get('weight') ? Number(formData.get('weight')) : null,
      dueDate: formData.get('dueDate') ? new Date(String(formData.get('dueDate'))) : null,
      parentId: String(formData.get('parentId') ?? '') || null,
      status: 'ACTIVE',
    };
    if (goalId) {
      await db.goal.update({ where: { id: goalId }, data });
    } else {
      await db.goal.create({ data: { ...data, createdById: ctx.userId } });
    }
    revalidatePath('/talent/goals');
    return { success: 'Goal saved.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the goal.' };
  }
}

export async function updateGoalProgressAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    const goalId = String(formData.get('goalId') ?? '');
    const goal = await db.goal.findUniqueOrThrow({ where: { id: goalId } });
    const canEdit =
      goal.workerId === ctx.workerId ||
      can(ctx, 'talent.admin') ||
      (goal.workerId ? await isManagerOf(ctx, goal.workerId) : can(ctx, 'talent.admin'));
    if (!canEdit) throw new AuthzError();
    const progress = Math.max(0, Math.min(100, Number(formData.get('progress') ?? 0)));
    await db.goal.update({
      where: { id: goalId },
      data: { progress, status: progress >= 100 ? 'COMPLETED' : 'ACTIVE' },
    });
    revalidatePath('/talent/goals');
    return { success: 'Progress updated.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not update progress.' };
  }
}

// ---------------------------------------------------------------------------
// Review cycles
// ---------------------------------------------------------------------------

const DEFAULT_QUESTIONS = [
  { id: 'q1', text: 'What were the biggest accomplishments this period?', type: 'TEXT', forms: ['SELF', 'MANAGER'] },
  { id: 'q2', text: 'Where is there room to grow next period?', type: 'TEXT', forms: ['SELF', 'MANAGER'] },
  { id: 'q3', text: 'How did work align with goals?', type: 'TEXT', forms: ['SELF', 'MANAGER'] },
  { id: 'q4', text: 'Overall performance rating', type: 'RATING', forms: ['MANAGER'] },
];

export async function createCycleAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    if (!can(ctx, 'talent.admin')) throw new AuthzError();
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { error: 'Cycle name is required.' };
    const cycle = await db.reviewCycle.create({
      data: {
        name,
        kind: String(formData.get('kind') ?? 'ANNUAL'),
        startDate: new Date(String(formData.get('startDate') ?? new Date().toISOString())),
        dueDate: new Date(String(formData.get('dueDate') ?? new Date().toISOString())),
        questions: DEFAULT_QUESTIONS,
        status: 'OPEN',
      },
    });

    // Launch: create SELF + MANAGER reviews for every active employee with a manager.
    const workers = await db.worker.findMany({
      where: { status: 'ACTIVE', deletedAt: null, workerType: 'EMPLOYEE' },
      include: { employments: { where: { effectiveTo: null }, take: 1 } },
    });
    let created = 0;
    for (const w of workers) {
      const managerId = w.employments[0]?.managerId;
      await db.performanceReview.create({
        data: { cycleId: cycle.id, subjectId: w.id, authorId: w.id, form: 'SELF' },
      });
      created++;
      if (managerId) {
        await db.performanceReview.create({
          data: { cycleId: cycle.id, subjectId: w.id, authorId: managerId, form: 'MANAGER' },
        });
        created++;
      }
    }
    await audit(ctx, 'talent.cycle_created', { targetType: 'ReviewCycle', targetId: cycle.id, metadata: { reviews: created } });
    await emitEvent({ type: 'REVIEW_CYCLE_STARTED' });
    revalidatePath('/talent/reviews');
    return { success: `Cycle launched with ${created} review forms.` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'Could not create the cycle.' };
  }
}

export async function saveReviewAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    const reviewId = String(formData.get('reviewId') ?? '');
    const review = await db.performanceReview.findUniqueOrThrow({ where: { id: reviewId } });
    if (review.authorId !== ctx.workerId && !can(ctx, 'talent.admin')) {
      throw new AuthzError('This review form belongs to someone else.');
    }
    if (review.status === 'SUBMITTED' || review.status === 'SHARED') {
      return { error: 'This review has been submitted and can no longer be edited.' };
    }
    const answers: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith('answer_')) answers[key.slice(7)] = String(value);
    }
    const submit = formData.get('submit') === 'true';
    const rating = formData.get('answer_q4') ? Number(formData.get('answer_q4')) : null;

    await db.performanceReview.update({
      where: { id: reviewId },
      data: {
        answers,
        overallRating: Number.isFinite(rating) ? rating : null,
        summary: String(formData.get('summary') ?? '') || null,
        status: submit ? 'SUBMITTED' : 'IN_PROGRESS',
        submittedAt: submit ? new Date() : null,
      },
    });
    if (submit) {
      await audit(ctx, 'talent.review_submitted', { targetType: 'PerformanceReview', targetId: reviewId });
      await recordTimeline({
        workerId: review.subjectId,
        kind: 'REVIEW',
        title: `${review.form === 'SELF' ? 'Self review' : 'Manager review'} submitted`,
        visibility: 'MANAGER',
        actorUserId: ctx.userId,
      });
    }
    revalidatePath('/talent/reviews');
    return { success: submit ? 'Review submitted.' : 'Draft saved.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the review.' };
  }
}

export async function shareReviewAction(formData: FormData): Promise<void> {
  const ctx = await requireCtxAction();
  const reviewId = String(formData.get('reviewId') ?? '');
  const review = await db.performanceReview.findUniqueOrThrow({
    where: { id: reviewId },
    include: { subject: { include: { user: { select: { id: true } } } } },
  });
  if (review.authorId !== ctx.workerId && !can(ctx, 'talent.admin')) throw new AuthzError();
  if (review.status !== 'SUBMITTED') throw new AuthzError('Submit the review before sharing.');
  await db.performanceReview.update({ where: { id: reviewId }, data: { status: 'SHARED', sharedAt: new Date() } });
  if (review.subject.user?.id) {
    await notifyUser(review.subject.user.id, {
      kind: 'INFO',
      title: 'Your performance review has been shared with you',
      href: `/talent/reviews/${reviewId}`,
      email: true,
    });
  }
  await audit(ctx, 'talent.review_shared', { targetType: 'PerformanceReview', targetId: reviewId });
  revalidatePath('/talent/reviews');
}

// ---------------------------------------------------------------------------
// 1:1s
// ---------------------------------------------------------------------------

export async function saveOneOnOneAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    if (!ctx.workerId) return { error: 'Your account is not linked to a worker profile.' };
    const id = String(formData.get('oooId') ?? '');

    if (id) {
      const existing = await db.oneOnOne.findUniqueOrThrow({ where: { id } });
      const isManagerSide = existing.managerId === ctx.workerId;
      const isReportSide = existing.reportId === ctx.workerId;
      if (!isManagerSide && !isReportSide) throw new AuthzError();
      await db.oneOnOne.update({
        where: { id },
        data: {
          ...(formData.has('agenda') ? { agenda: String(formData.get('agenda')) || null } : {}),
          ...(formData.has('sharedNotes') ? { sharedNotes: String(formData.get('sharedNotes')) || null } : {}),
          // Private notes are only writable (and readable) by their own side.
          ...(isManagerSide && formData.has('managerNotes') ? { managerNotes: String(formData.get('managerNotes')) || null } : {}),
          ...(isReportSide && formData.has('reportNotes') ? { reportNotes: String(formData.get('reportNotes')) || null } : {}),
          ...(formData.get('complete') === 'true' ? { status: 'COMPLETED' } : {}),
        },
      });
      revalidatePath('/talent/one-on-ones');
      return { success: 'Saved.' };
    }

    const reportId = String(formData.get('reportId') ?? '');
    if (!(await isManagerOf(ctx, reportId))) throw new AuthzError('You can only schedule 1:1s with your reports.');
    const scheduledAt = new Date(String(formData.get('scheduledAt') ?? ''));
    if (Number.isNaN(scheduledAt.getTime())) return { error: 'Pick a date and time.' };
    await db.oneOnOne.create({
      data: { managerId: ctx.workerId, reportId, scheduledAt, agenda: String(formData.get('agenda') ?? '') || null },
    });
    revalidatePath('/talent/one-on-ones');
    return { success: '1:1 scheduled.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the 1:1.' };
  }
}

// ---------------------------------------------------------------------------
// Feedback / recognition
// ---------------------------------------------------------------------------

export async function saveFeedbackAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    if (!ctx.workerId) return { error: 'Your account is not linked to a worker profile.' };
    const aboutId = String(formData.get('aboutId') ?? '');
    const body = String(formData.get('body') ?? '').trim();
    if (!aboutId || !body) return { error: 'Pick a person and write the feedback.' };
    const kind = String(formData.get('kind') ?? 'FEEDBACK');
    if (kind === 'PRIVATE_HR' && !can(ctx, 'cases.write')) throw new AuthzError();
    const visibility =
      kind === 'PRAISE' ? 'PUBLIC' : kind === 'PRIVATE_HR' ? 'HR' : String(formData.get('visibility') ?? 'MANAGER');
    await db.feedback.create({
      data: { aboutId, authorId: ctx.workerId, kind, visibility, body: body.slice(0, 4000) },
    });
    const about = await db.worker.findUnique({ where: { id: aboutId }, include: { user: { select: { id: true } } } });
    if (kind === 'PRAISE' && about?.user?.id) {
      await notifyUser(about.user.id, { kind: 'INFO', title: 'You received recognition 🎉', href: '/talent/feedback' });
    }
    revalidatePath('/talent/feedback');
    return { success: kind === 'PRAISE' ? 'Recognition posted.' : 'Feedback recorded.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the feedback.' };
  }
}

// ---------------------------------------------------------------------------
// HR cases (confidential)
// ---------------------------------------------------------------------------

export async function saveHrCaseAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    if (!can(ctx, 'cases.write')) throw new AuthzError();
    const caseId = String(formData.get('caseId') ?? '');
    const workerId = String(formData.get('workerId') ?? '');
    const title = String(formData.get('title') ?? '').trim();
    if (!caseId && (!workerId || !title)) return { error: 'Worker and title are required.' };

    if (caseId) {
      await db.hrCase.update({
        where: { id: caseId },
        data: {
          status: String(formData.get('status') ?? 'OPEN'),
          resolution: String(formData.get('resolution') ?? '') || null,
          followUpDate: formData.get('followUpDate') ? new Date(String(formData.get('followUpDate'))) : null,
          ...(String(formData.get('status')) === 'CLOSED' ? { closedAt: new Date() } : {}),
        },
      });
      await audit(ctx, 'hr_case.updated', { targetType: 'HrCase', targetId: caseId });
      revalidatePath('/people/cases');
      return { success: 'Case updated.' };
    }

    const hrCase = await db.hrCase.create({
      data: {
        workerId,
        caseType: String(formData.get('caseType') ?? 'COACHING'),
        title,
        description: String(formData.get('description') ?? '') || null,
        ownerUserId: ctx.userId,
        followUpDate: formData.get('followUpDate') ? new Date(String(formData.get('followUpDate'))) : null,
      },
    });
    await recordTimeline({
      workerId,
      kind: 'HR_CASE',
      title: `HR case opened (${String(formData.get('caseType') ?? '').toLowerCase().replace(/_/g, ' ')})`,
      visibility: 'HR_CONFIDENTIAL',
      actorUserId: ctx.userId,
    });
    await audit(ctx, 'hr_case.created', { targetType: 'HrCase', targetId: hrCase.id });
    revalidatePath('/people/cases');
    return { success: 'Case opened.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the case.' };
  }
}

export async function addCaseNoteAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    if (!can(ctx, 'cases.write')) throw new AuthzError();
    const caseId = String(formData.get('caseId') ?? '');
    const body = String(formData.get('body') ?? '').trim();
    if (!body) return { error: 'Write the note first.' };
    await db.hrCaseNote.create({ data: { caseId, authorUserId: ctx.userId, body: body.slice(0, 4000) } });
    await audit(ctx, 'hr_case.note_added', { targetType: 'HrCase', targetId: caseId });
    revalidatePath('/people/cases');
    return { success: 'Note added.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not add the note.' };
  }
}
