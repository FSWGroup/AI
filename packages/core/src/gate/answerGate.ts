/**
 * ANSWER VALIDATION GATE.
 *
 * Input: proposed claims assembled by an agent from retrieved structured knowledge.
 * Output: gated claims (verified / removed with reason), a report, and the answer-level outcome.
 *
 * Checks per claim, in execution order:
 *   0. assumptions pass through labeled as assumptions (never counted as facts)
 *   1. principal/channel permission for the predicate (RBAC at the data layer)
 *   2. calculations: every dependency claim verified (inherits their citations)
 *   3. evidence exists (≥1 source record)
 *   4. assertion status answerable (verified / human_approved) and no open knowledge conflict on (subject, predicate)
 *      relationship status answerable (verified / human_approved)
 *   5. every cited source: authority ≤ threshold for the claim's criticality, source type allowed for the predicate,
 *      document revision current, evidence fresh within the source-type window
 *   6. criticality-5 attribute claims additionally require a human-approved assertion
 *   7. citation validity: supporting text is in the record and (for identity/attribute/commercial claims) contains the value
 * Answer-level: a removed *critical* claim → abstain. Any removal → partial + NEEDS_REVIEW.
 */
import type { Sql } from "../db/client.ts";
import type { Answer, Confidence, GatedClaim, GateReport, Outcome, ProposedClaim } from "../answer/types.ts";
import { ABSTAIN_TEXT } from "../answer/types.ts";
import { citationFor, loadSourceRecords, openConflictPredicates, type SourceRecordInfo } from "../knowledge/evidence.ts";
import { freshnessWindowDays, maxAuthorityForCriticality, sourceTypeAllowedForPredicate, type SourceType } from "../knowledge/authority.ts";
import { valueSupportedByText } from "./textSupport.ts";

export interface GateContext {
  sql: Sql;
  channelId?: "welsford" | "valveman" | null;   // recorded for audit; channel eligibility itself is a rule-engine claim
  now?: Date;
  /** predicates the caller is not permitted to see (RBAC); claims on them are removed_channel */
  restrictedPredicates?: Set<string>;
}

export interface GateResult {
  claims: GatedClaim[];
  report: GateReport;
  outcome: Outcome;
  confidence: Confidence;
}

export async function runAnswerGate(claims: ProposedClaim[], ctx: GateContext): Promise<GateResult> {
  const now = ctx.now ?? new Date();
  const report: GateReport = { proposed: claims.length, verified: 0, removed: 0, removedCritical: 0, checks: [] };
  const allIds = [...new Set(claims.flatMap((c) => c.support.sourceRecordIds))];
  const records = await loadSourceRecords(ctx.sql, allIds);
  const assertionIds = claims.map((c) => c.support.assertionId).filter((x): x is string => !!x);
  const relIds = claims.map((c) => c.support.relationshipId).filter((x): x is string => !!x);
  const assertionStatus = new Map<string, { status: string; subjectId: string; predicate: string }>();
  if (assertionIds.length) for (const r of await ctx.sql`SELECT id, status, subject_id, predicate FROM knowledge_assertions WHERE id = ANY(${assertionIds})`) assertionStatus.set(r.id, { status: r.status, subjectId: r.subjectId, predicate: r.predicate });
  const relStatus = new Map<string, string>();
  if (relIds.length) for (const r of await ctx.sql`SELECT id, status FROM product_relationships WHERE id = ANY(${relIds})`) relStatus.set(r.id, r.status);
  const subjectIds = [...new Set([...assertionStatus.values()].map((a) => a.subjectId))];
  const conflicts = await openConflictPredicates(ctx.sql, subjectIds);

  const gated: GatedClaim[] = [];
  const check = (i: number, name: string, passed: boolean, detail?: string) => { report.checks.push({ claim: i, check: name, passed, detail }); return passed; };

  claims.forEach((c, i) => {
    const out: GatedClaim = { ...c, status: "verified", citations: [] };
    const fail = (status: GatedClaim["status"], reason: string) => { out.status = status; out.reason = reason; };

    if (c.kind === "assumption") { out.status = "assumption"; gated.push(out); return; }

    if (ctx.restrictedPredicates?.has(c.predicate)) { fail("removed_channel", `predicate ${c.predicate} not permitted for this principal/channel`); check(i, "channel_permission", false, c.predicate); gated.push(out); return; }
    check(i, "channel_permission", true);

    if (c.kind === "calculation") {
      const deps = c.support.dependsOn ?? [];
      const depsOk = deps.every((d) => gated[d]?.status === "verified");
      if (!check(i, "dependencies_verified", depsOk, deps.map((d) => `${d}:${gated[d]?.status ?? "missing"}`).join(","))) fail("removed_unsupported", "a dependency of this calculation was not verified");
      else out.citations = deps.flatMap((d) => gated[d].citations);
      gated.push(out); return;
    }

    // 1. evidence exists
    const recs = c.support.sourceRecordIds.map((id) => records.get(id)).filter((r): r is SourceRecordInfo => !!r);
    if (!check(i, "evidence_exists", recs.length > 0)) { fail("removed_unsupported", "no evidence record"); gated.push(out); return; }

    // 2. assertion / relationship status
    if (c.support.assertionId) {
      const st = assertionStatus.get(c.support.assertionId);
      const ok = !!st && (st.status === "verified" || st.status === "human_approved");
      if (!check(i, "assertion_status", ok, st?.status)) { fail(st?.status === "conflicting" ? "removed_conflict" : "removed_unapproved", `assertion status is ${st?.status ?? "missing"}`); gated.push(out); return; }
      if (!check(i, "no_open_conflict", !conflicts.has(`${st!.subjectId}:${st!.predicate}`))) { fail("removed_conflict", "open knowledge conflict on this attribute"); gated.push(out); return; }
    }
    if (c.support.relationshipId) {
      const st = relStatus.get(c.support.relationshipId);
      const ok = st === "verified" || st === "human_approved";
      if (!check(i, "relationship_status", ok, st)) { fail("removed_unapproved", `relationship status is ${st ?? "missing"}`); gated.push(out); return; }
    }

    // 3-5. each source: authority, predicate allowance, current revision, freshness
    const maxAuth = maxAuthorityForCriticality(c.criticality);
    const eligible = recs.filter((r) => {
      const authOk = r.authorityLevel <= maxAuth;
      const typeOk = c.kind === "attribute" ? sourceTypeAllowedForPredicate(c.predicate, r.sourceType as SourceType) : r.sourceType !== "internet";
      const currentOk = r.documentVersionCurrent !== false;
      const windowDays = freshnessWindowDays(r.sourceType as SourceType);
      const verifiedAt = r.lastVerifiedAt ?? null;
      const freshOk = windowDays > 0 && !!verifiedAt && (now.getTime() - verifiedAt.getTime()) <= windowDays * 86400_000;
      check(i, `source_authority:${r.id.slice(0, 8)}`, authOk, `authority ${r.authorityLevel} <= ${maxAuth}`);
      check(i, `source_type_allowed:${r.id.slice(0, 8)}`, typeOk, r.sourceType);
      check(i, `revision_current:${r.id.slice(0, 8)}`, currentOk);
      check(i, `freshness:${r.id.slice(0, 8)}`, freshOk, verifiedAt ? verifiedAt.toISOString() : "never verified");
      return authOk && typeOk && currentOk && freshOk;
    });
    if (!eligible.length) {
      const stale = recs.some((r) => r.documentVersionCurrent === false || !r.lastVerifiedAt);
      fail(stale ? "removed_stale" : "removed_unsupported", "no eligible evidence (authority, source type, revision or freshness)");
      gated.push(out); return;
    }
    // Criticality 5 requires human approval on top of manufacturer documentation
    if (c.criticality >= 5 && c.support.assertionId && assertionStatus.get(c.support.assertionId)?.status !== "human_approved") {
      check(i, "human_approval_required", false); fail("removed_unapproved", "criticality-5 claims require human approval"); gated.push(out); return;
    }

    // 7. citation validity: the supporting text must contain the claimed value
    const supported = eligible.filter((r) => {
      const text = c.support.supportingText ?? r.extractedText ?? "";
      const inRecord = !c.support.supportingText || (r.extractedText ?? "").includes(c.support.supportingText);
      const valueOk = c.kind === "rule" || c.kind === "document" || c.kind === "relationship" ? true : valueSupportedByText(c.value, text);
      check(i, `citation_text_in_record:${r.id.slice(0, 8)}`, inRecord);
      check(i, `value_in_supporting_text:${r.id.slice(0, 8)}`, valueOk, `${c.value} ⊂ "${text.slice(0, 80)}"`);
      return inRecord && valueOk;
    });
    if (!supported.length) { fail("removed_unsupported", "supporting text does not contain the claimed value"); gated.push(out); return; }
    out.citations = supported.map((r) => citationFor(r, c.support.supportingText ?? r.extractedText));
    gated.push(out);
  });

  for (const g of gated) {
    if (g.status === "verified") report.verified++;
    else if (g.status !== "assumption") { report.removed++; if (g.critical) report.removedCritical++; }
  }
  const outcome: Outcome = report.removedCritical > 0 || (report.verified === 0 && claims.length > 0) ? "abstained" : report.removed > 0 ? "partial" : "answered";
  const confidence: Confidence = outcome === "abstained" ? "INSUFFICIENT_EVIDENCE" : outcome === "partial" ? "NEEDS_REVIEW" : "VERIFIED";
  return { claims: gated, report, outcome, confidence };
}

/** Assemble an Answer from a gate result; summary built ONLY from verified claims. */
export function buildAnswer(params: {
  agent: string; question: string; input?: Record<string, unknown>; criticality: number; gate: GateResult; data?: Record<string, unknown>;
  known?: string[]; unknown?: string[]; resolvingSources?: string[]; humanReview?: boolean; llmUsed?: boolean; summaryOverride?: string;
}): Answer {
  const { gate } = params;
  const verified = gate.claims.filter((c) => c.status === "verified");
  const removed = gate.claims.filter((c) => c.status !== "verified" && c.status !== "assumption");
  const known = params.known ?? verified.map((c) => c.label ?? `${c.subjectRef} ${c.predicate} = ${c.value}${c.unit ? " " + c.unit : ""}`);
  const unknown = params.unknown ?? removed.map((c) => `${c.label ?? `${c.subjectRef} ${c.predicate}`} — ${c.reason}`);
  const resolvingSources = params.resolvingSources ?? [...new Set(removed.map((c) => resolvingSourceFor(c)))];
  let summary: string;
  if (gate.outcome === "abstained") summary = `${ABSTAIN_TEXT}${known.length ? ` Verified so far: ${known.join("; ")}.` : ""}${unknown.length ? ` Missing: ${unknown.join("; ")}.` : ""}`;
  else summary = params.summaryOverride ?? known.join(". ") + (removed.length ? `. Not verified: ${unknown.join("; ")}.` : "");
  return {
    agent: params.agent, question: params.question, input: params.input, outcome: gate.outcome, confidence: gate.confidence, criticality: params.criticality,
    claims: gate.claims, summary, known, unknown, resolvingSources,
    humanReviewRecommended: params.humanReview ?? (gate.outcome !== "answered" || params.criticality >= 4),
    gate: gate.report, data: params.data, llmUsed: params.llmUsed ?? false,
  };
}

function resolvingSourceFor(c: GatedClaim): string {
  switch (c.status) {
    case "removed_conflict": return `Resolve the open knowledge conflict on ${c.predicate} in Knowledge Review`;
    case "removed_stale": return `Re-ingest or re-verify the current manufacturer document for ${c.predicate}`;
    case "removed_unapproved": return `Human approval of the pending ${c.predicate} assertion/relationship`;
    case "removed_channel": return `Not available in this channel/role`;
    default: return `Current manufacturer documentation stating ${c.predicate}`;
  }
}
