"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/guard";
import { runAction, ok, fail, fieldErrorsFromZod, type ActionResult } from "@/lib/action-result";
import {
  archiveNearMiss,
  checkNearMissNarrative,
  publishNearMiss,
  reopenNearMiss,
  reviewNearMissInputSchema,
  saveNearMissReview,
  NearMissValidationError,
} from "@/lib/services/near-miss";
import type { IdentifierFinding } from "@/lib/services/near-miss-redaction";

export async function saveNearMissReviewAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ findings: IdentifierFinding[] }>> {
  return runAction("nearmiss.save_review", async () => {
    const actor = await assertPermission("nearmiss.review");
    const parsed = reviewNearMissInputSchema.safeParse(input);
    if (!parsed.success) {
      return fail("Please fix the highlighted fields.", fieldErrorsFromZod(parsed.error));
    }

    try {
      const result = await saveNearMissReview(actor, id, parsed.data);
      revalidatePath(`/admin/near-misses/${id}`);
      revalidatePath("/admin/near-misses");
      return ok({ findings: result.findings });
    } catch (error) {
      if (error instanceof NearMissValidationError) return fail(error.message);
      throw error;
    }
  });
}

/**
 * Live check as the reviewer types, so a blocking finding is visible before the
 * publish button is pressed rather than as a rejection afterwards.
 */
export async function checkNearMissNarrativeAction(
  narrative: unknown,
): Promise<ActionResult<{ findings: IdentifierFinding[] }>> {
  return runAction("nearmiss.check_narrative", async () => {
    const actor = await assertPermission("nearmiss.review");
    if (typeof narrative !== "object" || narrative === null) return fail("Nothing to check.");
    const fields = narrative as Record<string, unknown>;
    const text = (key: string): string | null =>
      typeof fields[key] === "string" ? (fields[key] as string) : null;

    const findings = await checkNearMissNarrative(actor, {
      title: text("title"),
      whatHappened: text("whatHappened"),
      howItWasCaught: text("howItWasCaught"),
      whyItHappened: text("whyItHappened"),
      whatChanged: text("whatChanged"),
    });
    return ok({ findings });
  });
}

export async function publishNearMissAction(id: string): Promise<ActionResult> {
  return runAction("nearmiss.publish", async () => {
    const actor = await assertPermission("nearmiss.review");
    try {
      await publishNearMiss(actor, id);
      revalidatePath(`/admin/near-misses/${id}`);
      revalidatePath("/admin/near-misses");
      revalidatePath("/near-misses");
      return ok();
    } catch (error) {
      if (error instanceof NearMissValidationError) return fail(error.message);
      throw error;
    }
  });
}

export async function archiveNearMissAction(
  id: string,
  reason?: string,
): Promise<ActionResult> {
  return runAction("nearmiss.archive", async () => {
    const actor = await assertPermission("nearmiss.review");
    try {
      await archiveNearMiss(actor, id, reason);
      revalidatePath(`/admin/near-misses/${id}`);
      revalidatePath("/admin/near-misses");
      revalidatePath("/near-misses");
      return ok();
    } catch (error) {
      if (error instanceof NearMissValidationError) return fail(error.message);
      throw error;
    }
  });
}

export async function reopenNearMissAction(id: string): Promise<ActionResult> {
  return runAction("nearmiss.reopen", async () => {
    const actor = await assertPermission("nearmiss.review");
    try {
      await reopenNearMiss(actor, id);
      revalidatePath(`/admin/near-misses/${id}`);
      revalidatePath("/admin/near-misses");
      revalidatePath("/near-misses");
      return ok();
    } catch (error) {
      if (error instanceof NearMissValidationError) return fail(error.message);
      throw error;
    }
  });
}
