"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { ok, fail, runAction, fieldErrorsFromZod, type ActionResult } from "@/lib/action-result";
import {
  updateCourse,
  addSection,
  updateSection,
  deleteSection,
  reorderSections,
  addLesson,
  updateLesson,
  deleteLesson,
  reorderLessons,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  reorderQuestions,
  publishCourse,
  courseInputSchema,
  lessonInputSchema,
  questionInputSchema,
  ServiceError,
} from "@/lib/services/course";

async function withCourseGuard<T>(courseId: string, body: () => Promise<T>): Promise<ActionResult<T>> {
  return runAction("training.edit", async () => {
    try {
      const data = await body();
      revalidatePath(`/admin/training/${courseId}/edit`);
      return ok(data);
    } catch (error) {
      if (error instanceof ServiceError) return fail(error.message);
      throw error;
    }
  });
}

export async function updateCourseMetaAction(courseId: string, formData: FormData): Promise<ActionResult> {
  const parsed = courseInputSchema.partial().safeParse({
    title: formData.get("title") || undefined,
    description: formData.get("description") || undefined,
    category: formData.get("category") || undefined,
    difficulty: formData.get("difficulty") || undefined,
    estimatedMinutes: formData.get("estimatedMinutes") ? Number(formData.get("estimatedMinutes")) : undefined,
    passingScore: formData.get("passingScore") ? Number(formData.get("passingScore")) : undefined,
    attemptLimit: formData.get("attemptLimit") ? Number(formData.get("attemptLimit")) : undefined,
    recertifyMonths: formData.get("recertifyMonths") ? Number(formData.get("recertifyMonths")) : undefined,
    requiredVideoPercent: formData.get("requiredVideoPercent") ? Number(formData.get("requiredVideoPercent")) : undefined,
    selfEnrollAllowed: formData.get("selfEnrollAllowed") === "on",
  });
  if (!parsed.success) return fail("Check the fields below.", fieldErrorsFromZod(parsed.error));

  return withCourseGuard(courseId, async () => {
    const actor = await assertPermission("training.create");
    await updateCourse(actor, courseId, parsed.data);
    return undefined;
  });
}

export async function addSectionAction(courseId: string, title: string): Promise<ActionResult<{ id: string }>> {
  return withCourseGuard(courseId, async () => {
    const actor = await assertPermission("training.create");
    const section = await addSection(actor, courseId, title);
    return { id: section.id };
  });
}

export async function updateSectionAction(courseId: string, sectionId: string, title: string): Promise<ActionResult> {
  return withCourseGuard(courseId, async () => {
    const actor = await assertPermission("training.create");
    await updateSection(actor, sectionId, title);
    return undefined;
  });
}

export async function deleteSectionAction(courseId: string, sectionId: string): Promise<ActionResult> {
  return withCourseGuard(courseId, async () => {
    const actor = await assertPermission("training.create");
    await deleteSection(actor, sectionId);
    return undefined;
  });
}

export async function reorderSectionsAction(courseId: string, orderedIds: string[]): Promise<ActionResult> {
  return withCourseGuard(courseId, async () => {
    const actor = await assertPermission("training.create");
    await reorderSections(actor, courseId, orderedIds);
    return undefined;
  });
}

export async function addLessonAction(
  courseId: string,
  sectionId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return withCourseGuard(courseId, async () => {
    const actor = await assertPermission("training.create");
    const parsed = lessonInputSchema.parse(input);
    const lesson = await addLesson(actor, sectionId, parsed);
    return { id: lesson.id };
  });
}

export async function updateLessonAction(courseId: string, lessonId: string, input: unknown): Promise<ActionResult> {
  return withCourseGuard(courseId, async () => {
    const actor = await assertPermission("training.create");
    await updateLesson(actor, lessonId, input);
    return undefined;
  });
}

export async function deleteLessonAction(courseId: string, lessonId: string): Promise<ActionResult> {
  return withCourseGuard(courseId, async () => {
    const actor = await assertPermission("training.create");
    await deleteLesson(actor, lessonId);
    return undefined;
  });
}

export async function reorderLessonsAction(courseId: string, sectionId: string, orderedIds: string[]): Promise<ActionResult> {
  return withCourseGuard(courseId, async () => {
    const actor = await assertPermission("training.create");
    await reorderLessons(actor, sectionId, orderedIds);
    return undefined;
  });
}

export async function addQuestionAction(
  courseId: string,
  lessonId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return withCourseGuard(courseId, async () => {
    const actor = await assertPermission("training.create");
    const parsed = questionInputSchema.parse(input);
    const question = await addQuestion(actor, lessonId, parsed);
    return { id: question.id };
  });
}

export async function updateQuestionAction(courseId: string, questionId: string, input: unknown): Promise<ActionResult> {
  return withCourseGuard(courseId, async () => {
    const actor = await assertPermission("training.create");
    await updateQuestion(actor, questionId, input);
    return undefined;
  });
}

export async function deleteQuestionAction(courseId: string, questionId: string): Promise<ActionResult> {
  return withCourseGuard(courseId, async () => {
    const actor = await assertPermission("training.create");
    await deleteQuestion(actor, questionId);
    return undefined;
  });
}

export async function reorderQuestionsAction(courseId: string, lessonId: string, orderedIds: string[]): Promise<ActionResult> {
  return withCourseGuard(courseId, async () => {
    const actor = await assertPermission("training.create");
    await reorderQuestions(actor, lessonId, orderedIds);
    return undefined;
  });
}

export async function publishCourseAction(courseId: string, changeSummary: string): Promise<ActionResult> {
  return withCourseGuard(courseId, async () => {
    const actor = await assertPermission("training.publish");
    await publishCourse(actor, courseId, changeSummary);
    return undefined;
  });
}

/** LiveSession/SessionAttendance aren't owned by any of the five services, so this is a direct, permission-guarded write. */
export async function createLiveSessionAction(
  courseId: string,
  lessonId: string,
  input: {
    title: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
    locationText?: string;
    capacity?: number;
  },
): Promise<ActionResult<{ id: string }>> {
  return withCourseGuard(courseId, async () => {
    const actor = await assertPermission("training.create");
    const session = await prisma.liveSession.create({
      data: {
        courseId,
        lessonId,
        title: input.title,
        instructorId: actor.id,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        timezone: input.timezone,
        locationText: input.locationText || null,
        capacity: input.capacity ?? null,
      },
    });
    await updateLesson(actor, lessonId, { content: { liveSessionId: session.id } });
    return { id: session.id };
  });
}

export async function listSopsForPicker(): Promise<{ id: string; code: string; title: string }[]> {
  await assertPermission("training.create");
  const sops = await prisma.sop.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, sopCode: true, title: true },
    orderBy: { sopCode: "asc" },
    take: 500,
  });
  return sops.map((s) => ({ id: s.id, code: s.sopCode, title: s.title }));
}
