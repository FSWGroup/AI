import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { Difficulty, LessonType, QuestionType } from "@prisma/client";
import { z } from "zod";
import type { Actor } from "@/lib/auth/guard";
import { actorHas, AuthorizationError } from "@/lib/auth/guard";
import type { Permission } from "@/lib/permissions";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { enqueueJob, JOB_TYPES } from "@/lib/jobs/queue";
import { getSettings } from "@/lib/settings";
import type { Block } from "@/lib/content/types";

/**
 * Every mutating export in this service is permission-checked here, not just
 * at the page/action layer — defense in depth for any future caller.
 */
function requireCap(actor: Actor, permission: Permission): void {
  if (!actorHas(actor, permission)) throw new AuthorizationError(permission);
}

/**
 * Course authoring, catalog, and learner-facing course composition.
 *
 * Structural edits (sections/lessons/questions) act on the live, mutable
 * Course/CourseSection/Lesson/Question rows. publishCourse() is the only
 * place that freezes a point-in-time snapshot into CourseVersion — that
 * snapshot, not the live rows, is what CompletionRecord and Acknowledgement
 * reference forever after.
 */

/** Thrown for domain validation failures a user should see verbatim. */
export class ServiceError extends Error {}

// ---------------------------------------------------------------------------
// Lesson content shapes
//
// Lesson.content is a loosely-typed JSON column (see schema.prisma). These
// interfaces are the contract lesson players and the course builder agree on
// for each LessonType. They are intentionally permissive (optional fields with
// sane fallbacks) because content is authored incrementally — a brand-new
// VIDEO lesson has no mediaId yet, and the builder must still render.
// ---------------------------------------------------------------------------

export interface RichTextLessonContent {
  blocks: Block[];
}
export interface SopRefLessonContent {
  sopId?: string | null;
  sopCode?: string;
}
export interface MediaLessonContent {
  mediaId?: string | null;
  externalUrl?: string | null;
}
export interface ChecklistItemContent {
  id: string;
  text: string;
}
export interface ChecklistLessonContent {
  requireAll?: boolean;
  items: ChecklistItemContent[];
}
export interface FlashcardItemContent {
  id: string;
  front: string;
  back: string;
}
export interface FlashcardsLessonContent {
  cards: FlashcardItemContent[];
}
export interface ScenarioChoiceContent {
  id: string;
  label: string;
  correct?: boolean;
  feedback?: string;
  next?: string | null;
}
export interface ScenarioLessonContent {
  scenario: string;
  choices: ScenarioChoiceContent[];
}
export interface SurveyQuestionContent {
  id: string;
  prompt: string;
  kind: "text" | "rating" | "choice";
  options?: string[];
}
export interface SurveyLessonContent {
  questions: SurveyQuestionContent[];
}
export interface AcknowledgementLessonContent {
  statement: string;
  sopCode?: string;
  sopId?: string | null;
  requireTypedSignature?: boolean;
}
export interface SignatureLessonContent {
  statement: string;
}
export interface ManagerSignoffLessonContent {
  instruction: string;
  criteria: string[];
}
export interface AssignmentProjectLessonContent {
  instructions: string;
}
export interface ExternalLinkLessonContent {
  url: string;
  label?: string;
}
export interface DownloadLessonContent {
  mediaId?: string | null;
  label?: string;
}
export interface EmbedLessonContent {
  url: string;
  title?: string;
  height?: number;
}
export interface LiveSessionLessonContent {
  liveSessionId?: string | null;
}
export interface FlowchartLessonContent {
  blocks: Block[];
}

const nonEmpty = (msg: string) => z.string().trim().min(1, msg);

/** Zod schema for a lesson's content JSON, keyed by LessonType. Used at the authoring boundary. */
function lessonContentSchema(type: LessonType): z.ZodTypeAny {
  switch (type) {
    case "RICH_TEXT":
    case "FLOWCHART":
      return z.object({ blocks: z.array(z.record(z.unknown())).default([]) });
    case "SOP_REF":
      return z.object({ sopId: z.string().nullish(), sopCode: z.string().optional() });
    case "VIDEO":
    case "AI_VIDEO":
    case "SCREEN_RECORDING":
    case "AUDIO":
    case "DOCUMENT":
    case "PRESENTATION":
    case "IMAGE":
      return z.object({ mediaId: z.string().nullish(), externalUrl: z.string().url().nullish() });
    case "CHECKLIST":
      return z.object({
        requireAll: z.boolean().default(true),
        items: z.array(z.object({ id: nonEmpty("Item id required"), text: nonEmpty("Item text required") })),
      });
    case "FLASHCARDS":
      return z.object({
        cards: z.array(
          z.object({ id: nonEmpty("id"), front: nonEmpty("front"), back: nonEmpty("back") }),
        ),
      });
    case "SCENARIO":
      return z.object({
        scenario: nonEmpty("Scenario text is required"),
        choices: z.array(
          z.object({
            id: nonEmpty("id"),
            label: nonEmpty("label"),
            correct: z.boolean().optional(),
            feedback: z.string().optional(),
            next: z.string().nullish(),
          }),
        ),
      });
    case "SURVEY":
      return z.object({
        questions: z.array(
          z.object({
            id: nonEmpty("id"),
            prompt: nonEmpty("prompt"),
            kind: z.enum(["text", "rating", "choice"]),
            options: z.array(z.string()).optional(),
          }),
        ),
      });
    case "ACKNOWLEDGEMENT":
      return z.object({
        statement: nonEmpty("Statement is required"),
        sopCode: z.string().optional(),
        sopId: z.string().nullish(),
        requireTypedSignature: z.boolean().default(false),
      });
    case "SIGNATURE":
      return z.object({ statement: nonEmpty("Statement is required") });
    case "MANAGER_SIGNOFF":
    case "PRACTICAL_DEMO":
      return z.object({
        instruction: nonEmpty("Instruction is required"),
        criteria: z.array(z.string()).default([]),
      });
    case "ASSIGNMENT_PROJECT":
      return z.object({ instructions: nonEmpty("Instructions are required") });
    case "EXTERNAL_LINK":
      return z.object({ url: z.string().url("Enter a valid URL"), label: z.string().optional() });
    case "DOWNLOAD":
      return z.object({ mediaId: z.string().nullish(), label: z.string().optional() });
    case "EMBED":
      return z.object({
        url: z.string().url("Enter a valid URL"),
        title: z.string().optional(),
        height: z.number().int().min(120).max(1200).default(420),
      });
    case "LIVE_SESSION":
      return z.object({ liveSessionId: z.string().nullish() });
    case "DISCUSSION":
      return z.object({ prompt: z.string().optional() });
    case "QUIZ":
      return z.object({
        instructions: z.string().optional(),
        oneQuestionAtATime: z.boolean().default(true),
        poolSize: z.number().int().min(1).optional(),
        shuffleQuestions: z.boolean().default(true),
        shuffleAnswers: z.boolean().default(true),
        showExplanations: z.boolean().default(true),
        reviewPolicy: z.enum(["immediate", "after_pass", "never"]).default("immediate"),
      });
    default:
      return z.record(z.unknown());
  }
}

export function validateLessonContent(type: LessonType, content: unknown): Record<string, unknown> {
  const schema = lessonContentSchema(type);
  const parsed = schema.safeParse(content ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ServiceError(first ? `${first.path.join(".")}: ${first.message}` : "Invalid lesson content");
  }
  return parsed.data as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Course CRUD
// ---------------------------------------------------------------------------

export const courseInputSchema = z.object({
  title: nonEmpty("Title is required").max(200),
  description: z.string().max(4000).optional().nullable(),
  category: z.string().max(120).optional().nullable(),
  departmentId: z.string().optional().nullable(),
  businessUnitId: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  difficulty: z.nativeEnum(Difficulty).optional(),
  estimatedMinutes: z.number().int().min(0).max(10000).optional().nullable(),
  passingScore: z.number().int().min(0).max(100).optional().nullable(),
  attemptLimit: z.number().int().min(1).max(50).optional().nullable(),
  recertifyMonths: z.number().int().min(1).max(120).optional().nullable(),
  selfEnrollAllowed: z.boolean().optional(),
  requiredVideoPercent: z.number().int().min(1).max(100).optional(),
});
export type CourseInput = z.infer<typeof courseInputSchema>;

export async function createCourse(actor: Actor, rawInput: unknown) {
  requireCap(actor, "training.create");
  const input = courseInputSchema.parse(rawInput);

  const course = await prisma.course.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      category: input.category ?? null,
      departmentId: input.departmentId ?? null,
      businessUnitId: input.businessUnitId ?? null,
      ownerId: input.ownerId ?? actor.id,
      difficulty: input.difficulty ?? "BEGINNER",
      estimatedMinutes: input.estimatedMinutes ?? null,
      passingScore: input.passingScore ?? null,
      attemptLimit: input.attemptLimit ?? null,
      recertifyMonths: input.recertifyMonths ?? null,
      selfEnrollAllowed: input.selfEnrollAllowed ?? false,
      requiredVideoPercent: input.requiredVideoPercent ?? 90,
      status: "DRAFT",
      createdById: actor.id,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.COURSE_CREATED,
    entityType: "COURSE",
    entityId: course.id,
    metadata: { title: course.title },
  });

  return course;
}

export async function updateCourse(actor: Actor, courseId: string, rawInput: unknown) {
  requireCap(actor, "training.create");
  const input = courseInputSchema.partial().parse(rawInput);

  const course = await prisma.course.update({
    where: { id: courseId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
      ...(input.businessUnitId !== undefined ? { businessUnitId: input.businessUnitId } : {}),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
      ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
      ...(input.estimatedMinutes !== undefined ? { estimatedMinutes: input.estimatedMinutes } : {}),
      ...(input.passingScore !== undefined ? { passingScore: input.passingScore } : {}),
      ...(input.attemptLimit !== undefined ? { attemptLimit: input.attemptLimit } : {}),
      ...(input.recertifyMonths !== undefined ? { recertifyMonths: input.recertifyMonths } : {}),
      ...(input.selfEnrollAllowed !== undefined ? { selfEnrollAllowed: input.selfEnrollAllowed } : {}),
      ...(input.requiredVideoPercent !== undefined
        ? { requiredVideoPercent: input.requiredVideoPercent }
        : {}),
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.COURSE_UPDATED,
    entityType: "COURSE",
    entityId: course.id,
  });

  return course;
}

export async function addSection(actor: Actor, courseId: string, title: string) {
  requireCap(actor, "training.create");
  const trimmed = title.trim();
  if (!trimmed) throw new ServiceError("Section title is required.");

  const last = await prisma.courseSection.findFirst({
    where: { courseId },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  return prisma.courseSection.create({
    data: { courseId, title: trimmed, order: (last?.order ?? -1) + 1 },
  });
}

export async function updateSection(actor: Actor, sectionId: string, title: string) {
  requireCap(actor, "training.create");
  const trimmed = title.trim();
  if (!trimmed) throw new ServiceError("Section title is required.");
  return prisma.courseSection.update({ where: { id: sectionId }, data: { title: trimmed } });
}

export async function deleteSection(actor: Actor, sectionId: string) {
  requireCap(actor, "training.create");
  const lessonCount = await prisma.lesson.count({ where: { sectionId } });
  if (lessonCount > 0) {
    const hasProgress = await prisma.lessonProgress.count({
      where: { lesson: { sectionId } },
    });
    if (hasProgress > 0) {
      throw new ServiceError(
        "This section has learner progress recorded against it. Remove its lessons individually, or archive the course instead of deleting content.",
      );
    }
  }
  await prisma.courseSection.delete({ where: { id: sectionId } });
}

export async function reorderSections(actor: Actor, courseId: string, orderedSectionIds: string[]) {
  requireCap(actor, "training.create");
  await prisma.$transaction(
    orderedSectionIds.map((id, index) =>
      prisma.courseSection.update({ where: { id, courseId }, data: { order: index } }),
    ),
  );
}

export const lessonInputSchema = z.object({
  title: nonEmpty("Lesson title is required").max(200),
  type: z.nativeEnum(LessonType),
  required: z.boolean().optional(),
  estimatedMinutes: z.number().int().min(0).max(1000).optional().nullable(),
  content: z.unknown().optional(),
});
export type LessonInput = z.infer<typeof lessonInputSchema>;

export async function addLesson(actor: Actor, sectionId: string, rawInput: unknown) {
  requireCap(actor, "training.create");
  const input = lessonInputSchema.parse(rawInput);
  const content = validateLessonContent(input.type, input.content ?? {});

  const last = await prisma.lesson.findFirst({
    where: { sectionId },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  return prisma.lesson.create({
    data: {
      sectionId,
      title: input.title,
      type: input.type,
      order: (last?.order ?? -1) + 1,
      required: input.required ?? true,
      estimatedMinutes: input.estimatedMinutes ?? null,
      content: content as Prisma.InputJsonValue,
    },
  });
}

export async function updateLesson(actor: Actor, lessonId: string, rawInput: unknown) {
  requireCap(actor, "training.create");
  const input = lessonInputSchema.partial().parse(rawInput);

  const existing = await prisma.lesson.findUniqueOrThrow({
    where: { id: lessonId },
    select: { type: true },
  });
  const type = input.type ?? existing.type;
  const content =
    input.content !== undefined ? validateLessonContent(type, input.content) : undefined;

  return prisma.lesson.update({
    where: { id: lessonId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.required !== undefined ? { required: input.required } : {}),
      ...(input.estimatedMinutes !== undefined ? { estimatedMinutes: input.estimatedMinutes } : {}),
      ...(content !== undefined ? { content: content as Prisma.InputJsonValue } : {}),
    },
  });
}

export async function deleteLesson(actor: Actor, lessonId: string) {
  requireCap(actor, "training.create");
  const progressCount = await prisma.lessonProgress.count({ where: { lessonId } });
  const attemptCount = await prisma.quizAttempt.count({ where: { lessonId } });
  if (progressCount > 0 || attemptCount > 0) {
    throw new ServiceError(
      "Learners have progress or quiz attempts recorded against this lesson. Published history is preserved in the course's version snapshots — unpublish or archive the course instead of deleting this lesson.",
    );
  }
  await prisma.lesson.delete({ where: { id: lessonId } });
}

export async function reorderLessons(actor: Actor, sectionId: string, orderedLessonIds: string[]) {
  requireCap(actor, "training.create");
  await prisma.$transaction(
    orderedLessonIds.map((id, index) =>
      prisma.lesson.update({ where: { id, sectionId }, data: { order: index } }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Quiz question authoring
// ---------------------------------------------------------------------------

export const questionInputSchema = z.object({
  type: z.nativeEnum(QuestionType),
  prompt: nonEmpty("Prompt is required"),
  config: z.record(z.unknown()),
  points: z.number().int().min(1).max(100).optional(),
  required: z.boolean().optional(),
  explanation: z.string().optional().nullable(),
});
export type QuestionInput = z.infer<typeof questionInputSchema>;

export async function addQuestion(actor: Actor, lessonId: string, rawInput: unknown) {
  requireCap(actor, "training.create");
  const input = questionInputSchema.parse(rawInput);

  const last = await prisma.question.findFirst({
    where: { lessonId },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  return prisma.question.create({
    data: {
      lessonId,
      type: input.type,
      order: (last?.order ?? -1) + 1,
      prompt: input.prompt,
      config: input.config as Prisma.InputJsonValue,
      points: input.points ?? 1,
      required: input.required ?? true,
      explanation: input.explanation ?? null,
    },
  });
}

export async function updateQuestion(actor: Actor, questionId: string, rawInput: unknown) {
  requireCap(actor, "training.create");
  const input = questionInputSchema.partial().parse(rawInput);

  return prisma.question.update({
    where: { id: questionId },
    data: {
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
      ...(input.config !== undefined ? { config: input.config as Prisma.InputJsonValue } : {}),
      ...(input.points !== undefined ? { points: input.points } : {}),
      ...(input.required !== undefined ? { required: input.required } : {}),
      ...(input.explanation !== undefined ? { explanation: input.explanation } : {}),
    },
  });
}

export async function deleteQuestion(actor: Actor, questionId: string) {
  requireCap(actor, "training.create");
  const responseCount = await prisma.quizResponse.count({ where: { questionId } });
  if (responseCount > 0) {
    throw new ServiceError(
      "Learners have already answered this question. It is preserved in past quiz attempts — remove it from future attempts by archiving the course version instead.",
    );
  }
  await prisma.question.delete({ where: { id: questionId } });
}

export async function reorderQuestions(actor: Actor, lessonId: string, orderedQuestionIds: string[]) {
  requireCap(actor, "training.create");
  await prisma.$transaction(
    orderedQuestionIds.map((id, index) =>
      prisma.question.update({ where: { id, lessonId }, data: { order: index } }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Publish / archive
// ---------------------------------------------------------------------------

function nextVersionNumber(current: string | null | undefined): string {
  if (!current) return "1.0";
  const [majorRaw = "1", minorRaw = "0"] = current.split(".");
  const major = Number(majorRaw) || 1;
  const minor = Number(minorRaw) || 0;
  return `${major}.${minor + 1}`;
}

/**
 * Build the full immutable snapshot of a course's structure and content —
 * course meta + sections + lessons + questions. Same shape as
 * buildCourseSnapshot in prisma/seed-content.ts.
 */
export async function buildCourseSnapshot(courseId: string): Promise<Record<string, unknown>> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      difficulty: true,
      estimatedMinutes: true,
      passingScore: true,
      attemptLimit: true,
      recertifyMonths: true,
      requiredVideoPercent: true,
      sections: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          title: true,
          order: true,
          lessons: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              title: true,
              type: true,
              order: true,
              required: true,
              estimatedMinutes: true,
              content: true,
              questions: {
                orderBy: { order: "asc" },
                select: {
                  id: true,
                  type: true,
                  order: true,
                  prompt: true,
                  config: true,
                  points: true,
                  explanation: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!course) throw new ServiceError("Course not found while building publish snapshot.");
  return JSON.parse(JSON.stringify(course)) as Record<string, unknown>;
}

export async function publishCourse(actor: Actor, courseId: string, changeSummary?: string) {
  requireCap(actor, "training.publish");

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, title: true, currentVersion: { select: { versionNumber: true } } },
  });
  if (!course) throw new ServiceError("Course not found.");

  const sectionCount = await prisma.courseSection.count({ where: { courseId } });
  if (sectionCount === 0) {
    throw new ServiceError("Add at least one section with a lesson before publishing.");
  }
  const lessonCount = await prisma.lesson.count({ where: { section: { courseId } } });
  if (lessonCount === 0) {
    throw new ServiceError("Add at least one lesson before publishing.");
  }

  const snapshot = await buildCourseSnapshot(courseId);
  const versionNumber = nextVersionNumber(course.currentVersion?.versionNumber);

  const version = await prisma.courseVersion.create({
    data: {
      courseId,
      versionNumber,
      title: course.title,
      snapshot: snapshot as Prisma.InputJsonValue,
      changeSummary: changeSummary?.trim() || null,
      authorId: actor.id,
    },
  });

  const updated = await prisma.course.update({
    where: { id: courseId },
    data: { currentVersionId: version.id, status: "PUBLISHED" },
  });

  await enqueueJob(JOB_TYPES.INDEX_CONTENT, {
    entityType: "COURSE",
    entityId: courseId,
    courseVersionId: version.id,
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.COURSE_PUBLISHED,
    entityType: "COURSE",
    entityId: courseId,
    metadata: { versionNumber, changeSummary: changeSummary ?? null },
  });

  return { course: updated, version };
}

export async function archiveCourse(actor: Actor, courseId: string) {
  requireCap(actor, "training.archive");

  const completionCount = await prisma.completionRecord.count({ where: { courseId } });
  const course = await prisma.course.update({
    where: { id: courseId },
    data: { status: "ARCHIVED", isDeleted: false },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.COURSE_ARCHIVED,
    entityType: "COURSE",
    entityId: courseId,
    metadata: { hadCompletionHistory: completionCount > 0 },
  });

  return course;
}

/**
 * Published courses with completion history are never hard-deleted. This is
 * the only deletion path this service exposes for a course record itself —
 * callers asking to "delete" a course with history must archive instead.
 */
export async function deleteCourse(actor: Actor, courseId: string) {
  requireCap(actor, "training.archive");

  const completionCount = await prisma.completionRecord.count({ where: { courseId } });
  if (completionCount > 0) {
    throw new ServiceError(
      `This course has ${completionCount} completion record${completionCount === 1 ? "" : "s"} on file. ` +
        "Published training with completion history is never deleted — archive it instead so the evidence stays intact.",
    );
  }

  const assignmentCount = await prisma.assignment.count({ where: { courseId } });
  if (assignmentCount > 0) {
    throw new ServiceError(
      "People are currently assigned this course. Remove or reassign those assignments first, or archive the course instead.",
    );
  }

  await prisma.course.delete({ where: { id: courseId } });
  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.COURSE_ARCHIVED,
    entityType: "COURSE",
    entityId: courseId,
    metadata: { hardDeleted: true },
  });
}

export async function duplicateCourse(actor: Actor, courseId: string) {
  requireCap(actor, "training.create");

  const source = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      title: true,
      description: true,
      category: true,
      departmentId: true,
      businessUnitId: true,
      ownerId: true,
      difficulty: true,
      estimatedMinutes: true,
      passingScore: true,
      attemptLimit: true,
      recertifyMonths: true,
      requiredVideoPercent: true,
      sections: {
        orderBy: { order: "asc" },
        include: { lessons: { orderBy: { order: "asc" }, include: { questions: { orderBy: { order: "asc" } } } } },
      },
      skills: true,
    },
  });
  if (!source) throw new ServiceError("Course not found.");

  const copy = await prisma.course.create({
    data: {
      title: `${source.title} (Copy)`,
      description: source.description,
      category: source.category,
      departmentId: source.departmentId,
      businessUnitId: source.businessUnitId,
      ownerId: source.ownerId ?? actor.id,
      difficulty: source.difficulty,
      estimatedMinutes: source.estimatedMinutes,
      passingScore: source.passingScore,
      attemptLimit: source.attemptLimit,
      recertifyMonths: source.recertifyMonths,
      requiredVideoPercent: source.requiredVideoPercent,
      status: "DRAFT",
      createdById: actor.id,
    },
  });

  for (const skill of source.skills) {
    await prisma.courseSkill.create({
      data: { courseId: copy.id, skillId: skill.skillId, levelValue: skill.levelValue },
    });
  }

  for (const section of source.sections) {
    const newSection = await prisma.courseSection.create({
      data: { courseId: copy.id, title: section.title, order: section.order },
    });
    for (const lesson of section.lessons) {
      const newLesson = await prisma.lesson.create({
        data: {
          sectionId: newSection.id,
          title: lesson.title,
          type: lesson.type,
          order: lesson.order,
          required: lesson.required,
          estimatedMinutes: lesson.estimatedMinutes,
          content: lesson.content as Prisma.InputJsonValue | undefined,
        },
      });
      for (const question of lesson.questions) {
        await prisma.question.create({
          data: {
            lessonId: newLesson.id,
            type: question.type,
            order: question.order,
            prompt: question.prompt,
            config: question.config as Prisma.InputJsonValue,
            points: question.points,
            required: question.required,
            explanation: question.explanation,
          },
        });
      }
    }
  }

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.COURSE_CREATED,
    entityType: "COURSE",
    entityId: copy.id,
    metadata: { duplicatedFrom: courseId },
  });

  return copy;
}

// ---------------------------------------------------------------------------
// Learner-facing composition
// ---------------------------------------------------------------------------

export interface LessonProgressSummary {
  lessonId: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  videoWatchedPercent: number | null;
  completedAt: Date | null;
}

export interface CourseForLearner {
  course: {
    id: string;
    title: string;
    description: string | null;
    category: string | null;
    difficulty: Difficulty;
    estimatedMinutes: number | null;
    status: string;
    requiredVideoPercent: number;
    passingScore: number | null;
    selfEnrollAllowed: boolean;
    skills: { skillId: string; name: string; levelValue: number | null }[];
    sections: {
      id: string;
      title: string;
      order: number;
      lessons: {
        id: string;
        title: string;
        type: LessonType;
        order: number;
        required: boolean;
        estimatedMinutes: number | null;
        progress: LessonProgressSummary | null;
      }[];
    }[];
  };
  assignment: {
    id: string;
    reason: string | null;
    dueAt: Date | null;
    status: string;
    source: string;
    assignedAt: Date;
  } | null;
  prerequisites: { id: string; title: string; met: boolean }[];
  blocked: boolean;
  overallPercent: number;
  totalLessons: number;
  completedLessons: number;
  nextLessonId: string | null;
  certificate: { id: string; certificateNumber: string; issuedAt: Date; expiresAt: Date | null } | null;
}

export async function getCourseForLearner(actor: Actor, courseId: string): Promise<CourseForLearner> {
  const course = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      difficulty: true,
      estimatedMinutes: true,
      status: true,
      requiredVideoPercent: true,
      passingScore: true,
      selfEnrollAllowed: true,
      skills: { select: { skillId: true, levelValue: true, skill: { select: { name: true } } } },
      sections: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          title: true,
          order: true,
          lessons: {
            orderBy: { order: "asc" },
            select: { id: true, title: true, type: true, order: true, required: true, estimatedMinutes: true },
          },
        },
      },
      prerequisites: { select: { prerequisite: { select: { id: true, title: true } } } },
    },
  });

  const lessonIds = course.sections.flatMap((s) => s.lessons.map((l) => l.id));
  const [progressRows, assignment, certificate, prereqCompletions] = await Promise.all([
    prisma.lessonProgress.findMany({
      where: { userId: actor.id, lessonId: { in: lessonIds } },
      select: { lessonId: true, status: true, videoWatchedPercent: true, completedAt: true },
    }),
    prisma.assignment.findFirst({
      where: { userId: actor.id, targetType: "COURSE", courseId },
      orderBy: { assignedAt: "desc" },
      select: { id: true, reason: true, dueAt: true, status: true, source: true, assignedAt: true },
    }),
    prisma.completionRecord.findFirst({
      where: { userId: actor.id, courseId, certificateId: { not: null } },
      orderBy: { completedAt: "desc" },
      select: {
        certificate: { select: { id: true, certificateNumber: true, issuedAt: true, expiresAt: true } },
      },
    }),
    course.prerequisites.length
      ? prisma.completionRecord.findMany({
          where: {
            userId: actor.id,
            courseId: { in: course.prerequisites.map((p) => p.prerequisite.id) },
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          select: { courseId: true },
        })
      : Promise.resolve([]),
  ]);

  const progressByLesson = new Map(progressRows.map((p) => [p.lessonId, p]));
  const completedPrereqIds = new Set(prereqCompletions.map((c) => c.courseId));

  const prerequisites = course.prerequisites.map((p) => ({
    id: p.prerequisite.id,
    title: p.prerequisite.title,
    met: completedPrereqIds.has(p.prerequisite.id),
  }));
  const blocked = prerequisites.some((p) => !p.met);

  let totalLessons = 0;
  let completedLessons = 0;
  let nextLessonId: string | null = null;

  const sections = course.sections.map((section) => ({
    id: section.id,
    title: section.title,
    order: section.order,
    lessons: section.lessons.map((lesson) => {
      totalLessons += 1;
      const progressRow = progressByLesson.get(lesson.id);
      const status = progressRow?.status ?? "NOT_STARTED";
      if (status === "COMPLETED") completedLessons += 1;
      else if (!nextLessonId && !blocked) nextLessonId = lesson.id;

      return {
        id: lesson.id,
        title: lesson.title,
        type: lesson.type,
        order: lesson.order,
        required: lesson.required,
        estimatedMinutes: lesson.estimatedMinutes,
        progress: progressRow
          ? {
              lessonId: lesson.id,
              status: progressRow.status,
              videoWatchedPercent: progressRow.videoWatchedPercent,
              completedAt: progressRow.completedAt,
            }
          : null,
      };
    }),
  }));

  return {
    course: {
      id: course.id,
      title: course.title,
      description: course.description,
      category: course.category,
      difficulty: course.difficulty,
      estimatedMinutes: course.estimatedMinutes,
      status: course.status,
      requiredVideoPercent: course.requiredVideoPercent,
      passingScore: course.passingScore,
      selfEnrollAllowed: course.selfEnrollAllowed,
      skills: course.skills.map((s) => ({ skillId: s.skillId, name: s.skill.name, levelValue: s.levelValue })),
      sections,
    },
    assignment: assignment
      ? {
          id: assignment.id,
          reason: assignment.reason,
          dueAt: assignment.dueAt,
          status: assignment.status,
          source: assignment.source,
          assignedAt: assignment.assignedAt,
        }
      : null,
    prerequisites,
    blocked,
    overallPercent: totalLessons === 0 ? 0 : Math.round((completedLessons / totalLessons) * 100),
    totalLessons,
    completedLessons,
    nextLessonId,
    certificate: certificate?.certificate
      ? {
          id: certificate.certificate.id,
          certificateNumber: certificate.certificate.certificateNumber,
          issuedAt: certificate.certificate.issuedAt,
          expiresAt: certificate.certificate.expiresAt,
        }
      : null,
  };
}

/** Lightweight percent-complete calculation reused by learning-path progress. */
export async function computeCourseProgressPercent(userId: string, courseId: string): Promise<number> {
  const lessons = await prisma.lesson.findMany({
    where: { section: { courseId } },
    select: { id: true },
  });
  if (lessons.length === 0) return 0;
  const completed = await prisma.lessonProgress.count({
    where: { userId, lessonId: { in: lessons.map((l) => l.id) }, status: "COMPLETED" },
  });
  return Math.round((completed / lessons.length) * 100);
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface CatalogFilters {
  search?: string;
  departmentId?: string;
  category?: string;
  skillId?: string;
  difficulty?: Difficulty;
  format?: LessonType;
  duration?: "under_15" | "15_30" | "30_60" | "over_60";
  requirement?: "required" | "optional" | "all";
  page?: number;
  pageSize?: number;
}

export interface CatalogItem {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  difficulty: Difficulty;
  estimatedMinutes: number | null;
  thumbnailMediaId: string | null;
  selfEnrollAllowed: boolean;
  skills: string[];
  isRequired: boolean;
  assignment: { id: string; status: string; dueAt: Date | null } | null;
  overallPercent: number;
}

export async function getCatalog(
  actor: Actor,
  filters: CatalogFilters,
): Promise<{ items: CatalogItem[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(60, Math.max(1, filters.pageSize ?? 20));

  const where: Prisma.CourseWhereInput = {
    status: "PUBLISHED",
    isDeleted: false,
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.difficulty ? { difficulty: filters.difficulty } : {}),
    ...(filters.skillId ? { skills: { some: { skillId: filters.skillId } } } : {}),
    ...(filters.format ? { sections: { some: { lessons: { some: { type: filters.format } } } } } : {}),
    ...(filters.search
      ? {
          OR: [
            { title: { contains: filters.search, mode: "insensitive" } },
            { description: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(filters.duration
      ? {
          estimatedMinutes:
            filters.duration === "under_15"
              ? { lt: 15 }
              : filters.duration === "15_30"
                ? { gte: 15, lt: 30 }
                : filters.duration === "30_60"
                  ? { gte: 30, lt: 60 }
                  : { gte: 60 },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.course.findMany({
      where,
      orderBy: { title: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        difficulty: true,
        estimatedMinutes: true,
        thumbnailMediaId: true,
        selfEnrollAllowed: true,
        skills: { select: { skill: { select: { name: true } } } },
      },
    }),
    prisma.course.count({ where }),
  ]);

  const courseIds = rows.map((r) => r.id);
  const [assignments, progressPercents] = await Promise.all([
    prisma.assignment.findMany({
      where: { userId: actor.id, targetType: "COURSE", courseId: { in: courseIds } },
      select: { id: true, courseId: true, status: true, dueAt: true },
    }),
    Promise.all(courseIds.map((id) => computeCourseProgressPercent(actor.id, id))),
  ]);
  const assignmentByCourseId = new Map(assignments.map((a) => [a.courseId, a]));
  const percentByCourseId = new Map(courseIds.map((id, i) => [id, progressPercents[i] ?? 0]));

  let items: CatalogItem[] = rows.map((row) => {
    const assignment = assignmentByCourseId.get(row.id) ?? null;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      difficulty: row.difficulty,
      estimatedMinutes: row.estimatedMinutes,
      thumbnailMediaId: row.thumbnailMediaId,
      selfEnrollAllowed: row.selfEnrollAllowed,
      skills: row.skills.map((s) => s.skill.name),
      isRequired: Boolean(assignment),
      assignment: assignment
        ? { id: assignment.id, status: assignment.status, dueAt: assignment.dueAt }
        : null,
      overallPercent: percentByCourseId.get(row.id) ?? 0,
    };
  });

  if (filters.requirement === "required") items = items.filter((i) => i.isRequired);
  if (filters.requirement === "optional") items = items.filter((i) => !i.isRequired);

  return { items, total, page, pageSize };
}

// ---------------------------------------------------------------------------
// Self-enrollment
// ---------------------------------------------------------------------------

export async function selfEnroll(actor: Actor, courseId: string) {
  const settings = await getSettings();
  if (!settings.features.selfEnrollment) {
    throw new ServiceError("Self-enrollment is currently turned off for this organization.");
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, title: true, selfEnrollAllowed: true, status: true },
  });
  if (!course || course.status !== "PUBLISHED") throw new ServiceError("This course is not available.");
  if (!course.selfEnrollAllowed) {
    throw new ServiceError("This course does not allow self-enrollment. Ask your manager to assign it.");
  }

  const existing = await prisma.assignment.findFirst({
    where: { userId: actor.id, targetType: "COURSE", courseId },
    select: { id: true },
  });
  if (existing) return existing;

  const assignment = await prisma.assignment.create({
    data: {
      userId: actor.id,
      targetType: "COURSE",
      courseId,
      status: "ASSIGNED",
      source: "SELF_ENROLLED",
      reason: "You enrolled yourself from the catalog",
      assignedById: actor.id,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.ASSIGNMENT_CREATED,
    entityType: "COURSE",
    entityId: courseId,
    metadata: { source: "SELF_ENROLLED" },
  });

  return assignment;
}

// ---------------------------------------------------------------------------
// Course health
// ---------------------------------------------------------------------------

export interface CourseHealthFactor {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}
export interface CourseHealth {
  score: number;
  factors: CourseHealthFactor[];
}

export async function computeCourseHealth(courseId: string): Promise<CourseHealth> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      ownerId: true,
      status: true,
      updatedAt: true,
      recertifyMonths: true,
      sections: {
        select: {
          lessons: {
            select: {
              type: true,
              content: true,
              questions: { select: { id: true } },
            },
          },
        },
      },
    },
  });

  if (!course) {
    return {
      score: 0,
      factors: [{ key: "exists", label: "Course exists", passed: false, detail: "Course not found." }],
    };
  }

  const lessons = course.sections.flatMap((s) => s.lessons);
  const quizLessons = lessons.filter((l) => l.type === "QUIZ");
  const hasAssessment = quizLessons.some((l) => l.questions.length > 0);

  const lessonIds = await prisma.lesson.findMany({
    where: { section: { courseId }, type: "QUIZ" },
    select: { id: true },
  });
  let quizPassRateHealthy = true;
  let passRateDetail = "No quiz attempts yet.";
  if (lessonIds.length > 0) {
    const attempts = await prisma.quizAttempt.findMany({
      where: { lessonId: { in: lessonIds.map((l) => l.id) }, status: { in: ["PASSED", "FAILED"] } },
      select: { status: true },
    });
    if (attempts.length > 0) {
      const passed = attempts.filter((a) => a.status === "PASSED").length;
      const rate = passed / attempts.length;
      quizPassRateHealthy = rate >= 0.6;
      passRateDetail = `${Math.round(rate * 100)}% pass rate across ${attempts.length} graded attempts.`;
    }
  }

  // Link-check evidence isn't tracked per-course; treat syntactically valid
  // URLs in link-bearing lesson content as the available signal.
  let noBrokenLinks = true;
  const brokenDetails: string[] = [];
  for (const lesson of lessons) {
    const content = (lesson.content ?? {}) as Record<string, unknown>;
    const candidates = [content.url, content.externalUrl].filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
    for (const url of candidates) {
      try {
        new URL(url);
      } catch {
        noBrokenLinks = false;
        brokenDetails.push(url);
      }
    }
  }

  const reviewWindowMs = (course.recertifyMonths ?? 12) * 30 * 24 * 60 * 60 * 1000;
  const recentlyReviewed = Date.now() - course.updatedAt.getTime() < reviewWindowMs;

  const factors: CourseHealthFactor[] = [
    {
      key: "owner",
      label: "Has an owner",
      passed: Boolean(course.ownerId),
      detail: course.ownerId ? "An owner is assigned." : "No owner is assigned to this course.",
    },
    {
      key: "published",
      label: "Published",
      passed: course.status === "PUBLISHED",
      detail: course.status === "PUBLISHED" ? "Live for learners." : `Current status: ${course.status}.`,
    },
    {
      key: "assessment",
      label: "Has an assessment",
      passed: hasAssessment,
      detail: hasAssessment
        ? `${quizLessons.length} quiz lesson(s) with questions.`
        : "No quiz lesson with questions yet.",
    },
    {
      key: "quiz_pass_rate",
      label: "Healthy quiz pass rate",
      passed: quizPassRateHealthy,
      detail: passRateDetail,
    },
    {
      key: "no_broken_links",
      label: "No broken links",
      passed: noBrokenLinks,
      detail: noBrokenLinks ? "All linked URLs are well-formed." : `${brokenDetails.length} malformed URL(s).`,
    },
    {
      key: "recently_reviewed",
      label: "Recently reviewed",
      passed: recentlyReviewed,
      detail: recentlyReviewed
        ? "Updated within the recertification window."
        : "Content has not been touched within its recertification window — schedule a review.",
    },
  ];

  const score = Math.round((factors.filter((f) => f.passed).length / factors.length) * 100);
  return { score, factors };
}
