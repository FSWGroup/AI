/**
 * Knowledge Review Center actions. Every decision is audited and every answer correction becomes a regression case.
 */
import { createHash } from "node:crypto";
import type { Sql } from "../db/client.ts";
import { rebuildAttributeProjection } from "../knowledge/projection.ts";
import { detectConflicts } from "../knowledge/conflicts.ts";

export async function listReviews(sql: Sql, opts: { status?: string; type?: string; limit?: number } = {}) {
  return sql`SELECT r.*, u.display_name AS decided_by_name FROM knowledge_reviews r LEFT JOIN users u ON u.id = r.decided_by
    WHERE (${opts.status ?? null}::text IS NULL OR r.status = ${opts.status ?? null}) AND (${opts.type ?? null}::text IS NULL OR r.review_type = ${opts.type ?? null})
    ORDER BY r.priority ASC, r.created_at DESC LIMIT ${opts.limit ?? 100}`;
}

async function audit(sql: Sql, userId: string, action: string, targetType: string, targetId: string, details: unknown) {
  await sql`INSERT INTO audit_events (user_id, action, target_type, target_id, details) VALUES (${userId}, ${action}, ${targetType}, ${targetId}, ${sql.json(details as never)})`;
}

async function requireReviewer(sql: Sql, userId: string) {
  const [u] = await sql`SELECT r.permissions FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ${userId}`;
  if (!u || !(u.permissions as string[]).includes("review_knowledge")) throw new Error("User lacks review_knowledge permission");
}

/** Approve: the review target (assertion or relationship) becomes human_approved. */
export async function approveReview(sql: Sql, reviewId: string, userId: string, note: string) {
  await requireReviewer(sql, userId);
  const [r] = await sql`SELECT * FROM knowledge_reviews WHERE id = ${reviewId} AND status = 'open'`;
  if (!r) throw new Error("Review not open");
  await sql.begin(async (tx) => {
    if (r.targetType === "assertion") await tx`UPDATE knowledge_assertions SET status = 'human_approved', updated_at = now() WHERE id = ${r.targetId}`;
    if (r.targetType === "relationship") await tx`UPDATE product_relationships SET status = 'human_approved' WHERE id = ${r.targetId}`;
    await tx`UPDATE knowledge_reviews SET status = 'approved', decided_by = ${userId}, decision_note = ${note}, decided_at = now() WHERE id = ${reviewId}`;
  });
  await audit(sql, userId, "review.approve", "knowledge_review", reviewId, { note });
  await detectConflicts(sql); await rebuildAttributeProjection(sql);
}

export async function rejectReview(sql: Sql, reviewId: string, userId: string, note: string) {
  await requireReviewer(sql, userId);
  const [r] = await sql`SELECT * FROM knowledge_reviews WHERE id = ${reviewId} AND status = 'open'`;
  if (!r) throw new Error("Review not open");
  await sql.begin(async (tx) => {
    if (r.targetType === "assertion") await tx`UPDATE knowledge_assertions SET status = 'rejected', updated_at = now() WHERE id = ${r.targetId}`;
    if (r.targetType === "relationship") await tx`UPDATE product_relationships SET status = 'rejected' WHERE id = ${r.targetId}`;
    await tx`UPDATE knowledge_reviews SET status = 'rejected', decided_by = ${userId}, decision_note = ${note}, decided_at = now() WHERE id = ${reviewId}`;
  });
  await audit(sql, userId, "review.reject", "knowledge_review", reviewId, { note });
  await rebuildAttributeProjection(sql);
}

/**
 * Correct an assertion: creates a NEW human_approved assertion (source precedence level 1) that supersedes the old one,
 * backed by a human_override source record carrying author/approver/effective date. The old assertion is deprecated.
 */
export async function correctAssertion(sql: Sql, params: { assertionId: string; userId: string; valueText?: string | null; valueNumber?: number | null; unit?: string | null; justification: string; reviewId?: string | null }) {
  await requireReviewer(sql, params.userId);
  const [old] = await sql`SELECT * FROM knowledge_assertions WHERE id = ${params.assertionId}`;
  if (!old) throw new Error("Assertion not found");
  const [u] = await sql`SELECT email, display_name FROM users WHERE id = ${params.userId}`;
  const newId = await sql.begin(async (tx) => {
    let [src] = await tx`SELECT id FROM sources WHERE source_type = 'human_override' LIMIT 1`;
    if (!src) [src] = await tx`INSERT INTO sources (source_type, name, authority_level, is_fixture, notes) VALUES ('human_override', 'Welsford engineering/business overrides', 1, false, 'Human-approved corrections; highest precedence') RETURNING id`;
    const text = `Override by ${u.displayName} (${u.email}): ${old.predicate} = ${params.valueText ?? params.valueNumber}${params.unit ? " " + params.unit : ""}. Justification: ${params.justification}`;
    const [rec] = await tx`INSERT INTO source_records (source_id, record_locator, extracted_text, structured, checksum, source_version, effective_date, last_verified_at)
      VALUES (${src.id}, ${`override:${old.subjectId}:${old.predicate}:${Date.now()}`}, ${text}, ${tx.json({ author: u.email, approver: u.email, justification: params.justification })}, ${createHash("sha256").update(text).digest("hex")}, '1', current_date, now()) RETURNING id`;
    const [a] = await tx`INSERT INTO knowledge_assertions (subject_type, subject_id, predicate, value_text, value_number, unit, status, criticality, effective_date, supersedes_id, created_by)
      VALUES (${old.subjectType}, ${old.subjectId}, ${old.predicate}, ${params.valueText ?? null}, ${params.valueNumber ?? null}, ${params.unit ?? old.unit}, 'human_approved', ${old.criticality}, current_date, ${old.id}, ${params.userId}) RETURNING id`;
    await tx`INSERT INTO assertion_evidence (assertion_id, source_record_id, supporting_text, extraction_method) VALUES (${a.id}, ${rec.id}, ${text}, 'manual')`;
    await tx`UPDATE knowledge_assertions SET status = 'deprecated', updated_at = now() WHERE id = ${old.id}`;
    // any other competing assertions on the same key are deprecated too (override wins by precedence)
    await tx`UPDATE knowledge_assertions SET status = 'deprecated', updated_at = now() WHERE subject_type = ${old.subjectType} AND subject_id = ${old.subjectId} AND predicate = ${old.predicate} AND id <> ${a.id} AND status IN ('verified','pending','conflicting')`;
    await tx`UPDATE knowledge_conflicts SET status = 'resolved', resolved_assertion_id = ${a.id}, resolved_by = ${params.userId}, resolved_at = now() WHERE subject_type = ${old.subjectType} AND subject_id = ${old.subjectId} AND predicate = ${old.predicate} AND status = 'open'`;
    if (params.reviewId) await tx`UPDATE knowledge_reviews SET status = 'corrected', decided_by = ${params.userId}, decision_note = ${params.justification}, decided_at = now() WHERE id = ${params.reviewId}`;
    return a.id as string;
  });
  await audit(sql, params.userId, "assertion.correct", "knowledge_assertion", newId, { supersedes: old.id, justification: params.justification });
  await rebuildAttributeProjection(sql);
  return newId;
}

export async function commentReview(sql: Sql, reviewId: string, userId: string, body: string) {
  await sql`INSERT INTO review_comments (review_id, user_id, body) VALUES (${reviewId}, ${userId}, ${body})`;
}

/**
 * Report an incorrect answer. Captures question, incorrect output, corrected answer and root cause; opens a review and
 * registers a regression evaluation case so future versions cannot silently reintroduce the error.
 */
export async function reportIncorrectAnswer(sql: Sql, params: {
  runId: string; userId: string; incorrectOutput: unknown; correctedAnswer: { outcome?: "answered" | "abstained"; claims?: { subject: string; predicate: string; value: string; severity?: 1 | 2 }[]; forbiddenClaims?: { subject: string; predicate: string; value?: string }[] };
  rootCause: string; category?: string;
}): Promise<{ reviewId: string; caseId: string }> {
  const [run] = await sql`SELECT * FROM agent_runs WHERE id = ${params.runId}`;
  if (!run) throw new Error("Run not found");
  const [review] = await sql`INSERT INTO knowledge_reviews (review_type, target_type, target_id, summary, priority, payload) VALUES ('answer_correction', 'answer', ${params.runId}, ${`Incorrect answer reported for "${run.question}"`}, 1, ${sql.json({ incorrectOutput: params.incorrectOutput, correctedAnswer: params.correctedAnswer, rootCause: params.rootCause } as never)}) RETURNING id`;
  const caseId = `REG-${review.id.slice(0, 8)}`;
  const input = (run.answer as { input?: Record<string, unknown> | null })?.input ?? { question: run.question };
  await sql`INSERT INTO evaluation_cases (id, category, agent, criticality, input, expected, is_regression, origin, dataset_version)
    VALUES (${caseId}, ${params.category ?? "regression"}, ${run.agent === "ask" ? "ask" : run.agent}, ${run.criticality ?? 3}, ${sql.json(input as never)}, ${sql.json(params.correctedAnswer as never)}, true, ${`regression:${review.id}`}, 'regression')`;
  await sql`INSERT INTO regression_cases (evaluation_case_id, review_id, question, incorrect_output, corrected_answer, root_cause) VALUES (${caseId}, ${review.id}, ${run.question}, ${sql.json(params.incorrectOutput as never)}, ${sql.json(params.correctedAnswer as never)}, ${params.rootCause})`;
  await audit(sql, params.userId, "answer.report_incorrect", "agent_run", params.runId, { reviewId: review.id, caseId, rootCause: params.rootCause });
  return { reviewId: review.id, caseId };
}
