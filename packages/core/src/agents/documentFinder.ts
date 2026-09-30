import type { AgentContext } from "./context.ts";
import { gate, buildAnswer, recordRun, trace } from "./context.ts";
import type { Answer, ProposedClaim } from "../answer/types.ts";
import { resolveVariant } from "./partLookup.ts";
import { lookupPartNumber } from "../retrieval/partLookup.ts";
import { searchDocumentPages } from "../retrieval/fts.ts";
import { extractIdentifierCandidates } from "../identifiers.ts";

const DOC_TYPE_SYNONYMS: [RegExp, string][] = [
  [/\biom\b|\binstallation\b|\boperation\b|\bmaintenance\b|\bmanual\b|\binstructions?\b/i, "iom"],
  [/\bdrawing\b|\bdimension/i, "drawing"],
  [/\bdatasheet\b|\bdata sheet\b|\bcut sheet\b|\bspec(?:ification)? sheet\b|\bpressure[- ]temperature\b|\bp\/?t chart\b|\bspecs?\b/i, "datasheet"],
  [/\btorque\b/i, "torque_chart"],
  [/\bcertificate\b|\bcert\b|\bmtr\b/i, "certificate"],
  [/\bcatalog\b/i, "catalog"],
  [/\bcross[- ]?ref|\bbulletin\b|\bsupersession\b/i, "cross_reference"],
  [/\bprice sheet\b|\bprice list\b/i, "price_sheet"],
];

export async function documentFinderAgent(ctx: AgentContext, params: { query: string; partNumber?: string | null; documentType?: string | null }): Promise<Answer> {
  const t0 = Date.now();
  const question = params.query;
  const docType = params.documentType ?? DOC_TYPE_SYNONYMS.find(([re]) => re.test(params.query))?.[1] ?? null;
  const pn = params.partNumber ?? extractIdentifierCandidates(params.query)[0] ?? null;
  let match = pn ? await resolveVariant(ctx, pn) : null;
  let seriesOnly = false;
  if (!match && pn) {
    // Partial number (e.g. "S90-400" for mfr part S90-400-E): if every candidate belongs to one manufacturer+series, documents can
    // still be located at series level. No identity claim is made for the part itself.
    const cands = await lookupPartNumber(ctx.sql, pn, { allowFuzzy: true });
    const prefix = cands.filter((c) => c.matchType === "prefix");
    if (prefix.length && prefix.every((c) => c.manufacturerCode === prefix[0].manufacturerCode && c.seriesCode === prefix[0].seriesCode)) { match = prefix[0]; seriesOnly = true; }
  }
  let docs: { documentId: string; title: string; documentNumber: string | null; documentType: string; revision: string; publicationDate: string | null; pageCount: number | null; sourceRecordId: string; pageNumber: number; snippet: string | null }[] = [];
  if (match) {
    // Documents tied to this variant through assertion evidence (strongest link), then same-series/manufacturer docs of the requested type.
    const linked = await trace(ctx, "document_by_evidence", { sku: match.canonicalSku, docType }, () => ctx.sql`
      SELECT DISTINCT ON (d.id) d.id AS document_id, d.title, d.document_number, d.document_type, dv.revision, dv.publication_date, dv.page_count, r.id AS source_record_id, r.page_number, NULL::text AS snippet
      FROM knowledge_assertions a JOIN assertion_evidence e ON e.assertion_id = a.id JOIN source_records r ON r.id = e.source_record_id
      JOIN document_versions dv ON dv.id = r.document_version_id AND dv.is_current JOIN documents d ON d.id = dv.document_id
      WHERE a.subject_id = ${match.variantId} ${docType ? ctx.sql`AND d.document_type = ${docType}` : ctx.sql``}
      ORDER BY d.id, r.page_number`, (r) => r.length);
    docs = linked as never;
    if (!docs.length) {
      const [series] = await ctx.sql`SELECT s.code, s.name FROM product_series s JOIN products p ON p.series_id = s.id JOIN product_variants v ON v.product_id = p.id WHERE v.id = ${match.variantId}`;
      const seriesWords = series ? String(series.name).split(" ").slice(0, 2).join(" ") : match.seriesCode ?? "";
      const byMfr = await trace(ctx, "document_by_series_title", { mfr: match.manufacturerCode, series: seriesWords, docType }, () => ctx.sql`
        SELECT d.id AS document_id, d.title, d.document_number, d.document_type, dv.revision, dv.publication_date, dv.page_count, r.id AS source_record_id, r.page_number, NULL::text AS snippet
        FROM documents d JOIN manufacturers m ON m.id = d.manufacturer_id JOIN document_versions dv ON dv.document_id = d.id AND dv.is_current
        JOIN source_records r ON r.document_version_id = dv.id AND r.page_number = 1
        WHERE m.code = ${match.manufacturerCode} ${docType ? ctx.sql`AND d.document_type = ${docType}` : ctx.sql``}
          AND (d.title ILIKE ${"%" + seriesWords + "%"} OR d.title ILIKE ${"%" + (match.seriesCode ?? "\u0000") + "%"})
        ORDER BY d.title`, (r) => r.length);
      docs = byMfr as never;
    }
  } else {
    const hits = await trace(ctx, "fts_documents", { query: params.query, docType }, () => searchDocumentPages(ctx.sql, params.query, { documentType: docType, limit: 10 }), (r) => r.length);
    docs = hits.map((h) => ({ documentId: "", title: h.documentTitle, documentNumber: h.documentNumber, documentType: h.documentType, revision: h.revision, publicationDate: null, pageCount: null, sourceRecordId: h.sourceRecordId, pageNumber: h.pageNumber, snippet: h.snippet }));
  }
  // Section targeting: for spec-type questions point at the page whose text mentions the concept
  const sectionRe = /pressure[- ]temperature|temperature|torque|mounting|dimension|weight|cv/i.exec(params.query);
  if (sectionRe && match) {
    const pages = await searchDocumentPages(ctx.sql, sectionRe[0].replace("-", " "), { manufacturerCode: match.manufacturerCode, documentType: docType, limit: 5 });
    const titles = new Set(docs.map((d) => d.title));
    const targeted = pages.filter((p) => titles.has(p.documentTitle) || !docs.length).map((p) => ({ documentId: "", title: p.documentTitle, documentNumber: p.documentNumber, documentType: p.documentType, revision: p.revision, publicationDate: null, pageCount: null, sourceRecordId: p.sourceRecordId, pageNumber: p.pageNumber, snippet: p.snippet }));
    docs = [...targeted, ...docs];  // section-targeted page first; dedupe by title keeps it
  }
  const seen = new Set<string>();
  docs = docs.filter((d) => !seen.has(d.title) && seen.add(d.title));
  const claims: ProposedClaim[] = docs.map((d) => ({ subjectRef: seriesOnly ? `${match!.manufacturerCode}:${match!.seriesCode}` : match?.canonicalSku ?? "documents", predicate: `document:${d.documentType}`, value: d.title, criticality: 1, kind: "document", support: { sourceRecordIds: [d.sourceRecordId] }, label: `${d.title} (${d.documentNumber ?? ""} Rev ${d.revision}) p.${d.pageNumber}` }));
  const g = await gate(ctx, claims);
  if (!docs.length) { g.outcome = "abstained"; g.confidence = "INSUFFICIENT_EVIDENCE"; }
  const answer = buildAnswer({
    agent: "document_finder", question, input: { query: params.query, partNumber: params.partNumber ?? null, documentType: params.documentType ?? null }, criticality: 1, gate: g,
    data: { sku: seriesOnly ? null : match?.canonicalSku ?? null, seriesLookup: seriesOnly ? `${match?.manufacturerName} ${match?.seriesCode}` : null, documentType: docType, documents: docs.map((d, i) => ({ ...d, citations: g.claims[i]?.citations ?? [], verified: g.claims[i]?.status === "verified" })) },
    unknown: docs.length ? undefined : [`No current ${docType ?? ""} document is indexed for ${match?.canonicalSku ?? `"${params.query}"`}`],
    resolvingSources: ["Ingest the manufacturer document into the document library"],
    humanReview: !docs.length,
  });
  await recordRun(ctx, answer, Date.now() - t0);
  return answer;
}
