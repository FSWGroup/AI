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
// ---------------------------------------------------------------------------

export interface GradeResult {
  /** null = correctness is not yet known (awaiting manual grading). */
  isCorrect: boolean | null;
  pointsEarned: number;
  pointsPossible: number;
  needsManualGrading: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Grade a single answer against its question config. Pure function: same
 * inputs always produce the same output, no side effects.
 *
 * Answer shapes expected per type (all "canonical" — i.e. indices refer to the
 * question's config arrays in their original, unshuffled order; the lesson
 * player is responsible for mapping a shuffled on-screen order back to these
 * canonical indices before calling submitAttempt):
 *  - MULTIPLE_CHOICE: number (selected option index)
 *  - MULTIPLE_SELECT: number[] (selected option indices)
 *  - TRUE_FALSE: boolean
 *  - FILL_BLANK: string
 *  - SHORT_ANSWER: string
 *  - LONG_ANSWER: string
 *  - MATCHING: number[] where answer[i] is the pairs-index matched to pairs[i].left
 *  - ORDERING: number[], a permutation of 0..items.length-1 in the learner's chosen order
 *  - SCENARIO: string (chosen choice id)
 *  - FILE_SUBMISSION: { mediaId?: string; note?: string }
 */
export function gradeQuestion(type: QuestionType, config: unknown, answer: unknown, points: number): GradeResult {
  const cfg = asRecord(config);
  const pointsPossible = points;

  switch (type) {
    case "MULTIPLE_CHOICE": {
      const correctIndex = typeof cfg.correctIndex === "number" ? cfg.correctIndex : -1;
      const given = typeof answer === "number" ? answer : -1;
      const isCorrect = given === correctIndex && correctIndex >= 0;
      return { isCorrect, pointsEarned: isCorrect ? points : 0, pointsPossible, needsManualGrading: false };
    }

    case "MULTIPLE_SELECT": {
      const correctIndexes = new Set<number>(Array.isArray(cfg.correctIndexes) ? (cfg.correctIndexes as number[]) : []);
      const selected = new Set<number>(Array.isArray(answer) ? (answer as number[]) : []);
      let correctSelected = 0;
      let incorrectSelected = 0;
      for (const idx of selected) {
        if (correctIndexes.has(idx)) correctSelected += 1;
        else incorrectSelected += 1;
      }
      const totalCorrect = correctIndexes.size || 1;
      const ratio = Math.max(0, Math.min(1, (correctSelected - incorrectSelected) / totalCorrect));
      const pointsEarned = round2(points * ratio);
      const isCorrect = correctSelected === correctIndexes.size && incorrectSelected === 0 && correctIndexes.size > 0;
      return { isCorrect, pointsEarned, pointsPossible, needsManualGrading: false };
    }

    case "TRUE_FALSE": {
      const correct = Boolean(cfg.correct);
      const given = Boolean(answer);
      const isCorrect = correct === given;
      return { isCorrect, pointsEarned: isCorrect ? points : 0, pointsPossible, needsManualGrading: false };
    }

    case "FILL_BLANK": {
      const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
      const accepted = (Array.isArray(cfg.acceptableAnswers) ? (cfg.acceptableAnswers as string[]) : []).map(normalize);
      const given = normalize(typeof answer === "string" ? answer : "");
      const isCorrect = given.length > 0 && accepted.includes(given);
      return { isCorrect, pointsEarned: isCorrect ? points : 0, pointsPossible, needsManualGrading: false };
    }

    case "SHORT_ANSWER": {
      const keywords = (Array.isArray(cfg.acceptableKeywords) ? (cfg.acceptableKeywords as string[]) : []).map((k) =>
        k.toLowerCase().trim(),
      );
      const text = (typeof answer === "string" ? answer : "").toLowerCase();
      const matched = keywords.filter((k) => k.length > 0 && text.includes(k));
      const threshold =
        typeof cfg.keywordThreshold === "number" && cfg.keywordThreshold > 0 ? cfg.keywordThreshold : 1;
      const manualGrading = Boolean(cfg.manualGrading);

      if (keywords.length > 0 && matched.length >= threshold) {
        return { isCorrect: true, pointsEarned: points, pointsPossible, needsManualGrading: false };
      }
      if (manualGrading) {
        return { isCorrect: null, pointsEarned: 0, pointsPossible, needsManualGrading: true };
      }
      return { isCorrect: false, pointsEarned: 0, pointsPossible, needsManualGrading: false };
    }

    case "LONG_ANSWER":
      return { isCorrect: null, pointsEarned: 0, pointsPossible, needsManualGrading: true };

    case "MATCHING": {
      const pairs = Array.isArray(cfg.pairs) ? (cfg.pairs as { left: string; right: string }[]) : [];
      const answerArr = Array.isArray(answer) ? (answer as number[]) : [];
      let correctCount = 0;
      pairs.forEach((_, i) => {
        if (answerArr[i] === i) correctCount += 1;
      });
      const total = pairs.length || 1;
      const pointsEarned = round2(points * (correctCount / total));
      const isCorrect = pairs.length > 0 && correctCount === pairs.length;
      return { isCorrect, pointsEarned, pointsPossible, needsManualGrading: false };
    }

    case "ORDERING": {
      const items = Array.isArray(cfg.items) ? (cfg.items as string[]) : [];
      const answerArr = Array.isArray(answer) ? (answer as number[]) : [];
      const n = items.length;
      const totalAdjacent = Math.max(1, n - 1);
      let correctAdjacent = 0;
      for (let i = 0; i < answerArr.length - 1; i += 1) {
        const a = answerArr[i];
        const b = answerArr[i + 1];
        if (typeof a === "number" && typeof b === "number" && a < b) correctAdjacent += 1;
      }
      const pointsEarned = round2(points * (correctAdjacent / totalAdjacent));
      const isCorrect = n > 0 && answerArr.length === n && correctAdjacent === totalAdjacent;
      return { isCorrect, pointsEarned, pointsPossible, needsManualGrading: false };
    }

    case "SCENARIO": {
      const choices = Array.isArray(cfg.choices)
        ? (cfg.choices as { id: string; correct?: boolean }[])
        : [];
      const chosenId = typeof answer === "string" ? answer : undefined;
      const chosen = choices.find((c) => c.id === chosenId);
      const isCorrect = Boolean(chosen?.correct);
      return { isCorrect, pointsEarned: isCorrect ? points : 0, pointsPossible, needsManualGrading: false };
    }

    case "FILE_SUBMISSION":
      return { isCorrect: null, pointsEarned: 0, pointsPossible, needsManualGrading: true };

    default:
      return { isCorrect: null, pointsEarned: 0, pointsPossible, needsManualGrading: true };
  }
}

export interface GradableQuestion {
  id: string;
  type: QuestionType;
  config: unknown;
  points: number;
}

export interface AttemptGradeSummary {
  pointsEarned: number;
  pointsPossible: number;
  scorePercent: number;
  hasPendingManualGrading: boolean;
  perQuestion: Record<string, GradeResult>;
}

/** Grade a full set of answers against their questions. Also pure. */
export function gradeAttempt(
  questions: GradableQuestion[],
  answers: Record<string, unknown>,
): AttemptGradeSummary {
  let pointsEarned = 0;
  let pointsPossible = 0;
  let hasPendingManualGrading = false;
  const perQuestion: Record<string, GradeResult> = {};

  for (const question of questions) {
    const result = gradeQuestion(question.type, question.config, answers[question.id], question.points);
    perQuestion[question.id] = result;
    pointsPossible += result.pointsPossible;
    pointsEarned += result.pointsEarned;
    if (result.needsManualGrading) hasPendingManualGrading = true;
  }

  const scorePercent = pointsPossible > 0 ? round2((pointsEarned / pointsPossible) * 100) : 0;
  return { pointsEarned: round2(pointsEarned), pointsPossible, scorePercent, hasPendingManualGrading, perQuestion };
}

// ---------------------------------------------------------------------------
// Shuffling helpers
// ---------------------------------------------------------------------------

function shuffle<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  let state = seed || 1;
  const next = () => {
    // xorshift32 — deterministic given a seed, no external dependency.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

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
  const order = (attempt.questionOrder as QuestionOrder | null) ?? {
    questions: questions.map((q) => ({ questionId: q.id })),
  };
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
    select: {
      id: true,
      userId: true,
      lessonId: true,
      status: true,
      startedAt: true,
      lesson: {
        select: {
          sectionId: true,
          section: { select: { courseId: true, course: { select: { passingScore: true } } } },
          questions: { select: { id: true, type: true, config: true, points: true } },
        },
      },
    },
  });
  if (!attempt || attempt.userId !== actor.id) throw new ServiceError("Attempt not found.");
  if (attempt.status !== "IN_PROGRESS") throw new ServiceError("This attempt has already been submitted.");

  const settings = await getSettings();
  const passingScore = attempt.lesson.section.course.passingScore ?? settings.training.defaultPassingScore;

  const summary = gradeAttempt(attempt.lesson.questions, answers);

  await prisma.$transaction([
    ...attempt.lesson.questions.map((question) => {
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
    await markLessonComplete(attempt.userId, attempt.lessonId, attempt.lesson.section.courseId, {
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
      attempt: {
        select: {
          id: true,
          userId: true,
          lessonId: true,
          lesson: {
            select: {
              section: { select: { courseId: true, course: { select: { passingScore: true } } } },
            },
          },
        },
      },
    },
  });
  if (!response) throw new ServiceError("Response not found.");

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
  const passingScore = response.attempt.lesson.section.course.passingScore ?? settings.training.defaultPassingScore;
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
    await markLessonComplete(
      response.attempt.userId,
      response.attempt.lessonId,
      response.attempt.lesson.section.courseId,
      { score: scorePercent },
    );
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
      status: true,
      scorePercent: true,
      submittedAt: true,
      lesson: { select: { content: true } },
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

  const content = (attempt.lesson.content ?? {}) as Record<string, unknown>;
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
