import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { QuestionType } from "@prisma/client";
import type { Actor } from "@/lib/auth/guard";
import { actorHas, AuthorizationError } from "@/lib/auth/guard";
import type { Permission } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import { markLessonComplete } from "@/lib/services/completion";

/**
 * The quiz engine.
 *
 * gradeQuestion() and gradeAttempt() are pure — no Prisma, no I/O — so they
 * are unit-testable without a database. Everything else in this file wires
 * that pure logic to QuizAttempt/QuizResponse rows.
 */

export class ServiceError extends Error {}

function requireCap(actor: Actor, permission: Permission): void {
  if (!actorHas(actor, permission)) throw new AuthorizationError(permission);
}

/** No configurable field exists for this yet, so it is a fixed platform constant. */
const RETRY_COOLDOWN_HOURS = 24;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Pure grading
//
// Lives in ./grading so it can be unit tested without the database or session
// layer. Re-exported here so callers have a single import site.
// ---------------------------------------------------------------------------

import { asRecord, gradeAttempt, gradeQuestion, shuffle } from "@/lib/services/grading";

export {
  gradeAttempt,
  gradeQuestion,
  type AttemptGradeSummary,
  type GradableQuestion,
  type GradeResult,
} from "@/lib/services/grading";


interface QuestionOrderEntry {
  questionId: string;
  /** For choice-type questions: presented-position -> canonical index. */
  optionOrder?: number[];
}
interface QuestionOrder {
  questions: QuestionOrderEntry[];
}

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

export interface PresentedQuestion {
  id: string;
  type: QuestionType;
  order: number;
  prompt: string;
  points: number;
  required: boolean;
  /** Sanitized — never includes correct-answer fields. */
  presentation: Record<string, unknown>;
  explanation: string | null;
}

export interface AttemptView {
  id: string;
  status: string;
  attemptNumber: number;
  attemptsRemaining: number | null;
  startedAt: Date;
  questions: PresentedQuestion[];
  oneQuestionAtATime: boolean;
}

/** Strip correct-answer material from a question's config before it reaches the learner. */
function sanitizeConfigForPresentation(
  type: QuestionType,
  config: unknown,
  optionOrder: number[] | undefined,
): Record<string, unknown> {
  const cfg = asRecord(config);
  switch (type) {
    case "MULTIPLE_CHOICE":
    case "MULTIPLE_SELECT": {
      const options = Array.isArray(cfg.options) ? (cfg.options as string[]) : [];
      const order = optionOrder ?? options.map((_, i) => i);
      return { options: order.map((i) => options[i] ?? ""), optionOrder: order };
    }
    case "TRUE_FALSE":
      return {};
    case "FILL_BLANK":
    case "SHORT_ANSWER":
    case "LONG_ANSWER":
      return {};
    case "MATCHING": {
      const pairs = Array.isArray(cfg.pairs) ? (cfg.pairs as { left: string; right: string }[]) : [];
      const order = optionOrder ?? pairs.map((_, i) => i);
      return {
        left: pairs.map((p) => p.left),
        right: order.map((i) => pairs[i]?.right ?? ""),
        rightOrder: order,
      };
    }
    case "ORDERING": {
      const items = Array.isArray(cfg.items) ? (cfg.items as string[]) : [];
      const order = optionOrder ?? items.map((_, i) => i);
      return { items: order.map((i) => items[i] ?? ""), itemOrder: order };
    }
    case "SCENARIO": {
      const choices = Array.isArray(cfg.choices) ? (cfg.choices as { id: string; label: string }[]) : [];
      return { choices: choices.map((c) => ({ id: c.id, label: c.label })) };
    }
    case "FILE_SUBMISSION":
      return { instructions: typeof cfg.instructions === "string" ? cfg.instructions : undefined };
    default:
      return {};
  }
}

function isChoiceType(type: QuestionType): boolean {
  return type === "MULTIPLE_CHOICE" || type === "MULTIPLE_SELECT" || type === "MATCHING" || type === "ORDERING";
}

async function toAttemptView(
  attempt: {
    id: string;
    status: string;
    attemptNumber: number;
    startedAt: Date;
    questionOrder: unknown;
  },
  questions: {
    id: string;
    type: QuestionType;
    order: number;
    prompt: string;
    points: number;
    required: boolean;
    config: unknown;
    explanation: string | null;
  }[],
  attemptLimit: number | null,
  oneQuestionAtATime: boolean,
): Promise<AttemptView> {
  const fallbackOrder: QuestionOrder = { questions: questions.map((q) => ({ questionId: q.id })) };
  const order = (attempt.questionOrder as QuestionOrder | null) ?? fallbackOrder;
  const orderMap = new Map(order.questions.map((q) => [q.questionId, q.optionOrder]));
  const byId = new Map(questions.map((q) => [q.id, q]));

  const presented: PresentedQuestion[] = order.questions
    .map((entry) => byId.get(entry.questionId))
    .filter((q): q is (typeof questions)[number] => Boolean(q))
    .map((q) => ({
      id: q.id,
      type: q.type,
      order: q.order,
      prompt: q.prompt,
      points: q.points,
      required: q.required,
      presentation: sanitizeConfigForPresentation(q.type, q.config, orderMap.get(q.id)),
      explanation: q.explanation,
    }));

  return {
    id: attempt.id,
    status: attempt.status,
    attemptNumber: attempt.attemptNumber,
    attemptsRemaining: attemptLimit ? Math.max(0, attemptLimit - attempt.attemptNumber) : null,
    startedAt: attempt.startedAt,
    questions: presented,
    oneQuestionAtATime,
  };
}

export async function startAttempt(actor: Actor, lessonId: string): Promise<AttemptView> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      id: true,
      type: true,
      content: true,
      section: { select: { course: { select: { id: true, attemptLimit: true, currentVersionId: true } } } },
      questions: {
        orderBy: { order: "asc" },
        select: { id: true, type: true, order: true, prompt: true, points: true, required: true, config: true, explanation: true },
      },
    },
  });
  if (!lesson || lesson.type !== "QUIZ") throw new ServiceError("Quiz lesson not found.");
  if (lesson.questions.length === 0) throw new ServiceError("This quiz has no questions yet.");

  const course = lesson.section.course;
  const content = (lesson.content ?? {}) as Record<string, unknown>;
  const oneQuestionAtATime = content.oneQuestionAtATime !== false;
  const shuffleQuestions = content.shuffleQuestions !== false;
  const shuffleAnswers = content.shuffleAnswers !== false;
  const poolSize = typeof content.poolSize === "number" ? content.poolSize : undefined;

  const existingInProgress = await prisma.quizAttempt.findFirst({
    where: { userId: actor.id, lessonId, status: "IN_PROGRESS" },
  });
  if (existingInProgress) {
    return toAttemptView(existingInProgress, lesson.questions, course.attemptLimit, oneQuestionAtATime);
  }

  const priorAttempts = await prisma.quizAttempt.findMany({
    where: { userId: actor.id, lessonId },
    orderBy: { attemptNumber: "desc" },
    select: { attemptNumber: true, status: true, submittedAt: true },
  });
  const completedAttempts = priorAttempts.filter((a) => a.status !== "IN_PROGRESS");

  if (course.attemptLimit && completedAttempts.length >= course.attemptLimit) {
    throw new ServiceError(
      `You've used all ${course.attemptLimit} allowed attempt${course.attemptLimit === 1 ? "" : "s"} for this quiz.`,
    );
  }

  const mostRecent = completedAttempts[0];
  if (mostRecent?.status === "FAILED" && mostRecent.submittedAt) {
    const cooldownEnds = new Date(mostRecent.submittedAt.getTime() + RETRY_COOLDOWN_HOURS * 60 * 60 * 1000);
    if (cooldownEnds.getTime() > Date.now()) {
      const hoursLeft = Math.ceil((cooldownEnds.getTime() - Date.now()) / (60 * 60 * 1000));
      throw new ServiceError(
        `You can retry this quiz in ${hoursLeft} hour${hoursLeft === 1 ? "" : "s"}. A cooldown applies after a failed attempt.`,
      );
    }
  }

  const attemptNumber = (priorAttempts[0]?.attemptNumber ?? 0) + 1;
  const seed = Date.now() ^ attemptNumber ^ hashString(actor.id + lessonId);

  let pool = [...lesson.questions];
  if (poolSize && poolSize < pool.length) {
    pool = shuffle(pool, seed).slice(0, poolSize).sort((a, b) => a.order - b.order);
  }
  const orderedQuestions = shuffleQuestions ? shuffle(pool, seed + 1) : pool;

  const questionOrder: QuestionOrder = {
    questions: orderedQuestions.map((q, i) => {
      if (!shuffleAnswers || !isChoiceType(q.type)) return { questionId: q.id };
      const cfg = asRecord(q.config);
      const length =
        q.type === "MATCHING"
          ? Array.isArray(cfg.pairs)
            ? cfg.pairs.length
            : 0
          : q.type === "ORDERING"
            ? Array.isArray(cfg.items)
              ? cfg.items.length
              : 0
            : Array.isArray(cfg.options)
              ? cfg.options.length
              : 0;
      const indices = Array.from({ length }, (_, k) => k);
      return { questionId: q.id, optionOrder: shuffle(indices, seed + 2 + i) };
    }),
  };

  const attempt = await prisma.quizAttempt.create({
    data: {
      userId: actor.id,
      lessonId,
      courseVersionId: course.currentVersionId,
      attemptNumber,
      status: "IN_PROGRESS",
      questionOrder: questionOrder as unknown as Prisma.InputJsonValue,
    },
  });

  return toAttemptView(attempt, lesson.questions, course.attemptLimit, oneQuestionAtATime);
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return hash;
}

export interface SubmitAttemptResult {
  status: string;
  scorePercent: number;
  pointsEarned: number;
  pointsPossible: number;
  passed: boolean | null;
  hasPendingManualGrading: boolean;
}

export async function submitAttempt(
  actor: Actor,
  attemptId: string,
  answers: Record<string, unknown>,
): Promise<SubmitAttemptResult> {
  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    select: { id: true, userId: true, lessonId: true, status: true, startedAt: true },
  });
  if (!attempt || attempt.userId !== actor.id) throw new ServiceError("Attempt not found.");
  if (attempt.status !== "IN_PROGRESS") throw new ServiceError("This attempt has already been submitted.");

  // QuizAttempt.lessonId is a plain scalar FK (no Prisma relation is declared
  // on Lesson back to QuizAttempt), so the lesson is fetched separately.
  const lesson = await prisma.lesson.findUniqueOrThrow({
    where: { id: attempt.lessonId },
    select: {
      section: { select: { courseId: true, course: { select: { passingScore: true } } } },
      questions: { select: { id: true, type: true, config: true, points: true } },
    },
  });

  const settings = await getSettings();
  const passingScore = lesson.section.course.passingScore ?? settings.training.defaultPassingScore;

  const summary = gradeAttempt(lesson.questions, answers);

  await prisma.$transaction([
    ...lesson.questions.map((question) => {
      const result = summary.perQuestion[question.id] ?? {
        isCorrect: null,
        pointsEarned: 0,
        pointsPossible: question.points,
        needsManualGrading: true,
      };
      return prisma.quizResponse.upsert({
        where: { attemptId_questionId: { attemptId, questionId: question.id } },
        create: {
          attemptId,
          questionId: question.id,
          questionSnapshot: question as unknown as Prisma.InputJsonValue,
          answer: (answers[question.id] ?? null) as Prisma.InputJsonValue,
          isCorrect: result.isCorrect,
          pointsEarned: result.pointsEarned,
        },
        update: {
          answer: (answers[question.id] ?? null) as Prisma.InputJsonValue,
          isCorrect: result.isCorrect,
          pointsEarned: result.pointsEarned,
        },
      });
    }),
    prisma.quizAttempt.update({
      where: { id: attemptId },
      data: {
        status: summary.hasPendingManualGrading
          ? "SUBMITTED"
          : summary.scorePercent >= passingScore
            ? "PASSED"
            : "FAILED",
        scorePercent: summary.scorePercent,
        pointsEarned: summary.pointsEarned,
        pointsPossible: summary.pointsPossible,
        submittedAt: new Date(),
      },
    }),
  ]);

  const passed = summary.hasPendingManualGrading ? null : summary.scorePercent >= passingScore;

  if (passed) {
    await markLessonComplete(attempt.userId, attempt.lessonId, lesson.section.courseId, {
      score: summary.scorePercent,
    });
  }

  return {
    status: summary.hasPendingManualGrading ? "SUBMITTED" : passed ? "PASSED" : "FAILED",
    scorePercent: summary.scorePercent,
    pointsEarned: summary.pointsEarned,
    pointsPossible: summary.pointsPossible,
    passed,
    hasPendingManualGrading: summary.hasPendingManualGrading,
  };
}

export async function gradeResponseManually(
  actor: Actor,
  responseId: string,
  pointsEarned: number,
  feedback?: string,
): Promise<void> {
  if (!actorHas(actor, "training.complete_override") && !actorHas(actor, "team.approve")) {
    throw new AuthorizationError("training.complete_override or team.approve");
  }

  const response = await prisma.quizResponse.findUnique({
    where: { id: responseId },
    select: {
      id: true,
      attemptId: true,
      question: { select: { points: true } },
      attempt: { select: { id: true, userId: true, lessonId: true } },
    },
  });
  if (!response) throw new ServiceError("Response not found.");

  const lesson = await prisma.lesson.findUniqueOrThrow({
    where: { id: response.attempt.lessonId },
    select: { section: { select: { courseId: true, course: { select: { passingScore: true } } } } },
  });

  const clamped = Math.max(0, Math.min(response.question.points, pointsEarned));

  await prisma.quizResponse.update({
    where: { id: responseId },
    data: { pointsEarned: clamped, isCorrect: clamped >= response.question.points, feedback: feedback ?? null },
  });

  const allResponses = await prisma.quizResponse.findMany({
    where: { attemptId: response.attemptId },
    select: { pointsEarned: true, question: { select: { points: true } } },
  });
  const pointsEarnedTotal = allResponses.reduce((sum, r) => sum + (r.pointsEarned ?? 0), 0);
  const pointsPossible = allResponses.reduce((sum, r) => sum + r.question.points, 0);
  const scorePercent = pointsPossible > 0 ? round2((pointsEarnedTotal / pointsPossible) * 100) : 0;
  const settings = await getSettings();
  const passingScore = lesson.section.course.passingScore ?? settings.training.defaultPassingScore;
  const passed = scorePercent >= passingScore;

  await prisma.quizAttempt.update({
    where: { id: response.attemptId },
    data: {
      scorePercent,
      pointsEarned: pointsEarnedTotal,
      pointsPossible,
      status: passed ? "PASSED" : "FAILED",
      gradedAt: new Date(),
      gradedById: actor.id,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "assessment.manual_grade",
    entityType: "QUIZ_RESPONSE",
    entityId: responseId,
    metadata: { pointsEarned: clamped, passed },
  });

  if (passed) {
    await markLessonComplete(response.attempt.userId, response.attempt.lessonId, lesson.section.courseId, {
      score: scorePercent,
    });
  }
}

export interface AttemptReview {
  id: string;
  status: string;
  scorePercent: number | null;
  submittedAt: Date | null;
  responses: {
    questionId: string;
    prompt: string;
    type: QuestionType;
    answer: unknown;
    isCorrect: boolean | null;
    pointsEarned: number | null;
    pointsPossible: number;
    explanation: string | null;
    feedback: string | null;
  }[];
}

export async function getAttemptReview(actor: Actor, attemptId: string): Promise<AttemptReview> {
  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      userId: true,
      lessonId: true,
      status: true,
      scorePercent: true,
      submittedAt: true,
      responses: {
        select: {
          questionId: true,
          answer: true,
          isCorrect: true,
          pointsEarned: true,
          feedback: true,
          question: { select: { prompt: true, type: true, points: true, explanation: true } },
        },
      },
    },
  });
  if (!attempt) throw new ServiceError("Attempt not found.");
  if (attempt.userId !== actor.id && !actorHas(actor, "training.complete_override") && !actorHas(actor, "team.approve")) {
    throw new AuthorizationError("training.complete_override");
  }

  const lesson = await prisma.lesson.findUniqueOrThrow({
    where: { id: attempt.lessonId },
    select: { content: true },
  });
  const content = (lesson.content ?? {}) as Record<string, unknown>;
  const reviewPolicy = (content.reviewPolicy as string) ?? "immediate";
  const showExplanations = content.showExplanations !== false;
  const canReveal =
    reviewPolicy === "immediate" || (reviewPolicy === "after_pass" && attempt.status === "PASSED");

  return {
    id: attempt.id,
    status: attempt.status,
    scorePercent: attempt.scorePercent,
    submittedAt: attempt.submittedAt,
    responses: attempt.responses.map((r) => ({
      questionId: r.questionId,
      prompt: r.question.prompt,
      type: r.question.type,
      answer: r.answer,
      isCorrect: canReveal ? r.isCorrect : null,
      pointsEarned: canReveal ? r.pointsEarned : null,
      pointsPossible: r.question.points,
      explanation: canReveal && showExplanations ? r.question.explanation : null,
      feedback: r.feedback,
    })),
  };
}
