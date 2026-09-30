"use server";
import { reportIncorrectAnswer } from "@wpi/core";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export interface ReportState { ok?: boolean; message?: string }

/** "Report incorrect answer": opens an answer_correction review and registers a regression case. */
export async function reportIncorrectAction(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const session = await getSession();
  if (!session.canReview || !session.principal.userId) return { ok: false, message: "review_knowledge permission required" };
  const runId = String(formData.get("runId") ?? "");
  const rootCause = String(formData.get("rootCause") ?? "").trim();
  const correctedRaw = String(formData.get("correctedAnswer") ?? "{}");
  if (!runId) return { ok: false, message: "runId missing" };
  if (!rootCause) return { ok: false, message: "Root cause is required" };
  let corrected: { outcome?: "answered" | "abstained"; claims?: { subject: string; predicate: string; value: string; severity?: 1 | 2 }[]; forbiddenClaims?: { subject: string; predicate: string; value?: string }[] };
  try { corrected = JSON.parse(correctedRaw); } catch { return { ok: false, message: "Corrected answer must be valid JSON" }; }
  if (!corrected || typeof corrected !== "object" || Array.isArray(corrected)) return { ok: false, message: "Corrected answer must be a JSON object" };
  const sql = db();
  const [run] = await sql`SELECT answer, gate_report FROM agent_runs WHERE id = ${runId}`;
  if (!run) return { ok: false, message: "Run not found" };
  try {
    const r = await reportIncorrectAnswer(sql, { runId, userId: session.principal.userId, incorrectOutput: { answer: run.answer, gate: run.gateReport }, correctedAnswer: corrected, rootCause });
    return { ok: true, message: `Review ${r.reviewId.slice(0, 8)} opened; regression case ${r.caseId} registered.` };
  } catch (e) {
    return { ok: false, message: String(e instanceof Error ? e.message : e) };
  }
}
