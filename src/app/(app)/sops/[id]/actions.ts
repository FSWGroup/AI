"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth/guard";
import { runAction, ok, fail, fieldErrorsFromZod, type ActionResult } from "@/lib/action-result";
import { reportOutdated, submitContentFeedback, feedbackTypeSchema, SopValidationError } from "@/lib/services/sop";

const reportSchema = z.object({
  sopId: z.string().min(1),
  reason: z.string().trim().min(5, "Give a few more details so the owner knows what to check."),
});

export async function reportOutdatedAction(input: unknown): Promise<ActionResult> {
  return runAction("sop.report_outdated", async () => {
    const actor = await assertPermission("sop.view");
    const parsed = reportSchema.safeParse(input);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFromZod(parsed.error));

    try {
      await reportOutdated(actor, parsed.data.sopId, parsed.data.reason);
    } catch (error) {
      if (error instanceof SopValidationError) return fail(error.message);
      throw error;
    }

    revalidatePath(`/sops/${parsed.data.sopId}`);
    return ok();
  });
}

const feedbackSchema = z.object({
  sopId: z.string().min(1),
  type: feedbackTypeSchema,
  comment: z.string().trim().max(1000).optional(),
});

export async function submitFeedbackAction(input: unknown): Promise<ActionResult> {
  return runAction("sop.submit_feedback", async () => {
    const actor = await assertPermission("sop.view");
    const parsed = feedbackSchema.safeParse(input);
    if (!parsed.success) return fail("Please try again.", fieldErrorsFromZod(parsed.error));

    await submitContentFeedback(actor, parsed.data.sopId, parsed.data.type, parsed.data.comment);
    revalidatePath(`/sops/${parsed.data.sopId}`);
    return ok();
  });
}
