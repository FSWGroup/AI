"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth/guard";
import { runAction, ok, fail, fieldErrorsFromZod, type ActionResult } from "@/lib/action-result";
import {
  updateSopDraft,
  updateSopDraftInputSchema,
  publishSop,
  publishSopInputSchema,
  submitForReview,
  approveSop,
  requestChanges,
  restoreSopVersion,
  resolveOutdatedReport,
  SopValidationError,
} from "@/lib/services/sop";

function isValidationError(error: unknown): error is SopValidationError {
  return error instanceof SopValidationError;
}

export async function updateSopDraftAction(sopId: string, input: unknown): Promise<ActionResult> {
  return runAction("sop.update_draft", async () => {
    const actor = await assertPermission("sop.create");
    const parsed = updateSopDraftInputSchema.safeParse(input);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFromZod(parsed.error));

    try {
      await updateSopDraft(actor, sopId, parsed.data);
    } catch (error) {
      if (isValidationError(error)) return fail(error.message);
      throw error;
    }

    revalidatePath(`/admin/sops/${sopId}/edit`);
    revalidatePath(`/sops/${sopId}`);
    revalidatePath("/admin/sops");
    return ok();
  });
}

export async function publishSopAction(sopId: string, input: unknown): Promise<ActionResult<{ versionNumber: string }>> {
  return runAction("sop.publish", async () => {
    const actor = await assertPermission("sop.publish");
    const parsed = publishSopInputSchema.safeParse(input);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFromZod(parsed.error));

    try {
      const version = await publishSop(actor, sopId, parsed.data);
      revalidatePath(`/admin/sops/${sopId}/edit`);
      revalidatePath(`/sops/${sopId}`);
      revalidatePath(`/sops/${sopId}/versions`);
      revalidatePath("/admin/sops");
      revalidatePath("/sops");
      return ok({ versionNumber: version.versionNumber });
    } catch (error) {
      if (isValidationError(error)) return fail(error.message);
      throw error;
    }
  });
}

const submitSchema = z.object({ assignedToId: z.string().optional(), stage: z.string().optional(), comment: z.string().optional() });

export async function submitForReviewAction(sopId: string, input: unknown): Promise<ActionResult> {
  return runAction("sop.submit_for_review", async () => {
    const actor = await assertPermission("sop.create");
    const parsed = submitSchema.safeParse(input);
    if (!parsed.success) return fail("Please try again.");

    try {
      await submitForReview(actor, sopId, parsed.data);
    } catch (error) {
      if (isValidationError(error)) return fail(error.message);
      throw error;
    }

    revalidatePath(`/admin/sops/${sopId}/edit`);
    revalidatePath("/admin/sops");
    return ok();
  });
}

const decisionSchema = z.object({ approvalRequestId: z.string().optional(), comment: z.string().optional() });

export async function approveSopAction(sopId: string, input: unknown): Promise<ActionResult> {
  return runAction("sop.approve", async () => {
    const actor = await assertPermission("sop.approve");
    const parsed = decisionSchema.safeParse(input);
    if (!parsed.success) return fail("Please try again.");

    try {
      await approveSop(actor, sopId, parsed.data);
    } catch (error) {
      if (isValidationError(error)) return fail(error.message);
      throw error;
    }

    revalidatePath(`/admin/sops/${sopId}/edit`);
    revalidatePath("/admin/sops");
    return ok();
  });
}

const requestChangesSchema = z.object({ approvalRequestId: z.string().optional(), comment: z.string().trim().min(3, "Explain what needs to change.") });

export async function requestChangesAction(sopId: string, input: unknown): Promise<ActionResult> {
  return runAction("sop.request_changes", async () => {
    const actor = await assertPermission("content.review");
    const parsed = requestChangesSchema.safeParse(input);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFromZod(parsed.error));

    try {
      await requestChanges(actor, sopId, parsed.data);
    } catch (error) {
      if (isValidationError(error)) return fail(error.message);
      throw error;
    }

    revalidatePath(`/admin/sops/${sopId}/edit`);
    revalidatePath("/admin/sops");
    return ok();
  });
}

export async function restoreSopVersionAction(sopId: string, versionId: string): Promise<ActionResult> {
  return runAction("sop.restore_version", async () => {
    const actor = await assertPermission("sop.create");
    try {
      await restoreSopVersion(actor, sopId, versionId);
    } catch (error) {
      if (isValidationError(error)) return fail(error.message);
      throw error;
    }
    revalidatePath(`/admin/sops/${sopId}/edit`);
    return ok();
  });
}

export async function resolveOutdatedReportAction(sopId: string, reportId: string, status: "RESOLVED" | "DISMISSED"): Promise<ActionResult> {
  return runAction("sop.resolve_outdated_report", async () => {
    const actor = await assertPermission("sop.create");
    try {
      await resolveOutdatedReport(actor, reportId, status);
    } catch (error) {
      if (isValidationError(error)) return fail(error.message);
      throw error;
    }
    revalidatePath(`/admin/sops/${sopId}/edit`);
    revalidatePath("/admin/sops/review");
    return ok();
  });
}
