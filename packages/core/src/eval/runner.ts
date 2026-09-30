/**
 * Evaluation runner. Executes every golden + regression case through the real agents (mode = evaluation), then
 * scores at CLAIM level:
 *   claim precision        = correct verified claims / verified claims returned (on cases with expectations)
 *   critical precision     = same, restricted to criticality >= 4 claims and severity-1 expectations
 *   unsupported claim rate = verified claims whose citation text does not contain the value / all verified claims
 *   citation validity      = verified claims with ≥1 citation whose supporting text is in the cited record and contains the value
 *   abstention quality     = expected-abstain cases that abstained / expected-abstain cases
 *   false answer rate      = expected-abstain cases that answered / expected-abstain cases
 *   category metrics       = per category outcome accuracy
 * A verified claim is scored CORRECT if it matches an expected claim, or if it is not covered by expectations but is
 * consistent with the knowledge base (re-verified against product_attributes / evidence text) — "unexpected" claims are
 * scored INCORRECT if they contradict an expected claim on the same subject+predicate or hit a forbidden claim.
 */
import type { Sql } from "../db/client.ts";
import { makeContext, type AgentContext } from "../agents/context.ts";
import { NullProvider } from "../llm/provider.ts";
import { loadPrincipalByEmail, PUBLIC_PRINCIPAL } from "../auth/rbac.ts";
import type { Answer, GatedClaim } from "../answer/types.ts";
import { partLookupAgent } from "../agents/partLookup.ts";
import { productSpecsAgent } from "../agents/productSpecs.ts";
import { productFinderAgent } from "../agents/productFinder.ts";
import { crossReferenceAgent } from "../agents/crossReference.ts";
import { eligibilityAgent } from "../agents/eligibility.ts";
import { inventoryAgent, pricingAgent } from "../agents/commercial.ts";
import { documentFinderAgent } from "../agents/documentFinder.ts";
import { assemblyAgent } from "../agents/assembly.ts";
import { rfqBomAgent } from "../agents/rfqBom.ts";
import { askAgent } from "../agents/ask.ts";
import { valueSupportedByText } from "../gate/textSupport.ts";
import type { GoldenCase } from "./dataset.ts";

export interface ClaimScore { subject: string; predicate: string; value: string; criticality: number; correct: boolean; reason: string; expected: boolean; citationValid: boolean }
export interface CaseResult { id: string; category: string; agent: string; criticality: number; outcome: string; expectedOutcome: string | null; outcomePass: boolean; claims: ClaimScore[]; missingExpected: { subject: string; predicate: string; value: string }[]; forbiddenHit: { subject: string; predicate: string; value?: string }[]; dataPass: boolean; dataFailures: string[]; pass: boolean; severity1Failures: string[]; latencyMs: number; error?: string }
export interface EvalMetrics {
  cases: number; passed: number; failed: number; caseAccuracy: number;
  claimsTotal: number; claimsCorrect: number; claimsIncorrect: number; claimPrecision: number;
  criticalClaimsTotal: number; criticalClaimsIncorrect: number; criticalClaimPrecision: number;
  citationValidity: number; unsupportedClaimRate: number;
  expectedAbstain: number; abstainedCorrectly: number; abstentionQuality: number; falseAnswerRate: number;
  abstentionRate: number; answerRate: number;
  severity1Errors: number; regressionCases: number; regressionPassed: number;
  byCategory: Record<string, { cases: number; passed: number; claims: number; claimsCorrect: number }>;
  partLookupExact: { cases: number; passed: number };
}
export interface EvalRunResult { runId: string; datasetVersion: string; metrics: EvalMetrics; gate: { passed: boolean; reasons: string[] }; results: CaseResult[] }

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const numEq = (a: string, b: string) => /^-?\d+(\.\d+)?$/.test(a) && /^-?\d+(\.\d+)?$/.test(b) && Math.abs(Number(a) - Number(b)) < 1e-6;
const valEq = (a: string, b: string) => norm(a) === norm(b) || numEq(a, b);

async function dispatch(ctx: AgentContext, c: GoldenCase): Promise<Answer> {
  const i = c.input as Record<string, any>;
  switch (c.agent) {
    case "part_lookup": return partLookupAgent(ctx, i.query, { manufacturer: i.manufacturer ?? null });
    case "product_specs": return productSpecsAgent(ctx, { partNumber: i.partNumber, predicates: i.predicates, question: i.question });
    case "product_finder": return productFinderAgent(ctx, { text: i.text, channel: i.channel, state: i.state });
    case "cross_reference": return crossReferenceAgent(ctx, { partNumber: i.partNumber, manufacturer: i.manufacturer ?? null });
    case "eligibility": return eligibilityAgent(ctx, { partNumber: i.partNumber, channel: i.channel, state: i.state, customerClass: i.customerClass });
    case "pricing": return pricingAgent(ctx, { partNumber: i.partNumber, channel: i.channel, customerP21Id: i.customerP21Id ?? null });
    case "inventory": return inventoryAgent(ctx, { partNumber: i.partNumber });
    case "document_finder": return documentFinderAgent(ctx, { query: i.query, partNumber: i.partNumber, documentType: i.documentType });
    case "assembly": return assemblyAgent(ctx, { valvePartNumber: i.valvePartNumber, actuation: i.actuation, supplyPressurePsi: i.supplyPressurePsi, safetyFactor: i.safetyFactor, solenoidVoltage: i.solenoidVoltage, includeLimitSwitch: i.includeLimitSwitch });
    case "rfq_bom": return rfqBomAgent(ctx, { text: i.text, sourceKind: i.sourceKind });
    case "ask": return askAgent(ctx, i.question, { customerP21Id: i.customerP21Id ?? null });
    default: throw new Error(`Unknown agent ${c.agent}`);
  }
}

/** Independent re-verification of a verified claim against the knowledge base, used for claims not covered by expectations. */
async function reverify(sql: Sql, claim: GatedClaim): Promise<{ ok: boolean; reason: string }> {
  if (claim.kind === "attribute" && claim.support.assertionId) {
    const [row] = await sql`SELECT pa.value_text, pa.value_number FROM product_attributes pa WHERE pa.assertion_id = ${claim.support.assertionId}`;
    if (!row) return { ok: false, reason: "assertion not in verified projection" };
    const v = row.valueNumber != null ? String(Number(row.valueNumber)) : String(row.valueText);
    return valEq(v, claim.value) ? { ok: true, reason: "matches verified projection" } : { ok: false, reason: `projection value ${v} ≠ ${claim.value}` };
  }
  return { ok: true, reason: "structural claim with gated evidence" };
}

function getPath(obj: unknown, path: string): unknown { return path.split(".").reduce<any>((o, k) => (o == null ? undefined : Array.isArray(o) && /^\d+$/.test(k) ? o[Number(k)] : o[k]), obj); }

export async function runEvaluation(sql: Sql, opts: { datasetVersion?: string; onlyIds?: string[]; codeVersion?: string } = {}): Promise<EvalRunResult> {
  const cases = (await sql`SELECT * FROM evaluation_cases ${opts.onlyIds ? sql`WHERE id = ANY(${opts.onlyIds})` : sql``} ORDER BY is_regression, id`) as unknown as (GoldenCase & { datasetVersion: string; isRegression: boolean })[];
  const datasetVersion = opts.datasetVersion ?? [...new Set(cases.map((c) => c.datasetVersion))].sort().pop() ?? "0";
  const [run] = await sql`INSERT INTO evaluation_runs (dataset_version, code_version, llm_model) VALUES (${datasetVersion}, ${opts.codeVersion ?? null}, 'none') RETURNING id`;
  const principals = new Map<string, Awaited<ReturnType<typeof loadPrincipalByEmail>>>();
  const results: CaseResult[] = [];
  const citationTextCache = new Map<string, string | null>();
  for (const c of cases) {
    const i = c.input as Record<string, any>;
    const email = i.principalEmail as string | undefined;
    if (email && !principals.has(email)) principals.set(email, await loadPrincipalByEmail(sql, email));
    const ctx = makeContext(sql, { principal: (email ? principals.get(email) : null) ?? PUBLIC_PRINCIPAL, channelId: i.channel ?? "welsford", state: i.state ?? null, customerClass: i.customerClass ?? null, mode: "evaluation", llm: new NullProvider() });
    const t0 = Date.now();
    let answer: Answer;
    try { answer = await dispatch(ctx, c); }
    catch (e) { results.push({ id: c.id, category: c.category, agent: c.agent, criticality: c.criticality, outcome: "error", expectedOutcome: c.expected.outcome ?? null, outcomePass: false, claims: [], missingExpected: c.expected.claims ?? [], forbiddenHit: [], dataPass: false, dataFailures: [String(e)], pass: false, severity1Failures: [`error: ${String(e)}`], latencyMs: Date.now() - t0, error: String(e) }); continue; }
    const verified = answer.claims.filter((cl) => cl.status === "verified");
    const expClaims = c.expected.claims ?? [];
    const claims: ClaimScore[] = [];
    const sev1: string[] = [];
    for (const cl of verified) {
      let citationValid = false;
      for (const cit of cl.citations) {
        let text = citationTextCache.get(cit.sourceRecordId);
        if (text === undefined) { text = ((await sql`SELECT extracted_text FROM source_records WHERE id = ${cit.sourceRecordId}`)[0]?.extractedText as string | undefined) ?? null; citationTextCache.set(cit.sourceRecordId, text); }
        const inRecord = !!text && (!cit.supportingText || text.includes(cit.supportingText));
        const supports = cl.kind === "rule" || cl.kind === "document" || cl.kind === "relationship" || cl.kind === "calculation" ? inRecord || cl.kind === "calculation" : inRecord && valueSupportedByText(cl.value, cit.supportingText ?? text ?? "");
        if (supports) { citationValid = true; break; }
      }
      const exp = expClaims.find((e) => norm(e.subject) === norm(cl.subjectRef) && norm(e.predicate) === norm(cl.predicate));
      const forbidden = (c.expected.forbiddenClaims ?? []).find((f) => norm(f.subject) === norm(cl.subjectRef) && norm(f.predicate) === norm(cl.predicate) && (f.value == null || valEq(f.value, cl.value)));
      let correct: boolean; let reason: string;
      if (forbidden) { correct = false; reason = "forbidden claim returned as verified"; }
      else if (exp) { correct = valEq(exp.value, cl.value); reason = correct ? "matches expected" : `expected ${exp.value}, got ${cl.value}`; }
      else { const rv = await reverify(sql, cl); correct = rv.ok && citationValid; reason = !citationValid ? "citation does not support value" : rv.reason; }
      if (!correct && (cl.criticality >= 4 || exp?.severity === 1 || forbidden)) sev1.push(`${cl.subjectRef} ${cl.predicate}=${cl.value}: ${reason}`);
      claims.push({ subject: cl.subjectRef, predicate: cl.predicate, value: cl.value, criticality: cl.criticality, correct, reason, expected: !!exp, citationValid });
    }
    const missingExpected = expClaims.filter((e) => !verified.some((cl) => norm(e.subject) === norm(cl.subjectRef) && norm(e.predicate) === norm(cl.predicate) && valEq(e.value, cl.value)));
    const forbiddenHit = (c.expected.forbiddenClaims ?? []).filter((f) => verified.some((cl) => norm(f.subject) === norm(cl.subjectRef) && norm(f.predicate) === norm(cl.predicate) && (f.value == null || valEq(f.value, cl.value))));
    const expectedOutcome = c.expected.outcome ?? null;
    const outcomePass = expectedOutcome ? answer.outcome === expectedOutcome : true;
    if (expectedOutcome === "abstained" && answer.outcome !== "abstained") sev1.push(`answered when abstention was required (${answer.outcome})`);
    const dataFailures: string[] = [];
    for (const [path, want] of Object.entries(c.expected.data ?? {})) {
      const got = getPath(answer.data, path);
      const ok = typeof want === "object" && want !== null && !Array.isArray(want) && "includes" in (want as object) ? Array.isArray(got) && (want as { includes: unknown[] }).includes.every((w) => (got as unknown[]).some((g) => JSON.stringify(g).includes(JSON.stringify(w).replace(/^"|"$/g, "")))) : JSON.stringify(got ?? null) === JSON.stringify(want);
      if (!ok) dataFailures.push(`${path}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
    if (c.expected.maxClaims != null && verified.length > c.expected.maxClaims) dataFailures.push(`returned ${verified.length} verified claims, max ${c.expected.maxClaims}`);
    const pass = outcomePass && missingExpected.length === 0 && forbiddenHit.length === 0 && dataFailures.length === 0 && claims.every((cl) => cl.correct);
    results.push({ id: c.id, category: c.category, agent: c.agent, criticality: c.criticality, outcome: answer.outcome, expectedOutcome, outcomePass, claims, missingExpected, forbiddenHit, dataPass: dataFailures.length === 0, dataFailures, pass, severity1Failures: sev1, latencyMs: Date.now() - t0 });
  }
  const metrics = computeMetrics(results, cases);
  const gate = releaseGate(metrics);
  await sql`UPDATE evaluation_runs SET finished_at = now(), metrics = ${sql.json(metrics as never)}, passed_gate = ${gate.passed}, results = ${sql.json(results as never)} WHERE id = ${run.id}`;
  return { runId: run.id, datasetVersion, metrics, gate, results };
}

export function computeMetrics(results: CaseResult[], cases: { id: string; isRegression?: boolean; expected: GoldenCase["expected"]; category: string; agent: string }[]): EvalMetrics {
  const all = results.flatMap((r) => r.claims);
  const critical = all.filter((c) => c.criticality >= 4);
  const expectedAbstain = results.filter((r) => r.expectedOutcome === "abstained");
  const abstained = results.filter((r) => r.outcome === "abstained");
  const byCategory: EvalMetrics["byCategory"] = {};
  for (const r of results) { const b = (byCategory[r.category] ??= { cases: 0, passed: 0, claims: 0, claimsCorrect: 0 }); b.cases++; if (r.pass) b.passed++; b.claims += r.claims.length; b.claimsCorrect += r.claims.filter((c) => c.correct).length; }
  const regressionIds = new Set(cases.filter((c) => c.isRegression).map((c) => c.id));
  const regression = results.filter((r) => regressionIds.has(r.id));
  const pl = results.filter((r) => r.category === "exact_part_lookup");
  const pct = (n: number, d: number) => (d === 0 ? 1 : n / d);   // precision-style: vacuously 1
  const rate = (n: number, d: number) => (d === 0 ? 0 : n / d);  // error-rate-style: vacuously 0
  return {
    cases: results.length, passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length, caseAccuracy: pct(results.filter((r) => r.pass).length, results.length),
    claimsTotal: all.length, claimsCorrect: all.filter((c) => c.correct).length, claimsIncorrect: all.filter((c) => !c.correct).length, claimPrecision: pct(all.filter((c) => c.correct).length, all.length),
    criticalClaimsTotal: critical.length, criticalClaimsIncorrect: critical.filter((c) => !c.correct).length, criticalClaimPrecision: pct(critical.filter((c) => c.correct).length, critical.length),
    citationValidity: pct(all.filter((c) => c.citationValid).length, all.length), unsupportedClaimRate: rate(all.filter((c) => !c.citationValid).length, all.length),
    expectedAbstain: expectedAbstain.length, abstainedCorrectly: expectedAbstain.filter((r) => r.outcome === "abstained").length, abstentionQuality: pct(expectedAbstain.filter((r) => r.outcome === "abstained").length, expectedAbstain.length), falseAnswerRate: rate(expectedAbstain.filter((r) => r.outcome !== "abstained").length, expectedAbstain.length),
    abstentionRate: rate(abstained.length, results.length), answerRate: rate(results.filter((r) => r.outcome === "answered" || r.outcome === "partial").length, results.length),
    severity1Errors: results.reduce((n, r) => n + r.severity1Failures.length, 0), regressionCases: regression.length, regressionPassed: regression.filter((r) => r.pass).length,
    byCategory, partLookupExact: { cases: pl.length, passed: pl.filter((r) => r.pass).length },
  };
}

/** Release gates (docs/release-gates.md). */
export function releaseGate(m: EvalMetrics): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (m.claimPrecision < 0.999) reasons.push(`claim precision ${(m.claimPrecision * 100).toFixed(3)}% < 99.9%`);
  if (m.criticalClaimPrecision < 1) reasons.push(`critical-claim precision ${(m.criticalClaimPrecision * 100).toFixed(3)}% < 100%`);
  if (m.severity1Errors > 0) reasons.push(`${m.severity1Errors} severity-1 error(s)`);
  if (m.citationValidity < 0.999) reasons.push(`citation validity ${(m.citationValidity * 100).toFixed(3)}% < 99.9%`);
  if (m.unsupportedClaimRate > 0.001) reasons.push(`unsupported claim rate ${(m.unsupportedClaimRate * 100).toFixed(3)}% > 0.1%`);
  if (m.regressionPassed < m.regressionCases) reasons.push(`${m.regressionCases - m.regressionPassed} regression case(s) failing`);
  if (m.partLookupExact.passed < m.partLookupExact.cases) reasons.push(`exact part lookup ${m.partLookupExact.passed}/${m.partLookupExact.cases} < 100%`);
  if (m.abstentionQuality < 1) reasons.push(`abstention quality ${(m.abstentionQuality * 100).toFixed(1)}% < 100%`);
  for (const cat of ["pricing", "inventory", "territory_eligibility"]) { const b = m.byCategory[cat]; if (b && b.passed < b.cases) reasons.push(`${cat}: ${b.passed}/${b.cases} cases pass (target 100%)`); }
  return { passed: reasons.length === 0, reasons };
}
