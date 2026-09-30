/**
 * RFQ → BOM. Input text (email body, pasted spreadsheet rows, CSV) is untrusted data.
 * Each line is parsed deterministically for quantity / manufacturer / part number / description, then resolved with
 * the same identifier retrieval used everywhere else. Anything not an exact/normalized/historical match requires review.
 */
import type { AgentContext } from "./context.ts";
import { gate, buildAnswer, recordRun } from "./context.ts";
import type { Answer, ProposedClaim } from "../answer/types.ts";
import { lookupPartNumber, type PartMatch } from "../retrieval/partLookup.ts";
import { identityClaims } from "./partLookup.ts";
import { extractIdentifierCandidates } from "../identifiers.ts";
import { extractRequirementsDeterministic } from "../requirements/extract.ts";
import { filterByAttributes } from "../retrieval/attributeFilter.ts";
import { z } from "zod";

export interface ParsedLine { lineNo: number; raw: string; quantity: number | null; manufacturer: string | null; partNumber: string | null; description: string }

const MFR_WORDS = ["bramwell", "bvw", "corvin", "cva", "halden", "hld", "stratton", "str"];

export function parseRfqLines(text: string): ParsedLine[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 2 && !/^(qty|quantity|item|part|description|line)\b.*\b(part|description|qty)/i.test(l));
  const out: ParsedLine[] = [];
  let n = 0;
  for (const raw of lines) {
    const cells = raw.includes("\t") ? raw.split("\t") : raw.includes(",") && raw.split(",").length >= 3 ? raw.split(",") : null;
    let quantity: number | null = null, rest = raw;
    if (cells) { const q = cells.find((c) => /^\s*\d+(\.\d+)?\s*$/.test(c)); if (q) quantity = Number(q); rest = cells.filter((c) => c !== q).join(" ").trim(); }
    else {
      const q = /^(?:item\s*\d+[.:)]?\s*)?(?:qty\s*[:=]?\s*)?(\d+)\s*(?:x|ea|pcs?|each|pieces?|units?)?\b[\s,:-]*(.*)$/i.exec(raw) ?? /^(.*?)[\s,-]+(?:qty\s*[:=]?\s*)?(\d+)\s*(?:ea|pcs?|each|pieces?|units?)\.?$/i.exec(raw);
      if (q) { if (/^\d/.test(raw)) { quantity = Number(q[1]); rest = q[2]; } else { quantity = Number(q[2]); rest = q[1]; } }
    }
    if (!rest.trim() && !quantity) continue;
    if (quantity == null && !extractIdentifierCandidates(rest).length && !/\b(valve|actuator|trap|solenoid|switch|kit|regulator)s?\b/i.test(rest)) continue;
    const mfr = MFR_WORDS.find((m) => new RegExp(`\\b${m}\\b`, "i").test(rest)) ?? null;
    const cands = extractIdentifierCandidates(rest).filter((c) => !/^\d+(\.\d+)?$/.test(c));
    out.push({ lineNo: ++n, raw, quantity, manufacturer: mfr, partNumber: cands[0] ?? null, description: rest.trim() });
  }
  return out;
}

const LlmLines = z.object({ lines: z.array(z.object({ quantity: z.number().nullable(), manufacturer: z.string().nullable(), partNumber: z.string().nullable(), description: z.string(), quote: z.string() })) });

export async function rfqBomAgent(ctx: AgentContext, params: { text: string; sourceKind?: "email" | "pdf" | "excel" | "csv" | "text"; customerId?: string | null }): Promise<Answer> {
  const t0 = Date.now();
  let parsed = parseRfqLines(params.text);
  let llmUsed = false;
  if (ctx.llm.enabled) {
    // LLM only proposes line structure; every proposed part number must literally appear in the source text.
    const res = await ctx.llm.extractJson("Split this RFQ into line items as {lines:[{quantity, manufacturer, partNumber, description, quote}]} where quote is the exact source substring.", params.text, LlmLines);
    if (res) { llmUsed = true; const lit = res.value.lines.filter((l) => l.quote && params.text.includes(l.quote) && (!l.partNumber || params.text.toUpperCase().includes(l.partNumber.toUpperCase()))); if (lit.length >= parsed.length) parsed = lit.map((l, i) => ({ lineNo: i + 1, raw: l.quote, quantity: l.quantity, manufacturer: l.manufacturer, partNumber: l.partNumber, description: l.description })); }
  }
  const [rfq] = await ctx.sql`INSERT INTO rfqs (channel_id, customer_id, source_kind, raw_text, created_by) VALUES (${ctx.channelId}, ${params.customerId ?? ctx.customerId ?? null}, ${params.sourceKind ?? "text"}, ${params.text}, ${ctx.principal.userId}) RETURNING id`;
  const claims: ProposedClaim[] = [];
  const lines: Record<string, unknown>[] = [];
  for (const l of parsed) {
    let match: PartMatch | null = null; let matchType: string = "none"; let candidates: PartMatch[] = []; const questions: string[] = [];
    if (l.partNumber) {
      const found = await lookupPartNumber(ctx.sql, l.partNumber, { manufacturer: l.manufacturer, allowFuzzy: true });
      const strict = found.filter((m) => ["exact", "normalized", "historical", "competitor_xref"].includes(m.matchType));
      if (strict.length === 1) { match = strict[0]; matchType = match.matchType; }
      else { candidates = found; if (strict.length > 1) questions.push(`Identifier ${l.partNumber} is ambiguous across ${strict.length} items`); else if (found.length) questions.push(`No exact match for ${l.partNumber}; ${found.length} partial candidate(s)`); else questions.push(`Part number ${l.partNumber} not found in verified catalog`); }
    }
    if (!match) {
      const req = extractRequirementsDeterministic(l.description);
      const pt = req.fields.find((f) => f.key === "product_type" && f.provenance === "EXPLICIT"); const size = req.fields.find((f) => f.key === "size_in" && f.provenance === "EXPLICIT");
      if (pt && size) {
        const hits = await filterByAttributes(ctx.sql, [{ key: "product_type", op: "eq", value: String(pt.value) }, { key: "size_in", op: "num_eq", value: Number(size.value) }], { limit: 10 });
        if (hits.length) { matchType = "attribute"; candidates = hits.map((h) => ({ variantId: h.variantId, canonicalSku: h.canonicalSku, name: h.name, manufacturerCode: h.manufacturerCode, manufacturerName: h.manufacturerName, seriesCode: h.seriesCode, category: h.category, status: "active", matchType: "fuzzy", matchedIdentifier: "", identifierType: "attribute", sourceRecordId: null, partlistRecordId: null })); questions.push(`Description-only line: ${hits.length} candidate(s) by type/size; confirm manufacturer and specification`); }
      }
      if (l.quantity == null) questions.push("Quantity not stated");
    }
    const start = claims.length;
    if (match) { claims.push(...identityClaims(match)); if (l.quantity == null) questions.push("Quantity not stated"); }
    const confidence = match ? (l.quantity != null ? "VERIFIED" : "NEEDS_REVIEW") : candidates.length ? "NEEDS_REVIEW" : "INSUFFICIENT_EVIDENCE";
    lines.push({ lineNo: l.lineNo, raw: l.raw, quantity: l.quantity, manufacturerText: l.manufacturer, partNumberText: l.partNumber, description: l.description, candidateSku: match?.canonicalSku ?? null, candidateName: match?.name ?? null, matchType, confidence, questions, reviewRequired: confidence !== "VERIFIED", candidates: candidates.map((c) => ({ sku: c.canonicalSku, name: c.name, matchType: c.matchType })), claimStart: start, claimEnd: claims.length });
  }
  const g = await gate(ctx, claims);
  for (const l of lines) {
    const lc = g.claims.slice(l.claimStart as number, l.claimEnd as number);
    if (lc.length && lc.some((c) => c.status !== "verified")) { l.confidence = "NEEDS_REVIEW"; l.reviewRequired = true; (l.questions as string[]).push("Identity evidence failed the answer gate"); }
    l.citations = lc.filter((c) => c.status === "verified").flatMap((c) => c.citations);
    await ctx.sql`INSERT INTO rfq_lines (rfq_id, line_no, raw_line, quantity, manufacturer_text, part_number_text, description_text, candidate_variant_id, match_type, confidence, evidence, questions, review_required)
      VALUES (${rfq.id}, ${l.lineNo as number}, ${l.raw as string}, ${l.quantity as number | null}, ${l.manufacturerText as string | null}, ${l.partNumberText as string | null}, ${l.description as string}, ${l.candidateSku ? (await ctx.sql`SELECT id FROM product_variants WHERE canonical_sku = ${l.candidateSku as string}`)[0]?.id ?? null : null}, ${["exact", "normalized", "historical", "competitor_xref", "attribute"].includes(l.matchType as string) ? (l.matchType as string) : "none"}, ${l.confidence as string}, ${ctx.sql.json(l.citations as never)}, ${ctx.sql.array(l.questions as string[])}, ${l.reviewRequired as boolean})`;
    delete l.claimStart; delete l.claimEnd;
  }
  const verifiedLines = lines.filter((l) => l.confidence === "VERIFIED").length;
  const needsReview = lines.length - verifiedLines;
  if (!lines.length) { g.outcome = "abstained"; g.confidence = "INSUFFICIENT_EVIDENCE"; }
  else if (needsReview > 0) { g.outcome = "partial"; g.confidence = "NEEDS_REVIEW"; }
  await ctx.sql`UPDATE rfqs SET status = ${needsReview ? "review" : "verified"} WHERE id = ${rfq.id}`;
  const answer = buildAnswer({
    agent: "rfq_bom", question: `RFQ (${lines.length} lines)`, input: { text: params.text, sourceKind: params.sourceKind ?? "text" }, criticality: 2, gate: g,
    data: { rfqId: rfq.id, lines, summary: { total: lines.length, verified: verifiedLines, needsReview } },
    known: lines.filter((l) => l.candidateSku).map((l) => `Line ${l.lineNo}: ${l.quantity ?? "?"} × ${l.candidateSku} (${l.matchType})`),
    unknown: lines.filter((l) => l.reviewRequired).map((l) => `Line ${l.lineNo}: ${(l.questions as string[]).join("; ")}`),
    resolvingSources: needsReview ? ["Requester clarification or sales review of flagged lines"] : [],
    humanReview: needsReview > 0, llmUsed,
  });
  await recordRun(ctx, answer, Date.now() - t0);
  return answer;
}
