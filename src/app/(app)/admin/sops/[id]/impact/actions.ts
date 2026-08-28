"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/guard";
import { runAction, ok, fail, type ActionResult } from "@/lib/action-result";
import { applyRetrainingDecision, retrainingDecisionSchema, SopValidationError, type RetrainingDecisionResult } from "@/lib/services/sop";

export async function applyRetrainingDecisionAction(sopId: string, input: unknown): Promise<ActionResult<RetrainingDecisionResult>> {
  return runAction("sop.apply_retraining_decision", async () => {
    const actor = await assertPermission("training.assign");
    const parsed = retrainingDecisionSchema.safeParse(input);
    if (!parsed.success) return fail("Please choose a valid option.");

    try {
      const result = await applyRetrainingDecision(actor, sopId, parsed.data);
      revalidatePath(`/admin/sops/${sopId}/impact`);
      return ok(result);
    } catch (error) {
      if (error instanceof SopValidationError) return fail(error.message);
      throw error;
    }
  });
}
