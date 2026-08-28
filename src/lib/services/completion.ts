import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { PracticalRating } from "@prisma/client";
import type { Actor } from "@/lib/auth/guard";
import { actorHas, AuthorizationError, canViewUser } from "@/lib/auth/guard";
import type { Permission } from "@/lib/permissions";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { issueCertificate } from "@/lib/services/certificate";

export class ServiceError extends Error {}

function requireCap(actor: Actor, permission: Permission): void {
  if (!actorHas(actor, permission)) throw new AuthorizationError(permission);
}

/** Lesson types with no dedicated completion flow may be self-reported complete. */
const SELF_REPORTABLE_TYPES = new Set([
  "RICH_TEXT",
  "SOP_REF",
  "DOCUMENT",
  "PRESENTATION",
  "IMAGE",
  "AUDIO",
  "EXTERNAL_LINK",
  "DOWNLOAD",
  "EMBED",
  "FLOWCHART",
  "FLASHCARDS",
  "DISCUSSION",
  "LIVE_SESSION",
  "SCENARIO",
  "SURVEY",
]);

// ---------------------------------------------------------------------------
// Lesson progress
// ---------------------------------------------------------------------------

export interface LessonProgressPatch {
  videoPositionSeconds?: number;
  videoDurationSeconds?: number;
  checklistItemId?: string;
  checklistChecked?: boolean;
  surveyAnswers?: Record<string, unknown>;
  markComplete?: boolean;
}

export interface LessonProgressResult {
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  videoPositionSeconds: number | null;
  videoWatchedPercent: number | null;
  checklistState: Record<string, unknown> | null;
  completedAt: Date | null;
  courseCompleted: boolean;
}

/** Wall-clock tolerance, in seconds, added on top of true elapsed time for video reporting. */
const VIDEO_JUMP_TOLERANCE_SECONDS = 12;

export async function recordLessonProgress(
  actor: Actor,
  lessonId: string,
  patch: LessonProgressPatch,
): Promise<LessonProgressResult> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      id: true,
      type: true,
      content: true,
      section: { select: { courseId: true, course: { select: { requiredVideoPercent: true } } } },
    },
  });
  if (!lesson) throw new ServiceError("Lesson not found.");
  const courseId = lesson.section.courseId;

  const existing = await prisma.lessonProgress.findUnique({
    where: { userId_lessonId: { userId: actor.id, lessonId } },
  });

  const now = new Date();
  let status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" = existing?.status ?? "NOT_STARTED";
  let videoPositionSeconds = existing?.videoPositionSeconds ?? null;
  let videoWatchedPercent = existing?.videoWatchedPercent ?? null;
  let checklistState = (existing?.checklistState as Record<string, unknown> | null) ?? null;
  let completedAt = existing?.completedAt ?? null;

  const isVideoType = lesson.type === "VIDEO" || lesson.type === "AI_VIDEO" || lesson.type === "SCREEN_RECORDING";

  if (isVideoType && typeof patch.videoPositionSeconds === "number") {
    const previousPosition = videoPositionSeconds ?? 0;
    const elapsedSeconds = existing ? Math.max(0, (now.getTime() - existing.updatedAt.getTime()) / 1000) : 0;
    const maxAllowed = previousPosition + elapsedSeconds + VIDEO_JUMP_TOLERANCE_SECONDS;
    const reported = Math.max(0, patch.videoPositionSeconds);
    // Never let a reported position decrease the stored max, and reject
    // (clamp) any jump larger than plausible elapsed wall-clock time — this
    // is what stops scrubbing to the end to fake completion.
    videoPositionSeconds = Math.max(previousPosition, Math.min(reported, maxAllowed));

    if (typeof patch.videoDurationSeconds === "number" && patch.videoDurationSeconds > 0) {
      const computedPercent = Math.min(100, (videoPositionSeconds / patch.videoDurationSeconds) * 100);
      videoWatchedPercent = Math.max(videoWatchedPercent ?? 0, computedPercent);
    }

    const requiredPercent = lesson.section.course.requiredVideoPercent;
    if (status === "NOT_STARTED") status = "IN_PROGRESS";
    if ((videoWatchedPercent ?? 0) >= requiredPercent) {
      status = "COMPLETED";
      completedAt = completedAt ?? now;
    }
  }

  if (lesson.type === "CHECKLIST" && patch.checklistItemId) {
    const content = (lesson.content ?? {}) as { requireAll?: boolean; items?: { id: string }[] };
    const items = content.items ?? [];
    const state = { ...(checklistState ?? {}) };
    state[patch.checklistItemId] = patch.checklistChecked ?? true;
    checklistState = state;
    status = status === "NOT_STARTED" ? "IN_PROGRESS" : status;

    const requireAll = content.requireAll !== false;
    const allChecked = items.length > 0 && items.every((item) => state[item.id] === true);
    if (requireAll && allChecked) {
      status = "COMPLETED";
      completedAt = completedAt ?? now;
    }
  }

  if (lesson.type === "SURVEY" && patch.surveyAnswers) {
    checklistState = { ...(checklistState ?? {}), surveyAnswers: patch.surveyAnswers };
    status = status === "COMPLETED" ? status : "IN_PROGRESS";
  }

  if (patch.markComplete) {
    if (!SELF_REPORTABLE_TYPES.has(lesson.type)) {
      throw new ServiceError(
        "This lesson type is completed through its own flow (quiz submission, sign-off, acknowledgement, or file submission), not a direct mark-complete.",
      );
    }
    status = "COMPLETED";
    completedAt = completedAt ?? now;
  }

  await prisma.lessonProgress.upsert({
    where: { userId_lessonId: { userId: actor.id, lessonId } },
    create: {
      userId: actor.id,
      lessonId,
      courseId,
      status,
      videoPositionSeconds,
      videoWatchedPercent,
      checklistState: (checklistState ?? undefined) as Prisma.InputJsonValue | undefined,
      startedAt: now,
      completedAt,
    },
    update: {
      status,
      videoPositionSeconds,
      videoWatchedPercent,
      checklistState: (checklistState ?? undefined) as Prisma.InputJsonValue | undefined,
      startedAt: existing?.startedAt ?? now,
      completedAt,
    },
  });

  let courseCompleted = false;
  if (status === "COMPLETED" && (!existing || existing.status !== "COMPLETED")) {
    courseCompleted = await maybeAutoCompleteCourse(actor.id, courseId);
  }

  return { status, videoPositionSeconds, videoWatchedPercent, checklistState, completedAt, courseCompleted };
}

/**
 * Called by domain services (quiz pass, acknowledgement, manager sign-off)
 * after their own authorization has already been established. Not exported
 * for direct client use — those flows own their own permission checks.
 */
export async function markLessonComplete(
  userId: string,
  lessonId: string,
  courseId: string,
  _opts: { score?: number } = {},
): Promise<void> {
  const now = new Date();
  const existing = await prisma.lessonProgress.findUnique({ where: { userId_lessonId: { userId, lessonId } } });
  if (existing?.status === "COMPLETED") return;

  await prisma.lessonProgress.upsert({
    where: { userId_lessonId: { userId, lessonId } },
    create: { userId, lessonId, courseId, status: "COMPLETED", startedAt: now, completedAt: now },
    update: { status: "COMPLETED", completedAt: now },
  });

  await maybeAutoCompleteCourse(userId, courseId);
}

async function requiredLessonsComplete(userId: string, courseId: string): Promise<{ met: boolean; completed: number; total: number }> {
  const requiredLessons = await prisma.lesson.findMany({
    where: { section: { courseId }, required: true },
    select: { id: true },
  });
  if (requiredLessons.length === 0) return { met: true, completed: 0, total: 0 };
  const completed = await prisma.lessonProgress.count({
    where: { userId, lessonId: { in: requiredLessons.map((l) => l.id) }, status: "COMPLETED" },
  });
  return { met: completed >= requiredLessons.length, completed, total: requiredLessons.length };
}

async function maybeAutoCompleteCourse(userId: string, courseId: string): Promise<boolean> {
  const { met } = await requiredLessonsComplete(userId, courseId);
  if (!met) return false;
  await finalizeCourseCompletion(userId, courseId, {});
  return true;
}

// ---------------------------------------------------------------------------
// Course completion
// ---------------------------------------------------------------------------

export interface CompleteCourseOpts {
  userId?: string;
}

interface FinalizeOpts {
  skipRequirementCheck?: boolean;
  overriddenById?: string;
}

/**
 * Idempotent core of course completion. A second call for the same user and
 * the same current course version is a no-op that returns the existing
 * record rather than creating a duplicate.
 */
async function finalizeCourseCompletion(
  userId: string,
  courseId: string,
  opts: FinalizeOpts,
): Promise<{ id: string; alreadyCompleted: boolean }> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      title: true,
      currentVersionId: true,
      currentVersion: { select: { versionNumber: true } },
      recertifyMonths: true,
      skills: true,
    },
  });
  if (!course) throw new ServiceError("Course not found.");

  const existing = await prisma.completionRecord.findFirst({
    where: { userId, courseId, courseVersionId: course.currentVersionId },
    orderBy: { completedAt: "desc" },
  });
  if (existing) return { id: existing.id, alreadyCompleted: true };

  if (!opts.skipRequirementCheck) {
    const { met, completed, total } = await requiredLessonsComplete(userId, courseId);
    if (!met) {
      throw new ServiceError(`Not every required lesson is complete yet (${completed}/${total}).`);
    }
  }

  const [user, lessonIds, assignment] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, email: true, employeeId: true },
    }),
    prisma.lesson.findMany({ where: { section: { courseId } }, select: { id: true } }),
    prisma.assignment.findFirst({
      where: { userId, targetType: "COURSE", courseId },
      orderBy: { assignedAt: "desc" },
    }),
  ]);

  const [quizAttempts, progressRows] = await Promise.all([
    prisma.quizAttempt.findMany({
      where: { userId, lessonId: { in: lessonIds.map((l) => l.id) }, status: { in: ["PASSED", "FAILED"] } },
      select: { scorePercent: true, status: true },
    }),
    prisma.lessonProgress.findMany({
      where: { userId, lessonId: { in: lessonIds.map((l) => l.id) } },
      select: { startedAt: true },
    }),
  ]);

  const passedScores = quizAttempts.filter((a) => a.status === "PASSED" && a.scorePercent !== null);
  const scorePercent =
    passedScores.length > 0
      ? Math.round(
          (passedScores.reduce((sum, a) => sum + (a.scorePercent ?? 0), 0) / passedScores.length) * 100,
        ) / 100
      : null;

  const startedDates = progressRows.map((p) => p.startedAt).filter((d): d is Date => Boolean(d));
  const earliestStart = startedDates.length > 0 ? new Date(Math.min(...startedDates.map((d) => d.getTime()))) : null;
  const durationMinutes = earliestStart ? Math.max(1, Math.round((Date.now() - earliestStart.getTime()) / 60000)) : null;

  const expiresAt = course.recertifyMonths
    ? new Date(Date.now() + course.recertifyMonths * 30 * 24 * 60 * 60 * 1000)
    : null;

  const certificate = await issueCertificate({
    userId,
    userNameSnapshot: user.name,
    courseTitleSnapshot: course.title,
    courseId,
    courseVersionId: course.currentVersionId,
    expiresAt,
  });

  const record = await prisma.completionRecord.create({
    data: {
      userId,
      userSnapshot: { name: user.name, email: user.email, employeeId: user.employeeId } as Prisma.InputJsonValue,
      targetType: "COURSE",
      courseId,
      courseVersionId: course.currentVersionId,
      titleSnapshot: course.title,
      versionLabel: course.currentVersion?.versionNumber ?? null,
      assignmentId: assignment?.id ?? null,
      assignmentSource: assignment?.source ?? null,
      scorePercent,
      attemptCount: quizAttempts.length || null,
      durationMinutes,
      startedAt: earliestStart,
      expiresAt,
      certificateId: certificate.id,
      overriddenById: opts.overriddenById ?? null,
    },
  });

  if (assignment) {
    await prisma.assignment.update({
      where: { id: assignment.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  }

  for (const skill of course.skills) {
    const existingSkill = await prisma.userSkill.findUnique({
      where: { userId_skillId: { userId, skillId: skill.skillId } },
    });
    const level = Math.max(skill.levelValue ?? 0, existingSkill?.level ?? 0);
    await prisma.userSkill.upsert({
      where: { userId_skillId: { userId, skillId: skill.skillId } },
      create: { userId, skillId: skill.skillId, level, source: "TRAINING" },
      update: existingSkill && existingSkill.level >= level ? {} : { level, source: "TRAINING" },
    });
  }

  await notify({
    userId,
    type: "COURSE_COMPLETED",
    title: `You completed ${course.title}`,
    body: certificate ? `Certificate ${certificate.certificateNumber} is ready to download.` : undefined,
    linkUrl: `/courses/${courseId}`,
    dedupeKey: `completion:${record.id}`,
  });

  return { id: record.id, alreadyCompleted: false };
}

export async function completeCourse(actor: Actor, courseId: string, opts: CompleteCourseOpts = {}) {
  const targetUserId = opts.userId ?? actor.id;
  if (targetUserId !== actor.id) requireCap(actor, "training.complete_override");
  return finalizeCourseCompletion(targetUserId, courseId, {});
}

export async function overrideCompletion(actor: Actor, userId: string, courseId: string, reason: string) {
  requireCap(actor, "training.complete_override");
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new ServiceError("A reason is required to override a completion.");

  const result = await finalizeCourseCompletion(userId, courseId, {
    skipRequirementCheck: true,
    overriddenById: actor.id,
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.COMPLETION_OVERRIDDEN,
    entityType: "COURSE",
    entityId: courseId,
    metadata: { userId, reason: trimmedReason },
  });

  return result;
}

// ---------------------------------------------------------------------------
// Assignment-project submission
// ---------------------------------------------------------------------------

export async function submitAssignmentProject(
  actor: Actor,
  lessonId: string,
  input: { mediaId?: string; note?: string },
): Promise<void> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, type: true, section: { select: { courseId: true } } },
  });
  if (!lesson || lesson.type !== "ASSIGNMENT_PROJECT") throw new ServiceError("Lesson not found.");
  if (!input.mediaId && !input.note?.trim()) {
    throw new ServiceError("Attach a file or add a note before submitting.");
  }

  const now = new Date();
  await prisma.lessonProgress.upsert({
    where: { userId_lessonId: { userId: actor.id, lessonId } },
    create: {
      userId: actor.id,
      lessonId,
      courseId: lesson.section.courseId,
      status: "COMPLETED",
      checklistState: { submission: { ...input, submittedAt: now.toISOString() } } as Prisma.InputJsonValue,
      startedAt: now,
      completedAt: now,
    },
    update: {
      status: "COMPLETED",
      checklistState: { submission: { ...input, submittedAt: now.toISOString() } } as Prisma.InputJsonValue,
      completedAt: now,
    },
  });

  await maybeAutoCompleteCourse(actor.id, lesson.section.courseId);
}

// ---------------------------------------------------------------------------
// Manager sign-off / practical demo
// ---------------------------------------------------------------------------

export async function recordPracticalAssessment(
  actor: Actor,
  input: {
    lessonId: string;
    userId: string;
    rating: PracticalRating;
    comments?: string;
    attachmentMediaId?: string;
    reassessAt?: Date;
  },
): Promise<void> {
  if (!actorHas(actor, "team.approve") && !actorHas(actor, "skills.assess")) {
    throw new AuthorizationError("team.approve or skills.assess");
  }

  const lesson = await prisma.lesson.findUnique({
    where: { id: input.lessonId },
    select: { id: true, type: true, section: { select: { courseId: true } } },
  });
  if (!lesson || (lesson.type !== "MANAGER_SIGNOFF" && lesson.type !== "PRACTICAL_DEMO")) {
    throw new ServiceError("Lesson not found.");
  }

  await prisma.skillAssessment.create({
    data: {
      userId: input.userId,
      assessorId: actor.id,
      lessonId: input.lessonId,
      courseId: lesson.section.courseId,
      rating: input.rating,
      comments: input.comments ?? null,
      attachmentMediaId: input.attachmentMediaId ?? null,
      reassessAt: input.reassessAt ?? null,
    },
  });

  if (input.rating === "COMPETENT" || input.rating === "HIGHLY_COMPETENT") {
    await markLessonComplete(input.userId, input.lessonId, lesson.section.courseId);
  }

  await notify({
    userId: input.userId,
    type: "TRAINING_ASSIGNED",
    title: `Your manager recorded a sign-off: ${input.rating.replace(/_/g, " ").toLowerCase()}`,
    linkUrl: `/courses/${lesson.section.courseId}`,
    dedupeKey: `signoff:${input.lessonId}:${input.userId}:${Date.now()}`,
    inAppOnly: true,
  });
}

// ---------------------------------------------------------------------------
// Acknowledgements / e-signatures
// ---------------------------------------------------------------------------

export interface RecordAcknowledgementInput {
  statement: string;
  sopVersionId?: string;
  courseVersionId?: string;
  lessonId?: string;
  announcementId?: string;
  typedSignature?: string;
  ip?: string;
  userAgent?: string;
}

/** Append-only. Never updates or reuses a prior row — every acknowledgement is new evidence. */
export async function recordAcknowledgement(actor: Actor, input: RecordAcknowledgementInput) {
  if (!input.statement.trim()) throw new ServiceError("A statement is required.");

  const acknowledgement = await prisma.acknowledgement.create({
    data: {
      userId: actor.id,
      statement: input.statement,
      sopVersionId: input.sopVersionId ?? null,
      courseVersionId: input.courseVersionId ?? null,
      lessonId: input.lessonId ?? null,
      announcementId: input.announcementId ?? null,
      signatureMethod: input.typedSignature ? "typed_signature" : "checkbox",
      typedSignature: input.typedSignature ?? null,
      ipAddress: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  });

  if (input.lessonId) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: input.lessonId },
      select: { section: { select: { courseId: true } } },
    });
    if (lesson) {
      await markLessonComplete(actor.id, input.lessonId, lesson.section.courseId);
    }
  }

  return acknowledgement;
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

export interface TranscriptEntry {
  id: string;
  kind: "COURSE" | "ACKNOWLEDGEMENT";
  title: string;
  versionLabel: string | null;
  assignedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date;
  scorePercent: number | null;
  attemptCount: number | null;
  certificateNumber: string | null;
  expiresAt: Date | null;
  instructorName: string | null;
  managerApprovedById: string | null;
  overridden: boolean;
}

export async function getTranscript(actor: Actor, userId: string): Promise<TranscriptEntry[]> {
  const allowed = await canViewUser(actor, userId);
  if (!allowed) throw new AuthorizationError("people.view");

  const [completions, acknowledgements] = await Promise.all([
    prisma.completionRecord.findMany({
      where: { userId },
      orderBy: { completedAt: "desc" },
      select: {
        id: true,
        titleSnapshot: true,
        versionLabel: true,
        startedAt: true,
        completedAt: true,
        scorePercent: true,
        attemptCount: true,
        expiresAt: true,
        managerApprovedById: true,
        overriddenById: true,
        certificate: { select: { certificateNumber: true, instructorName: true } },
        assignmentId: true,
      },
    }),
    prisma.acknowledgement.findMany({
      where: { userId, sopVersionId: { not: null } },
      orderBy: { acknowledgedAt: "desc" },
      select: {
        id: true,
        statement: true,
        acknowledgedAt: true,
        sopVersion: { select: { versionNumber: true, title: true } },
      },
    }),
  ]);

  const assignmentIds = completions.map((c) => c.assignmentId).filter((id): id is string => Boolean(id));
  const assignments = assignmentIds.length
    ? await prisma.assignment.findMany({ where: { id: { in: assignmentIds } }, select: { id: true, assignedAt: true } })
    : [];
  const assignedAtById = new Map(assignments.map((a) => [a.id, a.assignedAt]));

  const courseEntries: TranscriptEntry[] = completions.map((c) => ({
    id: c.id,
    kind: "COURSE",
    title: c.titleSnapshot,
    versionLabel: c.versionLabel,
    assignedAt: c.assignmentId ? (assignedAtById.get(c.assignmentId) ?? null) : null,
    startedAt: c.startedAt,
    completedAt: c.completedAt,
    scorePercent: c.scorePercent,
    attemptCount: c.attemptCount,
    certificateNumber: c.certificate?.certificateNumber ?? null,
    expiresAt: c.expiresAt,
    instructorName: c.certificate?.instructorName ?? null,
    managerApprovedById: c.managerApprovedById,
    overridden: Boolean(c.overriddenById),
  }));

  const ackEntries: TranscriptEntry[] = acknowledgements.map((a) => ({
    id: a.id,
    kind: "ACKNOWLEDGEMENT",
    title: a.sopVersion ? `${a.sopVersion.title} (v${a.sopVersion.versionNumber})` : a.statement,
    versionLabel: a.sopVersion?.versionNumber ?? null,
    assignedAt: null,
    startedAt: null,
    completedAt: a.acknowledgedAt,
    scorePercent: null,
    attemptCount: null,
    certificateNumber: null,
    expiresAt: null,
    instructorName: null,
    managerApprovedById: null,
    overridden: false,
  }));

  return [...courseEntries, ...ackEntries].sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
}
