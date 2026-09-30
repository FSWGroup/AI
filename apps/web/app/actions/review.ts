"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { approveReview, rejectReview, correctAssertion, commentReview, resolveConflict } from "@wpi/core";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

async function reviewer() {
  const s = await getSession();
  if (!s.canReview || !s.principal.userId) throw new Error("review_knowledge permission required");
  return s.principal.userId;
}

function back(path: string, msg: string) {
  redirect(`${path}?msg=${encodeURIComponent(msg)}`);
}

export async function approveReviewAction(formData: FormData) {
  const userId = await reviewer();
  const id = String(formData.get("reviewId"));
  try { await approveReview(db(), id, userId, String(formData.get("note") ?? "")); } catch (e) { back("/review", `Approve failed: ${(e as Error).message}`); }
  revalidatePath("/review"); back("/review", `Review ${id.slice(0, 8)} approved`);
}

export async function rejectReviewAction(formData: FormData) {
  const userId = await reviewer();
  const id = String(formData.get("reviewId"));
  try { await rejectReview(db(), id, userId, String(formData.get("note") ?? "")); } catch (e) { back("/review", `Reject failed: ${(e as Error).message}`); }
  revalidatePath("/review"); back("/review", `Review ${id.slice(0, 8)} rejected`);
}

export async function correctAssertionAction(formData: FormData) {
  const userId = await reviewer();
  const assertionId = String(formData.get("assertionId"));
  const reviewId = String(formData.get("reviewId") ?? "") || null;
  const raw = String(formData.get("value") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim() || null;
  const justification = String(formData.get("justification") ?? "").trim();
  if (!raw || !justification) back("/review", "Correction needs a value and a justification");
  const isNum = /^-?\d+(\.\d+)?$/.test(raw);
  try { await correctAssertion(db(), { assertionId, userId, valueText: isNum ? null : raw, valueNumber: isNum ? Number(raw) : null, unit, justification, reviewId }); } catch (e) { back("/review", `Correction failed: ${(e as Error).message}`); }
  revalidatePath("/review"); back("/review", `Assertion ${assertionId.slice(0, 8)} corrected (human override recorded)`);
}

export async function commentReviewAction(formData: FormData) {
  const userId = await reviewer();
  const id = String(formData.get("reviewId"));
  const body = String(formData.get("body") ?? "").trim();
  if (!body) back("/review", "Empty comment");
  await commentReview(db(), id, userId, body);
  revalidatePath("/review"); back("/review", "Comment added");
}

export async function resolveConflictAction(formData: FormData) {
  const userId = await reviewer();
  const conflictId = String(formData.get("conflictId"));
  const assertionId = String(formData.get("assertionId"));
  try { await resolveConflict(db(), conflictId, assertionId, userId, String(formData.get("note") ?? "")); } catch (e) { back("/conflicts", `Resolve failed: ${(e as Error).message}`); }
  revalidatePath("/conflicts"); revalidatePath("/review"); back("/conflicts", `Conflict ${conflictId.slice(0, 8)} resolved`);
}
