"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/guard";
import { ok, fail, runAction, type ActionResult } from "@/lib/action-result";
import { selfEnroll, ServiceError } from "@/lib/services/course";

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
