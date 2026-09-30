import type { AgentContext } from "./context.ts";
import { gate, buildAnswer, recordRun, trace, channelDenied } from "./context.ts";
import type { Answer, ProposedClaim } from "../answer/types.ts";
import { decideEligibility, type EligibilityDecision } from "../rules/channelEngine.ts";
import { identityClaims, resolveVariant } from "./partLookup.ts";
import type { PartMatch } from "../retrieval/partLookup.ts";

export function eligibilityClaims(d: EligibilityDecision, sku: string, channel: string, state?: string | null): ProposedClaim[] {
  if (d.authorized === null) return [];
  const recs = d.appliedRules.map((r) => r.sourceRecordId).filter((x): x is string => !!x);
  const where = state ? ` in ${state.toUpperCase()}` : "";
  const claims: ProposedClaim[] = [{ subjectRef: `rule:${channel}:${sku}`, predicate: `eligibility:${channel}`, value: d.authorized ? "authorized" : "not_authorized", criticality: 2, kind: "rule", critical: true,
    support: { sourceRecordIds: recs }, label: `${channel === "welsford" ? "Welsford" : "ValveMan"} ${d.authorized ? "is" : "is NOT"} authorized to sell ${sku}${where}` }];
  if (d.authorized) {
    if (d.rfqOnly) claims.push({ subjectRef: `rule:${channel}:${sku}`, predicate: `rfq_only:${channel}`, value: "true", criticality: 2, kind: "rule", support: { sourceRecordIds: recs }, label: `${sku} requires manual quotation (RFQ only) in ${channel}` });
    if (d.ecommerce) claims.push({ subjectRef: `rule:${channel}:${sku}`, predicate: `ecommerce:${channel}`, value: "true", criticality: 2, kind: "rule", support: { sourceRecordIds: recs }, label: `${sku} is eligible for ecommerce sale on ValveMan` });
    if (d.pricingLoginRequired) claims.push({ subjectRef: `rule:${channel}:${sku}`, predicate: `pricing_login_required:${channel}`, value: "true", criticality: 2, kind: "rule", support: { sourceRecordIds: recs }, label: `${sku} pricing requires customer login on ValveMan` });
    else if (d.pricingVisible) claims.push({ subjectRef: `rule:${channel}:${sku}`, predicate: `pricing_visible:${channel}`, value: "true", criticality: 2, kind: "rule", support: { sourceRecordIds: recs }, label: `${sku} pricing may be shown publicly on ValveMan` });
    if (d.requiresApproval) claims.push({ subjectRef: `rule:${channel}:${sku}`, predicate: `requires_approval:${channel}`, value: "true", criticality: 2, kind: "rule", support: { sourceRecordIds: recs }, label: `${sku} requires manager approval for this customer class` });
  }
  return claims;
}

export async function eligibilityAgent(ctx: AgentContext, params: { partNumber: string; channel?: "welsford" | "valveman"; state?: string | null; customerClass?: string | null; match?: PartMatch | null }): Promise<Answer> {
  const t0 = Date.now();
  const channel = params.channel ?? ctx.channelId;
  const state = params.state ?? ctx.state ?? null;
  const question = `Can ${channel === "welsford" ? "Welsford" : "ValveMan"} sell ${params.partNumber}${state ? ` to a customer in ${state}` : ""}?`;
  const denied = await channelDenied(ctx, "eligibility", question, channel); if (denied) return denied;
  const match = params.match ?? await resolveVariant(ctx, params.partNumber);
  if (!match) {
    const g = await gate(ctx, []); g.outcome = "abstained"; g.confidence = "INSUFFICIENT_EVIDENCE";
    const answer = buildAnswer({ agent: "eligibility", question, input: { partNumber: params.partNumber, channel, state, customerClass: params.customerClass ?? null }, criticality: 2, gate: g, unknown: [`"${params.partNumber}" does not resolve to a verified catalog item`], humanReview: true });
    await recordRun(ctx, answer, Date.now() - t0); return answer;
  }
  const decision = await trace(ctx, "rule_engine", { channel, state, sku: match.canonicalSku }, () => decideEligibility(ctx.sql, { variantId: match.variantId, channelId: channel, state, customerClass: params.customerClass ?? ctx.customerClass ?? null }), (d) => d.appliedRules.length);
  const claims = [...identityClaims(match), ...eligibilityClaims(decision, match.canonicalSku, channel, state)];
  const g = await gate(ctx, claims);
  if (decision.authorized === null) { g.outcome = "abstained"; g.confidence = "INSUFFICIENT_EVIDENCE"; }
  const answer = buildAnswer({
    agent: "eligibility", question, input: { partNumber: params.partNumber, channel, state, customerClass: params.customerClass ?? null }, criticality: 2, gate: g,
    data: { sku: match.canonicalSku, channel, state, decision: { ...decision, appliedRules: decision.appliedRules.map((r) => ({ ruleType: r.ruleType, scopeType: r.scopeType, territory: r.territoryCode, customerClass: r.customerClass, notes: r.notes })) } },
    unknown: decision.authorized === null ? [decision.explanation] : undefined,
    resolvingSources: decision.authorized === null ? [state ? "An encoded channel rule for this manufacturer/product" : "The customer's state (territory rules are state-scoped)"] : undefined,
    summaryOverride: decision.authorized === null ? undefined : decision.explanation,
  });
  await recordRun(ctx, answer, Date.now() - t0);
  return answer;
}
