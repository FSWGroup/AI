"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import type { Prisma, LessonType, QuestionType } from "@prisma/client";
import { assertPermission } from "@/lib/auth/guard";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { ok, fail, runAction, type ActionResult } from "@/lib/action-result";
import { enqueueJob, JOB_TYPES } from "@/lib/jobs/queue";
import {
  generateSopDraft,
  generateCourseOutline,
  generateCourseFromOutline,
  generateQuizQuestions,
  generateQuickReference,
  translateContent,
  markTranslationsOutdated,
  runQualityCheck,
  findSimilarContent,
  type SopDraftInput,
  type SopDraftOutput,
  type CourseOutlineInput,
  type CourseOutline,
  type CourseDraft,
  type GenerateQuizInput,
  type QuizQuestionDraft,
  type TranslateContentInput,
  type QualityCheckInput,
  type QualityFinding,
} from "@/lib/ai/generate";
import type { Block } from "@/lib/content/types";

const VALID_LESSON_TYPES = new Set<string>([
  "RICH_TEXT", "SOP_REF", "VIDEO", "AI_VIDEO", "SCREEN_RECORDING", "AUDIO", "DOCUMENT", "PRESENTATION",
  "IMAGE", "CHECKLIST", "QUIZ", "FLASHCARDS", "SCENARIO", "SURVEY", "ACKNOWLEDGEMENT", "SIGNATURE",
  "MANAGER_SIGNOFF", "PRACTICAL_DEMO", "ASSIGNMENT_PROJECT", "EXTERNAL_LINK", "LIVE_SESSION",
  "DISCUSSION", "DOWNLOAD", "EMBED", "FLOWCHART",
]);

function normalizeLessonType(type: string): LessonType {
  const upper = type.toUpperCase();
  return (VALID_LESSON_TYPES.has(upper) ? upper : "RICH_TEXT") as LessonType;
}

async function generateUniqueSopCode(category: string): Promise<string> {
  const prefix = (category || "GEN").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 4) || "GEN";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = Math.floor(100 + Math.random() * 900);
    const code = `${prefix}-AI${suffix}`;
    const existing = await prisma.sop.findUnique({ where: { sopCode: code }, select: { id: true } });
    if (!existing) return code;
  }
  return `${prefix}-AI${Date.now()}`;
}

// ---------------------------------------------------------------------------
// SOP draft
// ---------------------------------------------------------------------------

export async function generateSopDraftAction(input: SopDraftInput): Promise<ActionResult<SopDraftOutput>> {
  return runAction("generateSopDraft", async () => {
    const actor = await assertPermission("ai.generate");
    if (!input.source?.text || input.source.text.trim().length < 10) {
      return fail("Add at least a little source material — a prompt, notes, or pasted text.");
    }
    const draft = await generateSopDraft(actor, input);
    return ok(draft);
  });
}

export interface SaveSopDraftInput {
  title: string;
  summary: string;
  category: string;
  meta: SopDraftOutput["meta"];
  blocks: Block[];
  departmentId?: string | null;
  businessUnitId?: string | null;
}

export async function saveSopDraftAction(
  input: SaveSopDraftInput,
): Promise<ActionResult<{ id: string; href: string }>> {
  return runAction("saveSopDraft", async () => {
    await assertPermission("ai.generate");
    const actor = await assertPermission("sop.create");
    if (!input.title.trim()) return fail("Give this SOP a title before saving.");

    const sopCode = await generateUniqueSopCode(input.category);
    const sop = await prisma.sop.create({
      data: {
        sopCode,
        title: input.title.trim(),
        summary: input.summary.trim() || null,
        category: input.category.trim() || null,
        departmentId: input.departmentId ?? null,
        businessUnitId: input.businessUnitId ?? null,
        ownerId: actor.id,
        status: "DRAFT",
        aiGenerated: true,
        draftBlocks: input.blocks as unknown as Prisma.InputJsonValue,
        draftMeta: input.meta as unknown as Prisma.InputJsonValue,
        createdById: actor.id,
      },
      select: { id: true },
    });

    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.SOP_CREATED,
      entityType: "SOP",
      entityId: sop.id,
      metadata: { aiGenerated: true, sopCode },
    });

    revalidatePath("/admin/sops");
    return ok({ id: sop.id, href: `/admin/sops/${sop.id}/edit` });
  });
}

// ---------------------------------------------------------------------------
// Course outline + full draft
// ---------------------------------------------------------------------------

export async function generateCourseOutlineAction(
  input: CourseOutlineInput,
): Promise<ActionResult<CourseOutline>> {
  return runAction("generateCourseOutline", async () => {
    const actor = await assertPermission("ai.generate");
    if (!input.prompt && !input.sopId && !input.documentText) {
      return fail("Give the outline something to work from — a prompt, an SOP, or pasted text.");
    }
    const outline = await generateCourseOutline(actor, input);
    return ok(outline);
  });
}

export async function generateCourseFromOutlineAction(outline: CourseOutline): Promise<ActionResult<CourseDraft>> {
  return runAction("generateCourseFromOutline", async () => {
    const actor = await assertPermission("ai.generate");
    if (!outline.title || outline.sections.length === 0) {
      return fail("This outline doesn't have any sections yet — add at least one before generating full content.");
    }
    const draft = await generateCourseFromOutline(actor, outline);
    return ok(draft);
  });
}

export async function saveCourseDraftAction(
  draft: CourseDraft,
): Promise<ActionResult<{ id: string; href: string }>> {
  return runAction("saveCourseDraft", async () => {
    await assertPermission("ai.generate");
    const actor = await assertPermission("training.create");
    if (!draft.title.trim()) return fail("Give this course a title before saving.");

    const course = await prisma.course.create({
      data: {
        title: draft.title.trim(),
        description: draft.description || null,
        category: draft.category || null,
        difficulty: draft.difficulty,
        estimatedMinutes: draft.estimatedMinutes || null,
        ownerId: actor.id,
        status: "DRAFT",
        aiGenerated: true,
        createdById: actor.id,
      },
      select: { id: true },
    });

    for (const [sectionIndex, section] of draft.sections.entries()) {
      const createdSection = await prisma.courseSection.create({
        data: { courseId: course.id, title: section.title, order: sectionIndex },
        select: { id: true },
      });

      for (const [lessonIndex, lesson] of section.lessons.entries()) {
        const type = normalizeLessonType(lesson.type);

        // AI never fabricates a real SOP link — convert the suggestion into a
        // readable note instead of a broken SOP_REF.
        if (type === "SOP_REF") {
          const note = typeof lesson.content?.note === "string" ? lesson.content.note : lesson.summary;
          await prisma.lesson.create({
            data: {
              sectionId: createdSection.id,
              title: lesson.title,
              type: "RICH_TEXT",
              order: lessonIndex,
              estimatedMinutes: lesson.estimatedMinutes || null,
              content: {
                blocks: [
                  { id: `${createdSection.id}-${lessonIndex}-note`, type: "callout", tone: "note", title: "Link the real SOP here", text: note || "The author should attach the relevant SOP." },
                ],
              } as unknown as Prisma.InputJsonValue,
            },
          });
          continue;
        }

        if (type === "QUIZ") {
          const createdLesson = await prisma.lesson.create({
            data: {
              sectionId: createdSection.id,
              title: lesson.title,
              type: "QUIZ",
              order: lessonIndex,
              estimatedMinutes: lesson.estimatedMinutes || null,
            },
            select: { id: true },
          });

          const questions = Array.isArray(lesson.content?.questions)
            ? (lesson.content.questions as QuizQuestionDraft[])
            : [];
          for (const [qIndex, question] of questions.entries()) {
            await prisma.question.create({
              data: {
                lessonId: createdLesson.id,
                type: question.type as QuestionType,
                order: qIndex,
                prompt: question.prompt,
                config: question.config as unknown as Prisma.InputJsonValue,
                points: question.points,
                explanation: question.explanation || null,
                aiGenerated: true,
                isDraft: true,
              },
            });
          }
          continue;
        }

        await prisma.lesson.create({
          data: {
            sectionId: createdSection.id,
            title: lesson.title,
            type,
            order: lessonIndex,
            estimatedMinutes: lesson.estimatedMinutes || null,
            content: (lesson.content ?? {}) as unknown as Prisma.InputJsonValue,
          },
        });
      }
    }

    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.COURSE_CREATED,
      entityType: "COURSE",
      entityId: course.id,
      metadata: { aiGenerated: true },
    });

    revalidatePath("/admin/training");
    return ok({ id: course.id, href: `/admin/training/${course.id}/edit` });
  });
}

// ---------------------------------------------------------------------------
// Quiz question generation
// ---------------------------------------------------------------------------

export async function generateQuizAction(input: GenerateQuizInput): Promise<ActionResult<QuizQuestionDraft[]>> {
  return runAction("generateQuiz", async () => {
    const actor = await assertPermission("ai.generate");
    if (!input.sourceText || input.sourceText.trim().length < 20) {
      return fail("Paste some source material for the questions to be grounded in.");
    }
    const questions = await generateQuizQuestions(actor, input);
    if (questions.length === 0) {
      return fail("The AI couldn't produce valid questions from that source text — try adding more detail.");
    }
    return ok(questions);
  });
}

export interface QuizLessonOption {
  lessonId: string;
  lessonTitle: string;
  courseTitle: string;
}

export async function searchQuizLessonsAction(query: string): Promise<ActionResult<QuizLessonOption[]>> {
  return runAction("searchQuizLessons", async () => {
    await assertPermission("ai.generate");
    const term = query.trim();
    if (term.length < 2) return ok([]);

    const lessons = await prisma.lesson.findMany({
      where: { type: "QUIZ", title: { contains: term, mode: "insensitive" } },
      select: { id: true, title: true, section: { select: { course: { select: { title: true } } } } },
      take: 15,
    });
    return ok(
      lessons.map((l) => ({ lessonId: l.id, lessonTitle: l.title, courseTitle: l.section.course.title })),
    );
  });
}

export async function saveQuizQuestionsAction(input: {
  lessonId: string;
  questions: QuizQuestionDraft[];
}): Promise<ActionResult<{ count: number }>> {
  return runAction("saveQuizQuestions", async () => {
    await assertPermission("ai.generate");
    const actor = await assertPermission("training.create");
    if (input.questions.length === 0) return fail("There are no questions to save.");

    const lesson = await prisma.lesson.findUnique({ where: { id: input.lessonId }, select: { id: true } });
    if (!lesson) return fail("That lesson no longer exists. Pick another destination.");

    const existingCount = await prisma.question.count({ where: { lessonId: input.lessonId } });

    await prisma.$transaction(
      input.questions.map((q, i) =>
        prisma.question.create({
          data: {
            lessonId: input.lessonId,
            type: q.type as QuestionType,
            order: existingCount + i,
            prompt: q.prompt,
            config: q.config as unknown as Prisma.InputJsonValue,
            points: q.points,
            explanation: q.explanation || null,
            aiGenerated: true,
            isDraft: true,
          },
        }),
      ),
    );

    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.AI_GENERATION_REQUESTED,
      entityType: "LESSON",
      entityId: input.lessonId,
      metadata: { kind: "quiz_questions_saved", count: input.questions.length },
    });

    revalidatePath("/admin/training");
    return ok({ count: input.questions.length });
  });
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

export async function translateContentAction(
  input: TranslateContentInput,
): Promise<ActionResult<{ id: string; language: string }>> {
  return runAction("translateContent", async () => {
    const actor = await assertPermission("ai.generate");
    const permission = input.entityType === "SOP" ? "sop.create" : "training.create";
    await assertPermission(permission);

    const translation = await translateContent(actor, input);

    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.AI_GENERATION_REQUESTED,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: { kind: "translate", targetLanguage: input.targetLanguage },
    });

    return ok({ id: translation.id, language: translation.language });
  });
}

/** Exposed for the SOP/course publish flows (owned elsewhere) to call after a new version publishes. */
export async function markTranslationsOutdatedAction(
  entityType: "SOP" | "COURSE",
  entityId: string,
): Promise<ActionResult<{ count: number }>> {
  return runAction("markTranslationsOutdated", async () => {
    await assertPermission(entityType === "SOP" ? "sop.publish" : "training.publish");
    const count = await markTranslationsOutdated(entityType, entityId);
    return ok({ count });
  });
}

// ---------------------------------------------------------------------------
// Quality check
// ---------------------------------------------------------------------------

export async function runQualityCheckAction(input: QualityCheckInput): Promise<ActionResult<QualityFinding[]>> {
  return runAction("runQualityCheck", async () => {
    const actor = await assertPermission("ai.generate");
    const findings = await runQualityCheck(actor, input);
    return ok(findings);
  });
}

export async function findSimilarContentAction(
  title: string,
  body: string,
): Promise<ActionResult<Awaited<ReturnType<typeof findSimilarContent>>>> {
  return runAction("findSimilarContent", async () => {
    await assertPermission("ai.generate");
    const matches = await findSimilarContent(title, body);
    return ok(matches);
  });
}

// ---------------------------------------------------------------------------
// Quick reference
// ---------------------------------------------------------------------------

export async function generateQuickReferenceAction(
  sopId: string,
): Promise<ActionResult<{ title: string; blocks: Block[] }>> {
  return runAction("generateQuickReference", async () => {
    const actor = await assertPermission("ai.generate");
    const result = await generateQuickReference(actor, sopId);
    return ok(result);
  });
}

// ---------------------------------------------------------------------------
// Content pickers (source input: "pick an SOP" / "pick a course")
// ---------------------------------------------------------------------------

export interface ContentOption {
  id: string;
  title: string;
  subtitle: string | null;
}

export async function searchSopsAction(query: string): Promise<ActionResult<ContentOption[]>> {
  return runAction("searchSops", async () => {
    await assertPermission("ai.generate");
    const term = query.trim();
    const sops = await prisma.sop.findMany({
      where: {
        status: "PUBLISHED",
        isDeleted: false,
        ...(term.length >= 2 ? { title: { contains: term, mode: "insensitive" as const } } : {}),
      },
      select: { id: true, title: true, sopCode: true },
      take: 20,
      orderBy: { title: "asc" },
    });
    return ok(sops.map((s) => ({ id: s.id, title: s.title, subtitle: s.sopCode })));
  });
}

export async function searchCoursesAction(query: string): Promise<ActionResult<ContentOption[]>> {
  return runAction("searchCourses", async () => {
    await assertPermission("ai.generate");
    const term = query.trim();
    const courses = await prisma.course.findMany({
      where: {
        status: "PUBLISHED",
        isDeleted: false,
        ...(term.length >= 2 ? { title: { contains: term, mode: "insensitive" as const } } : {}),
      },
      select: { id: true, title: true, category: true },
      take: 20,
      orderBy: { title: "asc" },
    });
    return ok(courses.map((c) => ({ id: c.id, title: c.title, subtitle: c.category })));
  });
}

/** Enqueue background generation for a flow the author will come back to later, instead of waiting synchronously. */
export async function enqueueAiGenerateJobAction(
  kind: "SOP_DRAFT" | "COURSE_OUTLINE" | "COURSE_DRAFT" | "QUIZ_SUGGEST" | "TRANSLATE" | "QUALITY_CHECK" | "QUICK_REFERENCE",
  input: Record<string, unknown>,
): Promise<ActionResult<{ jobId: string | null }>> {
  return runAction("enqueueAiGenerateJob", async () => {
    const actor = await assertPermission("ai.generate");
    const jobId = await enqueueJob(JOB_TYPES.AI_GENERATE, { kind, createdById: actor.id, input });
    return ok({ jobId });
  });
}
