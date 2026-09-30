import type { AgentContext } from "./context.ts";
import { gate, buildAnswer, recordRun } from "./context.ts";
import type { Answer, ProposedClaim } from "../answer/types.ts";
import { attributeClaims, identityClaims, resolveVariant } from "./partLookup.ts";
import { ABSTAIN_TEXT } from "../answer/types.ts";

/** Predicate synonyms used to map a question to attribute keys deterministically. */
export const PREDICATE_SYNONYMS: [RegExp, string][] = [
  [/\bpressure(?: rating)?\b|\bwog\b|\bpsi\b|\brated (?:to|for)\b/i, "pressure_rating_psi"],
  [/\bsteam rating\b|\bsteam\b/i, "steam_rating_psi"],
  [/\bmax(?:imum)? temp|\btemperature (?:range|rating|limit|max)|\bhow hot\b|\btemp(?:erature)?\b/i, "temp_max_f"],
  [/\bmin(?:imum)? temp|\bhow cold\b/i, "temp_min_f"],
  [/\bcv\b|\bflow coefficient\b/i, "cv"],
  [/\bbody material\b|\bmaterial\b|\bwhat is it made of\b/i, "body_material"],
  [/\bseat\b/i, "seat_material"],
  [/\bseal\b|\bo-?ring\b/i, "seal_material"],
  [/\bball material\b/i, "ball_material"],
  [/\bstem material\b/i, "stem_material"],
  [/\bdisc\b/i, "disc_material"],
  [/\bsize\b|\bhow big\b/i, "size_in"],
  [/\bend connection|\bconnection\b|\bnpt\b|\bthread/i, "end_connection"],
  [/\bport\b/i, "port_configuration"],
  [/\btorque\b/i, "break_torque_inlb"],
  [/\bmount(?:ing)?\b|\biso ?5211\b|\bpad\b/i, "mount_pad_iso5211"],
  [/\bstem size\b|\bstem\b/i, "stem_size_mm"],
  [/\bcertif|\bnsf\b|\bce\b|\bapproval/i, "certifications"],
  [/\blead[- ]free\b/i, "lead_free"],
  [/\bweight\b|\bweigh\b/i, "weight_lb"],
  [/\bvacuum\b/i, "vacuum_rating"],
  [/\bvoltage\b|\bvolt/i, "voltage"],
  [/\benclosure\b|\bnema\b|\bip rating\b/i, "enclosure_rating"],
  [/\bhazardous\b|\bexplosion/i, "hazardous_area_cert"],
  [/\bsupply pressure\b/i, "supply_pressure_max_psi"],
  [/\bspring (?:end )?torque\b/i, "spring_end_torque_inlb"],
  [/\boutput torque\b/i, "torque_output_inlb_80psi"],
  [/\bmedia\b|\bservice\b/i, "media"],
];

export function predicatesFromQuestion(q: string): string[] {
  const out: string[] = [];
  for (const [re, key] of PREDICATE_SYNONYMS) if (re.test(q) && !out.includes(key)) out.push(key);
  // temperature question generally wants both bounds
  if (out.includes("temp_max_f") && /range|limits?/i.test(q) && !out.includes("temp_min_f")) out.push("temp_min_f");
  return out;
}

/**
 * Answer "what is the <attribute> of <part>" from verified assertions only.
 * If the requested attribute has no eligible assertion the answer abstains (the requested claim is critical).
 */
export async function productSpecsAgent(ctx: AgentContext, params: { partNumber: string; predicates?: string[]; question?: string; manufacturer?: string | null }): Promise<Answer> {
  const t0 = Date.now();
  const question = params.question ?? `Specifications for ${params.partNumber}${params.predicates ? ` (${params.predicates.join(", ")})` : ""}`;
  const match = await resolveVariant(ctx, params.partNumber, params.manufacturer);
  const requested = params.predicates?.length ? params.predicates : undefined;
  if (!match) {
    const g = await gate(ctx, []);
    g.outcome = "abstained"; g.confidence = "INSUFFICIENT_EVIDENCE";
    const answer = buildAnswer({ agent: "product_specs", question, input: { partNumber: params.partNumber, predicates: params.predicates ?? null, question: params.question ?? null }, criticality: 3, gate: g, unknown: [`"${params.partNumber}" does not resolve to exactly one verified catalog item`], resolvingSources: ["Manufacturer part list or P21 item master entry for this identifier"], humanReview: true });
    await recordRun(ctx, answer, Date.now() - t0);
    return answer;
  }
  const claims: ProposedClaim[] = [...identityClaims(match)];
  const attrs = await attributeClaims(ctx, match.variantId, match.canonicalSku, requested);
  for (const c of attrs) if (requested?.includes(c.predicate)) c.critical = true;
  claims.push(...attrs);
  const missing = (requested ?? []).filter((p) => !attrs.some((a) => a.predicate === p));
  const criticality = Math.max(3, ...attrs.map((a) => a.criticality));
  const g = await gate(ctx, claims);
  if (missing.length) { g.outcome = "abstained"; g.confidence = "INSUFFICIENT_EVIDENCE"; }
  const verified = g.claims.filter((c) => c.status === "verified" && c.kind === "attribute");
  const answer = buildAnswer({
    agent: "product_specs", question, input: { partNumber: params.partNumber, predicates: params.predicates ?? null, question: params.question ?? null }, criticality, gate: g,
    data: { sku: match.canonicalSku, name: match.name, manufacturer: match.manufacturerName, matchType: match.matchType, requested: requested ?? null,
      specs: verified.map((c) => ({ key: c.predicate, value: c.value, unit: c.unit ?? null, citations: c.citations })) },
    unknown: [...missing.map((p) => `${match.canonicalSku} ${p}: no assertion exists in the knowledge base`), ...g.claims.filter((c) => c.status !== "verified" && c.status !== "assumption").map((c) => `${c.label ?? c.predicate} — ${c.reason}`)],
    summaryOverride: g.outcome === "abstained" ? ABSTAIN_TEXT : undefined,
  });
  await recordRun(ctx, answer, Date.now() - t0);
  return answer;
}
