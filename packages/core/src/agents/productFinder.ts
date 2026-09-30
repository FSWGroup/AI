/**
 * Product Finder: natural language → structured requirements → attribute filter over verified projection →
 * requirement matrix per candidate → eligibility per channel → gated claims.
 * Hard filters use EXPLICIT requirements only. INFERRED fields are shown as labeled assumptions. UNKNOWN fields are
 * returned as questions. Multiple valid products are returned ranked; no forced single recommendation.
 */
import type { AgentContext } from "./context.ts";
import { gate, buildAnswer, recordRun, trace, channelDenied } from "./context.ts";
import type { Answer, ProposedClaim } from "../answer/types.ts";
import { extractRequirements, type Requirements } from "../requirements/extract.ts";
import { filterByAttributes, type AttributeConstraint, type FilterHit } from "../retrieval/attributeFilter.ts";
import { attributeClaims } from "./partLookup.ts";
import { decideEligibility } from "../rules/channelEngine.ts";
import { eligibilityClaims } from "./eligibility.ts";

type Verdict = "MATCH" | "MISMATCH" | "UNKNOWN" | "NOT_EVALUATED";
interface MatrixRow { key: string; required: string | number | null; provenance: string; actual: string | null; verdict: Verdict }

const MATERIAL_SYNONYMS: Record<string, string[]> = { stainless: ["stainless", "316", "304", "cf8m"], brass: ["brass"], "carbon steel": ["carbon steel", "wcb", "a105"], "ductile iron": ["ductile iron"], aluminum: ["aluminum"], bronze: ["bronze"] };

const ACTUATOR_KEYS = new Set(["actuation", "voltage", "actuator_power", "fail_position", "supply_pressure_psi"]);
const ACTUATOR_CATEGORIES = new Set(["pneumatic_actuator", "electric_actuator", "solenoid_valve", "limit_switch"]);

function evaluate(hit: FilterHit, req: Requirements): MatrixRow[] {
  const rows: MatrixRow[] = [];
  const attr = (k: string) => hit.attributes[k];
  for (const f of req.fields) {
    if (f.provenance === "UNKNOWN") { rows.push({ key: f.key, required: null, provenance: f.provenance, actual: null, verdict: "UNKNOWN" }); continue; }
    let verdict: Verdict = "UNKNOWN"; let actual: string | null = null;
    // Actuation/electrical requirements belong to the actuator selection step (assembly agent), not to a valve candidate.
    if (ACTUATOR_KEYS.has(f.key) && !ACTUATOR_CATEGORIES.has(hit.category)) { rows.push({ key: f.key, required: f.value, provenance: f.provenance, actual: null, verdict: "NOT_EVALUATED" }); continue; }
    // Steam is inherent to a steam trap; the pressure requirement is evaluated against its rating instead.
    if (f.key === "media" && f.value === "steam" && hit.category === "steam_trap") { rows.push({ key: f.key, required: f.value, provenance: f.provenance, actual: "steam service (product type)", verdict: "NOT_EVALUATED" }); continue; }
    switch (f.key) {
      case "product_type": case "end_connection": case "actuation": case "port_configuration": { const a = attr(f.key); if (a) { actual = a.value; verdict = a.value === f.value ? "MATCH" : "MISMATCH"; } break; }
      case "size_in": { const a = attr("size_in"); if (a?.number != null) { actual = a.value; verdict = Math.abs(a.number - Number(f.value)) < 1e-6 ? "MATCH" : "MISMATCH"; } break; }
      case "body_material": { const a = attr("body_material"); if (a) { actual = a.value; const syn = MATERIAL_SYNONYMS[String(f.value)] ?? [String(f.value)]; verdict = syn.some((s) => a.value.toLowerCase().includes(s)) ? "MATCH" : "MISMATCH"; } break; }
      case "min_pressure_psi": { const a = attr("pressure_rating_psi"); if (a?.number != null) { actual = `${a.value} psi`; verdict = a.number >= Number(f.value) ? "MATCH" : "MISMATCH"; } break; }
      case "max_temp_f": { const a = attr("temp_max_f"); if (a?.number != null) { actual = `${a.value} F`; verdict = a.number >= Number(f.value) ? "MATCH" : "MISMATCH"; } break; }
      case "media": { const a = attr("media"); const steam = attr("steam_rating_psi");
        if (f.value === "steam") { if (a?.value.toLowerCase().includes("not rated for steam")) { actual = a.value; verdict = "MISMATCH"; } else if (steam) { actual = `steam rating ${steam.value} psi`; verdict = "MATCH"; } }
        else { verdict = "NOT_EVALUATED"; actual = a?.value ?? null; } break; }
      case "lead_free": { const a = attr("lead_free"); if (a) { actual = a.value; verdict = a.value === "true" ? "MATCH" : "MISMATCH"; } break; }
      case "voltage": { const a = attr("voltage"); if (a) { actual = a.value; verdict = a.value.toUpperCase().includes(String(f.value).toUpperCase().split(" ")[0]) ? "MATCH" : "MISMATCH"; } break; }
      default: continue; // fields not evaluable against product attributes (actuator_power, fail_position...) are handled by the assembly agent
    }
    rows.push({ key: f.key, required: f.value, provenance: f.provenance, actual, verdict });
  }
  return rows;
}

export async function productFinderAgent(ctx: AgentContext, params: { text: string; channel?: "welsford" | "valveman"; state?: string | null; limit?: number }): Promise<Answer> {
  const t0 = Date.now();
  const channel = params.channel ?? ctx.channelId;
  const denied = await channelDenied(ctx, "product_finder", params.text, channel, 3); if (denied) return denied;
  const req = await extractRequirements(params.text, ctx.llm);
  const explicit = req.fields.filter((f) => f.provenance === "EXPLICIT");
  const constraints: AttributeConstraint[] = [];
  const pt = explicit.find((f) => f.key === "product_type");
  if (pt) constraints.push({ key: "product_type", op: "eq", value: String(pt.value) });
  const size = explicit.find((f) => f.key === "size_in");
  if (size) constraints.push({ key: "size_in", op: "num_eq", value: Number(size.value) });
  if (!pt && !size) {
    const g = await gate(ctx, []); g.outcome = "abstained"; g.confidence = "INSUFFICIENT_EVIDENCE";
    const answer = buildAnswer({ agent: "product_finder", question: params.text, input: { text: params.text, channel, state: params.state ?? null }, criticality: 3, gate: g, data: { requirements: req.fields, matches: [], nearMatches: [] },
      unknown: ["No product type or size could be identified in the request; a search over the verified catalog would not be meaningful"], resolvingSources: ["Product type and nominal size from the requester"], humanReview: true, llmUsed: req.llmUsed });
    await recordRun(ctx, answer, Date.now() - t0); return answer;
  }
  const hits = await trace(ctx, "attribute_filter", constraints, () => filterByAttributes(ctx.sql, constraints, { limit: 100 }), (r) => r.length);
  const evaluated = hits.map((h) => ({ hit: h, matrix: evaluate(h, req) }));
  const scored = evaluated.map((e) => ({ ...e, matches: e.matrix.filter((r) => r.verdict === "MATCH").length, mismatches: e.matrix.filter((r) => r.verdict === "MISMATCH").length, unknowns: e.matrix.filter((r) => r.verdict === "UNKNOWN").length }));
  // A product matches only if every EXPLICIT, evaluable requirement is verified as MATCH. An explicit requirement whose actual
  // value is UNKNOWN (no verified evidence, open conflict) makes the product 'unverifiable' — never a recommendation.
  const explicitUnknown = (s: typeof scored[number]) => s.matrix.filter((r) => r.provenance === "EXPLICIT" && r.verdict === "UNKNOWN");
  const matching = scored.filter((s) => s.mismatches === 0 && explicitUnknown(s).length === 0).sort((a, b) => b.matches - a.matches || a.unknowns - b.unknowns).slice(0, params.limit ?? 10);
  const unverifiable = scored.filter((s) => s.mismatches === 0 && explicitUnknown(s).length > 0).map((s) => ({ sku: s.hit.canonicalSku, name: s.hit.name, cannotVerify: explicitUnknown(s).map((r) => r.key) }));
  const near = scored.filter((s) => s.mismatches > 0).sort((a, b) => a.mismatches - b.mismatches).slice(0, 5);

  const claims: ProposedClaim[] = [];
  const perProduct: { sku: string; claimStart: number; claimEnd: number; eligibility: unknown }[] = [];
  for (const m of matching) {
    const start = claims.length;
    const keys = m.matrix.filter((r) => r.verdict === "MATCH").map((r) => ({ product_type: "product_type", size_in: "size_in", end_connection: "end_connection", body_material: "body_material", min_pressure_psi: "pressure_rating_psi", max_temp_f: "temp_max_f", media: "steam_rating_psi", lead_free: "lead_free", voltage: "voltage", actuation: "actuation", port_configuration: "port_configuration" } as Record<string, string>)[r.key]).filter(Boolean);
    const attrs = await attributeClaims(ctx, m.hit.variantId, m.hit.canonicalSku, [...new Set(keys)]);
    for (const a of attrs) a.critical = true; // a matched requirement that fails evidence must drop the product, not silently pass
    claims.push(...attrs);
    const decision = await decideEligibility(ctx.sql, { variantId: m.hit.variantId, channelId: channel, state: params.state ?? ctx.state ?? null, customerClass: ctx.customerClass ?? null });
    claims.push(...eligibilityClaims(decision, m.hit.canonicalSku, channel, params.state ?? ctx.state ?? null));
    perProduct.push({ sku: m.hit.canonicalSku, claimStart: start, claimEnd: claims.length, eligibility: { authorized: decision.authorized, rfqOnly: decision.rfqOnly, ecommerce: decision.ecommerce, explanation: decision.explanation } });
  }
  for (const f of req.fields.filter((f) => f.provenance === "INFERRED")) claims.push({ subjectRef: "requirements", predicate: f.key, value: String(f.value), criticality: 1, kind: "assumption", support: { sourceRecordIds: [] }, label: `Assumed ${f.key} = ${f.value} (${f.note ?? "inferred"})` });

  const g = await gate(ctx, claims);
  // A product whose matched-requirement claims were not all verified is demoted out of the matching list.
  const results = matching.map((m, i) => {
    const p = perProduct[i];
    const productClaims = g.claims.slice(p.claimStart, p.claimEnd);
    const allVerified = productClaims.filter((c) => c.kind === "attribute").every((c) => c.status === "verified");
    return { sku: m.hit.canonicalSku, name: m.hit.name, manufacturer: m.hit.manufacturerName, series: m.hit.seriesCode, matchedRequirements: m.matches, unknownRequirements: m.unknowns, matrix: m.matrix, eligibility: p.eligibility, verified: allVerified,
      whyMatched: m.matrix.filter((r) => r.verdict === "MATCH").map((r) => `${r.key} = ${r.actual}`), citations: productClaims.filter((c) => c.status === "verified").flatMap((c) => c.citations), removedClaims: productClaims.filter((c) => c.status !== "verified" && c.status !== "assumption").map((c) => `${c.predicate}: ${c.reason}`) };
  });
  const verifiedResults = results.filter((r) => r.verified);
  // Overall outcome is about the *list*: partial removals of individual candidates demote candidates, not the whole answer.
  const removedCritical = g.report.removedCritical;
  if (!verifiedResults.length) { g.outcome = "abstained"; g.confidence = "INSUFFICIENT_EVIDENCE"; }
  else if (removedCritical > 0) { g.outcome = "partial"; g.confidence = "NEEDS_REVIEW"; }
  const missing = req.fields.filter((f) => f.provenance === "UNKNOWN").map((f) => f.key);
  const answer = buildAnswer({
    agent: "product_finder", question: params.text, input: { text: params.text, channel, state: params.state ?? null }, criticality: 3, gate: g,
    data: { requirements: req.fields, channel, matches: verifiedResults, unverifiable, demoted: results.filter((r) => !r.verified), nearMatches: near.map((n) => ({ sku: n.hit.canonicalSku, name: n.hit.name, mismatches: n.matrix.filter((r) => r.verdict === "MISMATCH") })), missingRequirements: missing,
      nextAction: verifiedResults.length > 1 ? `${verifiedResults.length} products satisfy the explicit requirements; confirm ${missing.slice(0, 3).join(", ") || "remaining details"} to narrow the selection` : verifiedResults.length === 1 ? `One verified product matches; confirm ${missing.slice(0, 3).join(", ") || "application details"} before quoting` : "No verified product matches the explicit requirements; route to application engineering" },
    known: verifiedResults.map((r) => `${r.sku} (${r.manufacturer}) matches: ${r.whyMatched.join(", ")}`),
    unknown: [...missing.map((k) => `Requirement not stated: ${k}`), ...unverifiable.map((u) => `${u.sku}: cannot verify ${u.cannotVerify.join(", ")} against the stated requirement`), ...results.filter((r) => !r.verified).map((r) => `${r.sku} demoted: ${r.removedClaims.join("; ")}`)],
    resolvingSources: missing.length ? ["Requester to confirm missing requirements"] : [],
    humanReview: verifiedResults.length === 0 || req.fields.some((f) => f.key === "hazardous_area" && f.provenance === "EXPLICIT"),
    llmUsed: req.llmUsed,
  });
  await recordRun(ctx, answer, Date.now() - t0);
  return answer;
}
