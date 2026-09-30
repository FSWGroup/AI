import type { AgentContext } from "./context.ts";
import { gate, buildAnswer, recordRun, trace } from "./context.ts";
import type { Answer, ProposedClaim } from "../answer/types.ts";
import { lookupPartNumber, type PartMatch } from "../retrieval/partLookup.ts";
import { loadAssertions, assertionValueString } from "../knowledge/evidence.ts";

export const KEY_ATTRIBUTES = ["product_type", "size_in", "end_connection", "body_material", "seat_material", "pressure_rating_psi", "temp_min_f", "temp_max_f", "cv", "actuation", "torque_output_inlb_80psi", "spring_end_torque_inlb", "voltage", "enclosure_rating"];

/** Identity claims for a match: the queried identifier resolves to this canonical SKU + manufacturer. */
export function identityClaims(m: PartMatch): ProposedClaim[] {
  const claims: ProposedClaim[] = [];
  const identRec = m.sourceRecordId ?? m.partlistRecordId;
  if (!identRec) return claims;
  claims.push({ subjectRef: m.canonicalSku, predicate: "identifier", value: m.matchedIdentifier, criticality: 2, kind: "identity", critical: true,
    support: { sourceRecordIds: [identRec] }, label: `${m.matchedIdentifier} (${m.identifierType.replace(/_/g, " ")}) resolves to ${m.canonicalSku}` });
  if (m.partlistRecordId) {
    claims.push({ subjectRef: m.canonicalSku, predicate: "canonical_sku", value: m.canonicalSku, criticality: 2, kind: "identity", critical: true,
      support: { sourceRecordIds: [m.partlistRecordId] }, label: `Canonical SKU ${m.canonicalSku}` });
    claims.push({ subjectRef: m.canonicalSku, predicate: "manufacturer", value: m.manufacturerName, criticality: 2, kind: "identity", critical: true,
      support: { sourceRecordIds: [m.partlistRecordId] }, label: `${m.canonicalSku} is made by ${m.manufacturerName}` });
  }
  return claims;
}

/** Attribute claims for a variant from its assertions (any status: the gate filters). */
export async function attributeClaims(ctx: AgentContext, variantId: string, sku: string, predicates?: string[], opts: { answerableOnly?: boolean } = {}): Promise<ProposedClaim[]> {
  const all = await loadAssertions(ctx.sql, [variantId], predicates);
  const answerable = new Set(all.filter((a) => a.status === "verified" || a.status === "human_approved").map((a) => a.predicate));
  let assertions = all.filter((a) => !answerable.has(a.predicate) || a.status === "verified" || a.status === "human_approved");
  if (opts.answerableOnly) {
    // restrict to the projection (answerable + authority-eligible); used for informational summaries where unverifiable extras are noise
    const projected = new Set((await ctx.sql`SELECT assertion_id FROM product_attributes WHERE variant_id = ${variantId}`).map((r) => r.assertionId as string));
    assertions = assertions.filter((a) => projected.has(a.id));
  }
  const defs = await ctx.sql`SELECT key, label, unit FROM attribute_definitions`;
  const labels = new Map(defs.map((d) => [d.key, { label: d.label, unit: d.unit }]));
  return assertions.map((a) => ({
    subjectRef: sku, predicate: a.predicate, value: assertionValueString(a), unit: a.unit ?? undefined, criticality: a.criticality, kind: "attribute" as const,
    support: { assertionId: a.id, sourceRecordIds: a.evidence.map((e) => e.sourceRecordId), supportingText: a.evidence[0]?.supportingText ?? undefined },
    label: `${sku} ${labels.get(a.predicate)?.label ?? a.predicate}: ${assertionValueString(a)}${a.unit ? " " + a.unit : ""}`,
  }));
}

export async function partLookupAgent(ctx: AgentContext, query: string, opts: { manufacturer?: string | null; includeAttributes?: boolean } = {}): Promise<Answer> {
  const t0 = Date.now();
  const matches = await trace(ctx, "identifier_lookup", { query, manufacturer: opts.manufacturer ?? null }, () => lookupPartNumber(ctx.sql, query, { manufacturer: opts.manufacturer, allowFuzzy: true }), (r) => r.length);
  const resolved = matches.filter((m) => m.matchType === "exact" || m.matchType === "normalized" || m.matchType === "historical" || m.matchType === "competitor_xref");
  const candidates = matches.filter((m) => !resolved.includes(m));
  const claims: ProposedClaim[] = [];
  for (const m of resolved) {
    claims.push(...identityClaims(m));
    if (opts.includeAttributes !== false) claims.push(...await attributeClaims(ctx, m.variantId, m.canonicalSku, KEY_ATTRIBUTES, { answerableOnly: true }));
  }
  const g = await gate(ctx, claims);
  if (!resolved.length) {
    g.outcome = "abstained"; g.confidence = "INSUFFICIENT_EVIDENCE";
  }
  const answer = buildAnswer({
    agent: "part_lookup", question: query, input: { query, manufacturer: opts.manufacturer ?? null }, criticality: 1, gate: g,
    data: { query, resolved: resolved.map(publicMatch), candidates: candidates.map(publicMatch), matchType: resolved[0]?.matchType ?? null },
    unknown: resolved.length ? undefined : [candidates.length ? `No exact match for "${query}"; ${candidates.length} partial/fuzzy candidate(s) listed for review — none is asserted as the requested part` : `No identifier matching "${query}" exists in the verified catalog`],
    resolvingSources: resolved.length ? undefined : ["Manufacturer part list / P21 item master for this identifier"],
    humanReview: !resolved.length && candidates.length > 0,
  });
  await recordRun(ctx, answer, Date.now() - t0);
  return answer;
}

export function publicMatch(m: PartMatch) {
  return { sku: m.canonicalSku, name: m.name, manufacturer: m.manufacturerName, series: m.seriesCode, category: m.category, status: m.status, matchType: m.matchType, matchedIdentifier: m.matchedIdentifier, identifierType: m.identifierType, similarity: m.similarity ?? null };
}

/** Resolve a single variant strictly (exact/normalized/historical) or return null. Shared by other agents. */
export async function resolveVariant(ctx: AgentContext, query: string, manufacturer?: string | null): Promise<PartMatch | null> {
  const matches = await trace(ctx, "identifier_lookup", { query, manufacturer: manufacturer ?? null }, () => lookupPartNumber(ctx.sql, query, { manufacturer, allowFuzzy: false }), (r) => r.length);
  const strict = matches.filter((m) => m.matchType !== "fuzzy" && m.matchType !== "prefix");
  return strict.length === 1 ? strict[0] : null;
}
