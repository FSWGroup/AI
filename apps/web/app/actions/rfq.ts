"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { rfqBomAgent } from "@wpi/core";
import { db } from "@/lib/db";
import { getContext, getSession } from "@/lib/session";

/** Parse pasted text and/or an uploaded .csv/.txt into a BOM via rfqBomAgent, then open the RFQ. */
export async function submitRfqAction(formData: FormData) {
  const { ctx, session } = await getContext();
  if (!session.isInternal) redirect("/ask");
  let text = String(formData.get("text") ?? "");
  let sourceKind: "email" | "csv" | "text" = (String(formData.get("kind") ?? "text") as "email" | "text");
  const file = formData.get("file");
  if (file && typeof file === "object" && "arrayBuffer" in file && (file as File).size > 0) {
    const f = file as File;
    if (f.size > 1_000_000) throw new Error("File too large (1 MB max)");
    const body = Buffer.from(await f.arrayBuffer()).toString("utf8");
    text = text.trim() ? `${text}\n${body}` : body;
    if (/\.csv$/i.test(f.name)) sourceKind = "csv";
  }
  text = text.trim();
  if (!text) redirect("/rfq?error=empty");
  const answer = await rfqBomAgent(ctx, { text: text.slice(0, 50_000), sourceKind });
  const rfqId = answer.data?.rfqId as string | undefined;
  redirect(rfqId ? `/rfq/${rfqId}` : "/rfq");
}

export interface SaveBomState { ok?: boolean; message?: string }

/** Persist client-side edits (qty, candidate SKU) to rfq_lines. Unknown SKUs are recorded as unmatched with a question. */
export async function saveBomAction(_prev: SaveBomState, formData: FormData): Promise<SaveBomState> {
  const session = await getSession();
  if (!session.isInternal) return { ok: false, message: "internal users only" };
  const rfqId = String(formData.get("rfqId") ?? "");
  let lines: { id: string; quantity: number | null; candidateSku: string | null }[];
  try { lines = JSON.parse(String(formData.get("lines") ?? "[]")); } catch { return { ok: false, message: "invalid payload" }; }
  const sql = db();
  const [rfq] = await sql`SELECT id FROM rfqs WHERE id = ${rfqId}`;
  if (!rfq) return { ok: false, message: "RFQ not found" };
  let unresolved = 0;
  await sql.begin(async (tx) => {
    for (const l of lines) {
      const sku = l.candidateSku?.trim() || null;
      let variantId: string | null = null;
      if (sku) variantId = (await tx`SELECT id FROM product_variants WHERE upper(canonical_sku) = ${sku.toUpperCase()}`)[0]?.id ?? null;
      if (sku && !variantId) unresolved++;
      const qty = l.quantity == null || !Number.isFinite(Number(l.quantity)) ? null : Number(l.quantity);
      const [old] = await tx`SELECT candidate_variant_id, questions, match_type FROM rfq_lines WHERE id = ${l.id} AND rfq_id = ${rfqId}`;
      if (!old) continue;
      const changedSku = (old.candidateVariantId ?? null) !== variantId;
      const questions = ((old.questions ?? []) as string[]).filter((q) => q !== "Quantity not stated" && !q.startsWith("Edited SKU"));
      if (qty == null) questions.push("Quantity not stated");
      if (sku && !variantId) questions.push(`Edited SKU ${sku} is not a catalog SKU`);
      const confidence = variantId && qty != null ? (changedSku ? "NEEDS_REVIEW" : old.matchType === "none" || old.matchType === "attribute" ? "NEEDS_REVIEW" : "VERIFIED") : variantId ? "NEEDS_REVIEW" : "INSUFFICIENT_EVIDENCE";
      await tx`UPDATE rfq_lines SET quantity = ${qty}, candidate_variant_id = ${variantId}, questions = ${tx.array(questions)}, confidence = ${confidence}, review_required = ${confidence !== "VERIFIED"} WHERE id = ${l.id} AND rfq_id = ${rfqId}`;
    }
    const [agg] = await tx`SELECT bool_or(review_required) AS needs FROM rfq_lines WHERE rfq_id = ${rfqId}`;
    await tx`UPDATE rfqs SET status = ${agg?.needs ? "review" : "verified"} WHERE id = ${rfqId}`;
    if (session.principal.userId) await tx`INSERT INTO audit_events (user_id, action, target_type, target_id, details) VALUES (${session.principal.userId}, 'rfq.edit_bom', 'rfq', ${rfqId}, ${tx.json({ lines: lines.length } as never)})`;
  });
  revalidatePath(`/rfq/${rfqId}`);
  return { ok: true, message: `Saved ${lines.length} line(s)${unresolved ? `; ${unresolved} SKU(s) not in catalog` : ""}.` };
}
