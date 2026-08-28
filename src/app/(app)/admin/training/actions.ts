"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertPermission } from "@/lib/auth/guard";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { ok, fail, runAction, fieldErrorsFromZod, type ActionResult } from "@/lib/action-result";
import {
  createCourse,
  archiveCourse,
  deleteCourse,
  duplicateCourse,
  courseInputSchema,
  ServiceError,
} from "@/lib/services/course";
import { z } from "zod";

export async function createCourseAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction("training.createCourse", async () => {
    const actor = await assertPermission("training.create");
    const parsed = courseInputSchema.pick({ title: true, description: true, category: true, difficulty: true, estimatedMinutes: true }).safeParse({
      title: formData.get("title"),
      description: formData.get("description") || undefined,
      category: formData.get("category") || undefined,
      difficulty: formData.get("difficulty") || undefined,
      estimatedMinutes: formData.get("estimatedMinutes") ? Number(formData.get("estimatedMinutes")) : undefined,
    });
    if (!parsed.success) return fail("Check the fields below.", fieldErrorsFromZod(parsed.error));

    const course = await createCourse(actor, parsed.data);
    revalidatePath("/admin/training");
    return ok({ id: course.id });
  });
}

export async function archiveCourseAction(courseId: string): Promise<ActionResult> {
  return runAction("training.archiveCourse", async () => {
    const actor = await assertPermission("training.archive");
    await archiveCourse(actor, courseId);
    revalidatePath("/admin/training");
    return ok();
  });
}

export async function deleteCourseAction(courseId: string): Promise<ActionResult> {
  return runAction("training.deleteCourse", async () => {
    const actor = await assertPermission("training.archive");
    try {
      await deleteCourse(actor, courseId);
    } catch (error) {
      if (error instanceof ServiceError) return fail(error.message);
      throw error;
    }
    revalidatePath("/admin/training");
    return ok();
  });
}

export async function duplicateCourseAction(courseId: string): Promise<ActionResult<{ id: string }>> {
  return runAction("training.duplicateCourse", async () => {
    const actor = await assertPermission("training.create");
    const copy = await duplicateCourse(actor, courseId);
    revalidatePath("/admin/training");
    return ok({ id: copy.id });
  });
}

const importRowSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  difficulty: z.enum(["INTRO", "BEGINNER", "INTERMEDIATE", "ADVANCED"]).optional(),
  estimatedMinutes: z.number().int().min(0).optional(),
});

/** Minimal CSV import: header row `title,description,category,difficulty,estimatedMinutes`. */
export async function importCoursesAction(csvText: string): Promise<ActionResult<{ imported: number; failed: number }>> {
  return runAction("training.importCourses", async () => {
    const actor = await assertPermission("training.create");
    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) return fail("Add a header row plus at least one course row.");

    const header = (lines[0] ?? "").split(",").map((h) => h.trim().toLowerCase());
    let imported = 0;
    let failed = 0;

    for (const line of lines.slice(1)) {
      const cells = line.split(",").map((c) => c.trim());
      const row: Record<string, string> = {};
      header.forEach((key, i) => {
        row[key] = cells[i] ?? "";
      });

      const parsed = importRowSchema.safeParse({
        title: row.title,
        description: row.description || undefined,
        category: row.category || undefined,
        difficulty: row.difficulty ? (row.difficulty.toUpperCase() as never) : undefined,
        estimatedMinutes: row.estimatedminutes ? Number(row.estimatedminutes) : undefined,
      });
      if (!parsed.success) {
        failed += 1;
        continue;
      }
      try {
        await createCourse(actor, parsed.data);
        imported += 1;
      } catch {
        failed += 1;
      }
    }

    await recordAudit({
      actorId: actor.id,
      action: AUDIT_ACTIONS.COURSE_CREATED,
      entityType: "COURSE",
      metadata: { bulkImport: true, imported, failed },
    });

    revalidatePath("/admin/training");
    return ok({ imported, failed });
  });
}

export async function createCourseAndRedirect(formData: FormData): Promise<void> {
  const result = await createCourseAction(formData);
  if (result.ok) redirect(`/admin/training/${result.data.id}/edit`);
}
