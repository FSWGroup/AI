"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertPermission } from "@/lib/auth/guard";
import {
  startAttempt,
  submitAttempt,
  getAttemptReview,
  ServiceError as AssessmentError,
} from "@/lib/services/assessment";
import {
  recordAcknowledgement,
  recordPracticalAssessment,
  submitAssignmentProject,
  recordLessonProgress,
  ServiceError as CompletionError,
} from "@/lib/services/completion";
import type { PracticalRating } from "@prisma/client";
import type { QuizAttemptView, QuizReview, QuizSubmitResult } from "@/components/lesson/types";

type Outcome<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function revalidateLesson(lessonId: string): Promise<void> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { section: { select: { courseId: true } } },
  });
  if (!lesson) return;
  revalidatePath(`/courses/${lesson.section.courseId}/lessons/${lessonId}`);
  revalidatePath(`/courses/${lesson.section.courseId}`);
}

function serviceMessage(error: unknown, fallback: string): string {
  if (error instanceof AssessmentError || error instanceof CompletionError) return error.message;
  console.error("[courses.lesson.action]", error);
  return fallback;
}

// ---------------------------------------------------------------------------
// Quiz engine
// ---------------------------------------------------------------------------

export async function startQuizAttemptAction(lessonId: string): Promise<Outcome<QuizAttemptView>> {
  const actor = await assertPermission("training.view");
  try {
    const attempt = await startAttempt(actor, lessonId);
    return {
      ok: true,
      data: {
        id: attempt.id,
        status: attempt.status,
        attemptNumber: attempt.attemptNumber,
        attemptsRemaining: attempt.attemptsRemaining,
        questions: attempt.questions,
        oneQuestionAtATime: attempt.oneQuestionAtATime,
      },
    };
  } catch (error) {
    return { ok: false, error: serviceMessage(error, "Couldn't start this quiz.") };
  }
}

export async function submitQuizAttemptAction(
  attemptId: string,
  answers: Record<string, unknown>,
): Promise<Outcome<QuizSubmitResult>> {
  const actor = await assertPermission("training.view");
  try {
    const result = await submitAttempt(actor, attemptId, answers);
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: serviceMessage(error, "Couldn't submit this quiz.") };
  }
}

export async function getQuizReviewAction(attemptId: string): Promise<Outcome<QuizReview>> {
  const actor = await assertPermission("training.view");
  try {
    const review = await getAttemptReview(actor, attemptId);
    return {
      ok: true,
      data: {
        id: review.id,
        status: review.status,
        scorePercent: review.scorePercent,
        responses: review.responses,
      },
    };
  } catch (error) {
    return { ok: false, error: serviceMessage(error, "Couldn't load your review.") };
  }
}

// ---------------------------------------------------------------------------
// Acknowledgement / signature — IP and User-Agent are read server-side here,
// never trusted from the client.
// ---------------------------------------------------------------------------

export async function acknowledgeAction(input: { lessonId: string; typedSignature?: string }): Promise<Outcome> {
  const actor = await assertPermission("training.view");

  const lesson = await prisma.lesson.findUnique({
    where: { id: input.lessonId },
    select: { content: true },
  });
  if (!lesson) return { ok: false, error: "Lesson not found." };
  const content = (lesson.content ?? {}) as { statement?: string; sopId?: string | null };
  if (!content.statement) return { ok: false, error: "This lesson has no statement configured." };

  let sopVersionId: string | undefined;
  if (content.sopId) {
    const sop = await prisma.sop.findUnique({ where: { id: content.sopId }, select: { currentVersionId: true } });
    sopVersionId = sop?.currentVersionId ?? undefined;
  }

  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
  const userAgent = h.get("user-agent") ?? undefined;

  try {
    await recordAcknowledgement(actor, {
      statement: content.statement,
      sopVersionId,
      lessonId: input.lessonId,
      typedSignature: input.typedSignature,
      ip,
      userAgent,
    });
    await revalidateLesson(input.lessonId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: serviceMessage(error, "Couldn't record your acknowledgement.") };
  }
}

// ---------------------------------------------------------------------------
// Manager sign-off / practical demo
// ---------------------------------------------------------------------------

export async function assessPracticalAction(input: {
  lessonId: string;
  userId: string;
  rating: PracticalRating;
  comments?: string;
}): Promise<Outcome> {
  const actor = await assertPermission("training.view");
  try {
    await recordPracticalAssessment(actor, input);
    await revalidateLesson(input.lessonId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: serviceMessage(error, "Couldn't record this assessment.") };
  }
}

// ---------------------------------------------------------------------------
// Assignment project submission
// ---------------------------------------------------------------------------

export async function submitProjectAction(input: {
  lessonId: string;
  mediaId?: string;
  note?: string;
}): Promise<Outcome> {
  const actor = await assertPermission("training.view");
  try {
    await submitAssignmentProject(actor, input.lessonId, { mediaId: input.mediaId, note: input.note });
    await revalidateLesson(input.lessonId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: serviceMessage(error, "Couldn't submit your work.") };
  }
}

// ---------------------------------------------------------------------------
// Live session registration
// ---------------------------------------------------------------------------

export async function registerForSessionAction(lessonId: string): Promise<Outcome> {
  const actor = await assertPermission("training.view");

  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { content: true } });
  const liveSessionId = (lesson?.content as { liveSessionId?: string | null } | null)?.liveSessionId;
  if (!liveSessionId) return { ok: false, error: "No session is scheduled for this lesson." };

  const session = await prisma.liveSession.findUnique({
    where: { id: liveSessionId },
    select: { capacity: true, _count: { select: { attendance: true } } },
  });
  if (!session) return { ok: false, error: "Session not found." };

  const already = await prisma.sessionAttendance.findUnique({
    where: { sessionId_userId: { sessionId: liveSessionId, userId: actor.id } },
  });
  if (!already && session.capacity !== null && session._count.attendance >= session.capacity) {
    return { ok: false, error: "This session is full." };
  }

  await prisma.sessionAttendance.upsert({
    where: { sessionId_userId: { sessionId: liveSessionId, userId: actor.id } },
    create: { sessionId: liveSessionId, userId: actor.id, status: "REGISTERED" },
    update: {},
  });

  // Registering is the learner-actionable completion event for this lesson type —
  // actual attendance is tracked separately on the session for reporting.
  try {
    await recordLessonProgress(actor, lessonId, { markComplete: true });
  } catch (error) {
    console.error("[courses.lesson.registerForSession] progress update failed", error);
  }

  await revalidateLesson(lessonId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Discussion comments
// ---------------------------------------------------------------------------

export async function postCommentAction(input: {
  lessonId: string;
  body: string;
  parentId?: string;
}): Promise<Outcome> {
  const actor = await assertPermission("training.view");
  const body = input.body.trim();
  if (!body) return { ok: false, error: "Write something before posting." };

  await prisma.contentComment.create({
    data: { entityType: "LESSON", entityId: input.lessonId, authorId: actor.id, body, parentId: input.parentId ?? null },
  });
  await revalidateLesson(input.lessonId);
  return { ok: true };
}
