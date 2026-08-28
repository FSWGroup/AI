"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/guard";
import { ok, fail, runAction, type ActionResult } from "@/lib/action-result";
import { selfEnroll, ServiceError } from "@/lib/services/course";

/**
 * Self-enrolment, deliberately NOT defined inside a route directory.
 *
 * `SelfEnrollButton` renders on both `/catalog` and `/courses/[id]`. This action
 * previously lived in `app/(app)/courses/[id]/actions.ts`, which made the
 * catalog depend on a module private to a route it merely links to. A server
 * action shared by more than one route belongs in `src/lib/actions/`, so that
 * neither route owns it and either can be moved or removed independently.
 */
export async function selfEnrollAction(courseId: string): Promise<ActionResult> {
  return runAction("course.selfEnroll", async () => {
    const actor = await assertPermission("training.view");
    try {
      await selfEnroll(actor, courseId);
    } catch (error) {
      if (error instanceof ServiceError) return fail(error.message);
      throw error;
    }
    revalidatePath(`/courses/${courseId}`);
    revalidatePath("/catalog");
    return ok();
  });
}
