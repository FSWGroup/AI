"use server";

import { assertPermission } from "@/lib/auth/guard";
import { runAction, ok, fail, fieldErrorsFromZod, type ActionResult } from "@/lib/action-result";
import {
  reportNearMiss,
  reportNearMissInputSchema,
  NearMissValidationError,
} from "@/lib/services/near-miss";

export async function reportNearMissAction(
  input: unknown,
): Promise<ActionResult<{ reference: string; anonymous: boolean }>> {
  return runAction("nearmiss.report", async () => {
    const actor = await assertPermission("nearmiss.report");
    const parsed = reportNearMissInputSchema.safeParse(input);
    if (!parsed.success) {
      return fail("Please fix the highlighted fields.", fieldErrorsFromZod(parsed.error));
    }

    try {
      const created = await reportNearMiss(actor, parsed.data);
      return ok({ reference: created.reference, anonymous: parsed.data.anonymous });
    } catch (error) {
      if (error instanceof NearMissValidationError) return fail(error.message);
      throw error;
    }
  });
}
