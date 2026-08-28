import "server-only";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/auth/scope";
import type { AssignmentStatus, TrainingTargetType } from "@prisma/client";

/**
 * The learner's own training view.
 *
 * Deliberately a single service used by both /my-training and the home
 * dashboard's due-soon and overdue sections, so the two can never disagree
 * about what is overdue.
 */

export interface TrainingItem {
  assignmentId: string;
  targetType: TrainingTargetType;
  targetId: string;
  title: string;
  description: string | null;
  category: string | null;
  status: AssignmentStatus;
  /** Human-readable explanation of why this was assigned. */
  reason: string | null;
  source: string;
  assignedAt: Date;
  dueAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  estimatedMinutes: number | null;
  /** 0–100 completion for courses, derived from required-lesson progress. */
  percentComplete: number;
  href: string;
  /** Set when the underlying training carries an expiry (recertification). */
  expiresAt: Date | null;
  isOverdue: boolean;
  daysUntilDue: number | null;
}

export interface MyTrainingBuckets {
  overdue: TrainingItem[];
  dueSoon: TrainingItem[];
  inProgress: TrainingItem[];
  notStarted: TrainingItem[];
  completed: TrainingItem[];
  waived: TrainingItem[];
  counts: {
    total: number;
    overdue: number;
    dueSoon: number;
    inProgress: number;
    notStarted: number;
    completed: number;
  };
}

const DUE_SOON_DAYS = 14;

function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Load every assignment for a person, with course progress resolved in a fixed
 * number of queries regardless of how many assignments there are.
 */
export async function getMyTraining(actor: Actor): Promise<MyTrainingBuckets> {
  const assignments = await prisma.assignment.findMany({
    where: {
      userId: actor.id,
      // Path-derived child assignments are shown; the parent path row is
      // presented separately on the paths page.
      OR: [{ parentAssignmentId: null }, { parentAssignmentId: { not: null } }],
    },
    select: {
      id: true,
      targetType: true,
      courseId: true,
      sopId: true,
      pathId: true,
      status: true,
      source: true,
      reason: true,
      assignedAt: true,
      dueAt: true,
      startedAt: true,
      completedAt: true,
      course: {
        select: {
          id: true,
          title: true,
          description: true,
          category: true,
          estimatedMinutes: true,
          recertifyMonths: true,
          sections: {
            select: { lessons: { where: { required: true }, select: { id: true } } },
          },
        },
      },
      sop: {
        select: { id: true, title: true, summary: true, category: true, sopCode: true },
      },
      path: { select: { id: true, title: true, description: true } },
    },
    orderBy: [{ dueAt: "asc" }, { assignedAt: "desc" }],
  });

  if (assignments.length === 0) {
    return {
      overdue: [],
      dueSoon: [],
      inProgress: [],
      notStarted: [],
      completed: [],
      waived: [],
      counts: {
        total: 0,
        overdue: 0,
        dueSoon: 0,
        inProgress: 0,
        notStarted: 0,
        completed: 0,
      },
    };
  }

  // One query for all lesson progress across every assigned course.
  const courseIds = assignments
    .map((a) => a.courseId)
    .filter((id): id is string => Boolean(id));

  const progressRows =
    courseIds.length > 0
      ? await prisma.lessonProgress.findMany({
          where: { userId: actor.id, courseId: { in: courseIds }, status: "COMPLETED" },
          select: { courseId: true, lessonId: true },
        })
      : [];

  const completedByCourse = new Map<string, number>();
  for (const row of progressRows) {
    completedByCourse.set(row.courseId, (completedByCourse.get(row.courseId) ?? 0) + 1);
  }

  // One query for expiry dates from the most recent completion per course.
  const completions =
    courseIds.length > 0
      ? await prisma.completionRecord.findMany({
          where: { userId: actor.id, courseId: { in: courseIds } },
          select: { courseId: true, expiresAt: true, completedAt: true },
          orderBy: { completedAt: "desc" },
        })
      : [];

  const expiryByCourse = new Map<string, Date | null>();
  for (const record of completions) {
    if (record.courseId && !expiryByCourse.has(record.courseId)) {
      expiryByCourse.set(record.courseId, record.expiresAt);
    }
  }

  const now = new Date();
  const items: TrainingItem[] = [];

  for (const assignment of assignments) {
    let title = "Untitled";
    let description: string | null = null;
    let category: string | null = null;
    let estimatedMinutes: number | null = null;
    let href = "/my-training";
    let targetId = "";
    let percentComplete = 0;

    if (assignment.course) {
      const course = assignment.course;
      targetId = course.id;
      title = course.title;
      description = course.description;
      category = course.category;
      estimatedMinutes = course.estimatedMinutes;
      href = `/courses/${course.id}`;

      const requiredLessons = course.sections.reduce(
        (total, section) => total + section.lessons.length,
        0,
      );
      const done = completedByCourse.get(course.id) ?? 0;
      percentComplete =
        requiredLessons > 0
          ? Math.min(100, Math.round((done / requiredLessons) * 100))
          : assignment.status === "COMPLETED"
            ? 100
            : 0;
    } else if (assignment.sop) {
      const sop = assignment.sop;
      targetId = sop.id;
      title = sop.title;
      description = sop.summary;
      category = sop.category ?? sop.sopCode;
      href = `/sops/${sop.id}`;
      percentComplete = assignment.status === "COMPLETED" ? 100 : 0;
    } else if (assignment.path) {
      const path = assignment.path;
      targetId = path.id;
      title = path.title;
      description = path.description;
      category = "Learning path";
      href = `/paths/${path.id}`;
      percentComplete = assignment.status === "COMPLETED" ? 100 : 0;
    }

    if (assignment.status === "COMPLETED") percentComplete = 100;

    const dueAt = assignment.dueAt;
    const isOverdue =
      Boolean(dueAt) &&
      dueAt! < now &&
      assignment.status !== "COMPLETED" &&
      assignment.status !== "WAIVED";

    items.push({
      assignmentId: assignment.id,
      targetType: assignment.targetType,
      targetId,
      title,
      description,
      category,
      status: assignment.status,
      reason: assignment.reason,
      source: assignment.source,
      assignedAt: assignment.assignedAt,
      dueAt,
      startedAt: assignment.startedAt,
      completedAt: assignment.completedAt,
      estimatedMinutes,
      percentComplete,
      href,
      expiresAt: assignment.courseId ? (expiryByCourse.get(assignment.courseId) ?? null) : null,
      isOverdue,
      daysUntilDue: dueAt ? daysBetween(now, dueAt) : null,
    });
  }

  const overdue = items.filter((i) => i.isOverdue);
  const active = items.filter(
    (i) => !i.isOverdue && i.status !== "COMPLETED" && i.status !== "WAIVED",
  );

  const dueSoon = active.filter(
    (i) => i.daysUntilDue !== null && i.daysUntilDue <= DUE_SOON_DAYS,
  );
  const dueSoonIds = new Set(dueSoon.map((i) => i.assignmentId));

  const inProgress = active.filter(
    (i) => !dueSoonIds.has(i.assignmentId) && i.percentComplete > 0,
  );
  const notStarted = active.filter(
    (i) => !dueSoonIds.has(i.assignmentId) && i.percentComplete === 0,
  );

  const completed = items
    .filter((i) => i.status === "COMPLETED")
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));

  const waived = items.filter((i) => i.status === "WAIVED");

  return {
    overdue,
    dueSoon,
    inProgress,
    notStarted,
    completed,
    waived,
    counts: {
      total: items.length,
      overdue: overdue.length,
      dueSoon: dueSoon.length,
      inProgress: inProgress.length,
      notStarted: notStarted.length,
      completed: completed.length,
    },
  };
}

/**
 * The single most useful thing to resume: the furthest-along in-progress course,
 * falling back to the most urgent unstarted assignment.
 */
export async function getContinueTraining(actor: Actor): Promise<TrainingItem | null> {
  const buckets = await getMyTraining(actor);

  const resumable = [...buckets.inProgress, ...buckets.dueSoon, ...buckets.overdue]
    .filter((i) => i.percentComplete > 0 && i.percentComplete < 100)
    .sort((a, b) => b.percentComplete - a.percentComplete);

  if (resumable[0]) return resumable[0];

  const next = [...buckets.overdue, ...buckets.dueSoon, ...buckets.notStarted];
  return next[0] ?? null;
}
