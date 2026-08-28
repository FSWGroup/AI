import type { LessonType } from "@prisma/client";

/**
 * Shared prop contract for every lesson player. The lesson page (server
 * component) resolves all data — including cross-cutting lookups like SOP
 * blocks or reviewable teammates — so players stay simple, testable, and
 * free of their own data-fetching concerns.
 */

export interface PlayerLesson {
  id: string;
  title: string;
  type: LessonType;
  required: boolean;
  estimatedMinutes: number | null;
  content: Record<string, unknown>;
}

export interface PlayerCourse {
  id: string;
  title: string;
  requiredVideoPercent: number;
  passingScore: number | null;
  attemptLimit: number | null;
}

export interface PlayerProgress {
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  videoPositionSeconds: number | null;
  videoWatchedPercent: number | null;
  checklistState: Record<string, unknown> | null;
  completedAt: string | null;
}

export interface PlayerViewer {
  id: string;
  name: string;
  canApprove: boolean;
  reviewableUsers: { id: string; name: string }[];
}

export interface LessonPlayerProps {
  lesson: PlayerLesson;
  course: PlayerCourse;
  progress: PlayerProgress | null;
  viewer: PlayerViewer;
  /** Extra data the page already resolved for this specific lesson type. */
  extra?: {
    sopBlocks?: unknown;
    sopTitle?: string;
    liveSession?: {
      id: string;
      title: string;
      startsAt: string;
      endsAt: string;
      timezone: string;
      locationText: string | null;
      capacity: number | null;
      registeredCount: number;
      myStatus: string | null;
    } | null;
    comments?: {
      id: string;
      body: string;
      authorName: string;
      authorId: string;
      createdAt: string;
      parentId: string | null;
    }[];
    practicalAssessments?: {
      id: string;
      userId: string;
      userName: string;
      rating: string;
      comments: string | null;
      createdAt: string;
    }[];
  };
  /** Called after an action that finishes the lesson, so the shell can advance. */
  onComplete: () => void;
  /** Called after any non-terminal progress update, so the shell can refresh. */
  onProgress: () => void;
  /**
   * Bound server action for ACKNOWLEDGEMENT/SIGNATURE lessons. The action
   * itself reads IP and User-Agent from request headers server-side — the
   * client only supplies the typed signature, never the evidence fields.
   */
  acknowledge?: (input: { typedSignature?: string }) => Promise<{ ok: boolean; error?: string }>;
  /** Bound server action for MANAGER_SIGNOFF / PRACTICAL_DEMO lessons — records a manager's rating for one of their reviewable teammates. */
  assessPractical?: (input: {
    userId: string;
    rating: "NOT_DEMONSTRATED" | "NEEDS_COACHING" | "COMPETENT" | "HIGHLY_COMPETENT";
    comments?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  /** Bound server action for ASSIGNMENT_PROJECT lessons. */
  submitProject?: (input: { mediaId?: string; note?: string }) => Promise<{ ok: boolean; error?: string }>;
  /** Bound server action for LIVE_SESSION lessons. */
  registerForSession?: () => Promise<{ ok: boolean; error?: string }>;
  /** Bound server action for DISCUSSION lessons. */
  postComment?: (input: { body: string; parentId?: string }) => Promise<{ ok: boolean; error?: string }>;

  // Quiz engine actions (QUIZ lessons only).
  startQuizAttempt?: () => Promise<{ ok: boolean; error?: string; data?: QuizAttemptView }>;
  submitQuizAttempt?: (
    attemptId: string,
    answers: Record<string, unknown>,
  ) => Promise<{ ok: boolean; error?: string; data?: QuizSubmitResult }>;
  getQuizReview?: (attemptId: string) => Promise<{ ok: boolean; error?: string; data?: QuizReview }>;
}

export interface QuizPresentedQuestion {
  id: string;
  type: string;
  order: number;
  prompt: string;
  points: number;
  required: boolean;
  presentation: Record<string, unknown>;
  explanation: string | null;
}

export interface QuizAttemptView {
  id: string;
  status: string;
  attemptNumber: number;
  attemptsRemaining: number | null;
  questions: QuizPresentedQuestion[];
  oneQuestionAtATime: boolean;
}

export interface QuizSubmitResult {
  status: string;
  scorePercent: number;
  pointsEarned: number;
  pointsPossible: number;
  passed: boolean | null;
  hasPendingManualGrading: boolean;
}

export interface QuizReview {
  id: string;
  status: string;
  scorePercent: number | null;
  responses: {
    questionId: string;
    prompt: string;
    type: string;
    answer: unknown;
    isCorrect: boolean | null;
    pointsEarned: number | null;
    pointsPossible: number;
    explanation: string | null;
    feedback: string | null;
  }[];
}
