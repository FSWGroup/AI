/**
 * Cross-reference agent. Four categories, never blurred:
 *   MANUFACTURER_APPROVED_SUBSTITUTE   relationship approved_substitute_for|replaces, approval_authority = manufacturer, status verified/human_approved
 *   WELSFORD_APPROVED_SUBSTITUTE       relationship approved_substitute_for, approval_authority = welsford, status human_approved
 *   TECHNICALLY_SIMILAR_ALTERNATIVE    relationship technically_similar_to (any authority) — explicitly NOT a substitute
 *   POSSIBLE_MATCH_REQUIRING_REVIEW    relationship possible_match_needs_review, or any pending relationship
 */
import type { AgentContext } from "./context.ts";
import { gate, buildAnswer, recordRun, trace } from "./context.ts";
import type { Answer, ProposedClaim } from "../answer/types.ts";
import { identityClaims, resolveVariant } from "./partLookup.ts";
import { lookupPartNumber } from "../retrieval/partLookup.ts";

export type XrefCategory = "MANUFACTURER_APPROVED_SUBSTITUTE" | "WELSFORD_APPROVED_SUBSTITUTE" | "TECHNICALLY_SIMILAR_ALTERNATIVE" | "POSSIBLE_MATCH_REQUIRING_REVIEW";

const CATEGORY_VALUE: Record<XrefCategory, string> = {
  MANUFACTURER_APPROVED_SUBSTITUTE: "approved substitute",
  WELSFORD_APPROVED_SUBSTITUTE: "approved substitute",
  TECHNICALLY_SIMILAR_ALTERNATIVE: "technically similar",
  POSSIBLE_MATCH_REQUIRING_REVIEW: "possible match requires review",
};

export function categorize(r: { relationshipType: string; approvalAuthority: string | null; status: string }): XrefCategory | null {
  const approved = r.status === "verified" || r.status === "human_approved";
  if ((r.relationshipType === "approved_substitute_for" || r.relationshipType === "replaces") && r.approvalAuthority === "manufacturer" && approved) return "MANUFACTURER_APPROVED_SUBSTITUTE";
  if (r.relationshipType === "approved_substitute_for" && r.approvalAuthority === "welsford" && r.status === "human_approved") return "WELSFORD_APPROVED_SUBSTITUTE";
  if (r.relationshipType === "technically_similar_to" && approved) return "TECHNICALLY_SIMILAR_ALTERNATIVE";
  if (r.status === "rejected" || r.status === "deprecated") return null;
  if (r.relationshipType === "possible_match_needs_review" || r.status === "pending" || r.relationshipType === "approved_substitute_for") return "POSSIBLE_MATCH_REQUIRING_REVIEW";
  return null;
}

export async function crossReferenceAgent(ctx: AgentContext, params: { partNumber: string; manufacturer?: string | null }): Promise<Answer> {
  const t0 = Date.now();
  const question = `Cross reference for ${params.partNumber}`;
  let match = await resolveVariant(ctx, params.partNumber, params.manufacturer);
  if (!match) {
    const g = await gate(ctx, []); g.outcome = "abstained"; g.confidence = "INSUFFICIENT_EVIDENCE";
    const cands = await lookupPartNumber(ctx.sql, params.partNumber, { allowFuzzy: true });
    const answer = buildAnswer({ agent: "cross_reference", question, input: { partNumber: params.partNumber, manufacturer: params.manufacturer ?? null }, criticality: 3, gate: g, data: { candidates: cands.map((c) => ({ sku: c.canonicalSku, matchType: c.matchType })) },
      unknown: [`"${params.partNumber}" is not a known catalog or competitor identifier; no cross-reference can be asserted`], resolvingSources: ["A competitor part-number entry in the approved cross-reference register"], humanReview: true });
    await recordRun(ctx, answer, Date.now() - t0); return answer;
  }
  const rels = await trace(ctx, "relationship_traversal", { sku: match.canonicalSku }, () => ctx.sql`
    SELECT r.id, r.relationship_type, r.approval_authority, r.status, r.notes, r.conditions,
           CASE WHEN r.from_variant_id = ${match.variantId} THEN 'from' ELSE 'to' END AS direction,
           v.canonical_sku AS other_sku, v.name AS other_name, m.name AS other_manufacturer, v.status AS other_status,
           coalesce(json_agg(json_build_object('sourceRecordId', e.source_record_id, 'text', e.supporting_text)) FILTER (WHERE e.id IS NOT NULL), '[]') AS evidence
    FROM product_relationships r
    JOIN product_variants v ON v.id = CASE WHEN r.from_variant_id = ${match.variantId} THEN r.to_variant_id ELSE r.from_variant_id END
    JOIN products p ON p.id = v.product_id JOIN manufacturers m ON m.id = p.manufacturer_id
    LEFT JOIN relationship_evidence e ON e.relationship_id = r.id
    WHERE (r.from_variant_id = ${match.variantId} OR r.to_variant_id = ${match.variantId})
      AND r.relationship_type IN ('approved_substitute_for','technically_similar_to','possible_match_needs_review','replaces','superseded_by')
    GROUP BY r.id, v.id, m.id`, (r) => r.length);
  const claims: ProposedClaim[] = [...identityClaims(match)];
  const results: { category: XrefCategory; sku: string; name: string; manufacturer: string; direction: string; notes: string | null; conditions: unknown; claimIndex: number; evidenceIds?: string[] }[] = [];
  for (const r of rels) {
    const cat = categorize({ relationshipType: r.relationshipType, approvalAuthority: r.approvalAuthority, status: r.status });
    if (!cat) continue;
    // approved_substitute_for is directional: from IS a substitute FOR to. Only present substitutes *for* the queried part
    // (direction 'to'), and, for the reverse direction, present it as "X is a substitute for this part's competitor" only under review.
    const ev = r.evidence as { sourceRecordId: string; text: string | null }[];
    const label = cat === "TECHNICALLY_SIMILAR_ALTERNATIVE"
      ? `${r.otherSku} is technically similar to ${match.canonicalSku} — NOT an approved substitute`
      : cat === "POSSIBLE_MATCH_REQUIRING_REVIEW" ? `${r.otherSku} is a possible match for ${match.canonicalSku}; requires application-engineering review`
      : r.direction === "to" ? `${r.otherSku} is a ${cat === "WELSFORD_APPROVED_SUBSTITUTE" ? "Welsford" : "manufacturer"}-approved substitute for ${match.canonicalSku}`
      : `${match.canonicalSku} is a ${cat === "WELSFORD_APPROVED_SUBSTITUTE" ? "Welsford" : "manufacturer"}-approved substitute for ${r.otherSku}`;
    if (cat === "POSSIBLE_MATCH_REQUIRING_REVIEW") {
      // Not a factual claim: surfaced as a review item with its (unverified) evidence pointer.
      results.push({ category: cat, sku: r.otherSku, name: r.otherName, manufacturer: r.otherManufacturer, direction: r.direction, notes: r.notes, conditions: r.conditions, claimIndex: -1, evidenceIds: ev.map((e) => e.sourceRecordId) });
      continue;
    }
    claims.push({ subjectRef: match.canonicalSku, predicate: `xref:${cat}`, value: CATEGORY_VALUE[cat], criticality: cat.includes("SUBSTITUTE") ? 4 : 3, kind: "relationship",
      support: { relationshipId: r.id, sourceRecordIds: ev.map((e) => e.sourceRecordId), supportingText: ev[0]?.text ?? undefined }, label });
    results.push({ category: cat, sku: r.otherSku, name: r.otherName, manufacturer: r.otherManufacturer, direction: r.direction, notes: r.notes, conditions: r.conditions, claimIndex: claims.length - 1 });
  }
  // Historical numbers this part replaces (manufacturer supersession bulletin)
  const hist = await ctx.sql`SELECT identifier_raw, source_record_id FROM product_identifiers WHERE variant_id = ${match.variantId} AND identifier_type IN ('historical_part_number','superseded_part_number') AND source_record_id IS NOT NULL`;
  const supersedes: string[] = [];
  for (const h of hist) {
    claims.push({ subjectRef: match.canonicalSku, predicate: "replaces_historical", value: `${h.identifierRaw} replaced by ${match.matchedIdentifier.toUpperCase() === h.identifierRaw.toUpperCase() ? match.canonicalSku.replace(/^[A-Z]+-/, "") : match.canonicalSku.replace(/^[A-Z]+-/, "")}`, criticality: 3, kind: "relationship",
      support: { sourceRecordIds: [h.sourceRecordId] }, label: `${match.canonicalSku} replaces discontinued ${h.identifierRaw} (manufacturer supersession)` });
    supersedes.push(h.identifierRaw);
  }
  const g = await gate(ctx, claims);
  const byCat: Record<XrefCategory, unknown[]> = { MANUFACTURER_APPROVED_SUBSTITUTE: [], WELSFORD_APPROVED_SUBSTITUTE: [], TECHNICALLY_SIMILAR_ALTERNATIVE: [], POSSIBLE_MATCH_REQUIRING_REVIEW: [] };
  for (const r of results) {
    if (r.claimIndex < 0) { byCat[r.category].push({ sku: r.sku, name: r.name, manufacturer: r.manufacturer, direction: r.direction, notes: r.notes, conditions: r.conditions, verified: false, citations: [], evidenceIds: r.evidenceIds ?? [], reason: "relationship pending human review" }); continue; }
    const c = g.claims[r.claimIndex];
    if (c.status === "verified") byCat[r.category].push({ sku: r.sku, name: r.name, manufacturer: r.manufacturer, direction: r.direction, notes: r.notes, conditions: r.conditions, verified: true, citations: c.citations, reason: null });
  }
  const answered = results.length > 0 || supersedes.length > 0;
  if (!answered) { g.outcome = "abstained"; g.confidence = "INSUFFICIENT_EVIDENCE"; }
  const answer = buildAnswer({
    agent: "cross_reference", question, input: { partNumber: params.partNumber, manufacturer: params.manufacturer ?? null }, criticality: 3, gate: g,
    data: { sku: match.canonicalSku, name: match.name, manufacturer: match.manufacturerName, matchType: match.matchType, categories: byCat, supersedes },
    unknown: answered ? undefined : [`No approved substitute, similar alternative or supersession is recorded for ${match.canonicalSku}`],
    resolvingSources: ["Manufacturer cross-reference bulletin or the Welsford approved cross-reference register"],
    humanReview: byCat.POSSIBLE_MATCH_REQUIRING_REVIEW.length > 0 || !answered,
  });
  await recordRun(ctx, answer, Date.now() - t0);
  return answer;
}
