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
}
