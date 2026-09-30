/**
 * Retrieval stages 1-3: exact normalized identifier → manufacturer-qualified → alternate/historical → prefix/fuzzy.
 * Exact matches always outrank fuzzy results; a fuzzy result can never be labeled "exact".
 */
import type { Sql } from "../db/client.ts";
import { normalizeIdentifier } from "../identifiers.ts";

export type MatchType = "exact" | "normalized" | "historical" | "competitor_xref" | "prefix" | "fuzzy";

export interface PartMatch {
  variantId: string;
  canonicalSku: string;
  name: string;
  manufacturerCode: string;
  manufacturerName: string;
  seriesCode: string | null;
  category: string;
  status: string;
  matchType: MatchType;
  matchedIdentifier: string;
  identifierType: string;
  sourceRecordId: string | null;
  /** the variant's manufacturer part-list record (identity evidence for SKU + manufacturer) */
  partlistRecordId: string | null;
  similarity?: number;
}

const baseSelect = (sql: Sql) => sql`
  SELECT v.id AS variant_id, v.canonical_sku, v.name, m.code AS manufacturer_code, m.name AS manufacturer_name, s.code AS series_code, p.category, v.status,
         i.identifier_raw, i.identifier_type, i.identifier_norm, i.source_record_id,
         (SELECT pi.source_record_id FROM product_identifiers pi WHERE pi.variant_id = v.id AND pi.identifier_type = 'canonical_sku' LIMIT 1) AS partlist_record_id
  FROM product_identifiers i
  JOIN product_variants v ON v.id = i.variant_id
  JOIN products p ON p.id = v.product_id
  JOIN manufacturers m ON m.id = p.manufacturer_id
  LEFT JOIN product_series s ON s.id = p.series_id`;

function toMatch(r: Record<string, any>, matchType: MatchType, similarity?: number): PartMatch {
  return { variantId: r.variantId, canonicalSku: r.canonicalSku, name: r.name, manufacturerCode: r.manufacturerCode, manufacturerName: r.manufacturerName, seriesCode: r.seriesCode, category: r.category, status: r.status, matchType, matchedIdentifier: r.identifierRaw, identifierType: r.identifierType, sourceRecordId: r.sourceRecordId, partlistRecordId: r.partlistRecordId, similarity };
}

export async function lookupPartNumber(sql: Sql, raw: string, opts: { manufacturer?: string | null; allowFuzzy?: boolean; limit?: number } = {}): Promise<PartMatch[]> {
  const norm = normalizeIdentifier(raw);
  if (!norm) return [];
  const limit = opts.limit ?? 10;
  const mfrFilter = opts.manufacturer ? sql`AND (m.code = ${opts.manufacturer.toUpperCase()} OR upper(m.name) = ${opts.manufacturer.toUpperCase()} OR upper(${opts.manufacturer}) = ANY(SELECT upper(unnest(m.aliases))))` : sql``;

  // Stage 1/2: exact normalized match on primary identifiers (canonical SKU, mfr part number, P21 item, Shopify SKU)
  const exact = await sql`${baseSelect(sql)} WHERE i.identifier_norm = ${norm} AND i.identifier_type IN ('canonical_sku','mfr_part_number','p21_item_id','shopify_sku','upc') ${mfrFilter}`;
  if (exact.length) {
    const seen = new Set<string>();
    return exact.filter((r) => !seen.has(r.variantId) && seen.add(r.variantId)).map((r) => toMatch(r, r.identifierRaw.toUpperCase() === raw.trim().toUpperCase() ? "exact" : "normalized"));
  }
  // Stage 2b: manufacturer prefix stripped (e.g. "BVW S70-200" or "Bramwell S70-200")
  const mfrs = await sql`SELECT code, name, aliases FROM manufacturers`;
  for (const m of mfrs) {
    const names = [m.code, m.name, ...(m.aliases as string[])].map((x: string) => normalizeIdentifier(x));
    for (const n of names) {
      if (norm.startsWith(n) && norm.length > n.length) {
        const rest = norm.slice(n.length);
        const hit = await sql`${baseSelect(sql)} WHERE i.identifier_norm = ${rest} AND m.code = ${m.code} AND i.identifier_type IN ('canonical_sku','mfr_part_number','p21_item_id','shopify_sku')`;
        if (hit.length) { const seen = new Set<string>(); return hit.filter((r) => !seen.has(r.variantId) && seen.add(r.variantId)).map((r) => toMatch(r, "normalized")); }
      }
    }
  }
  // Stage 3: historical / superseded / alias / competitor identifiers
  const alt = await sql`${baseSelect(sql)} WHERE i.identifier_norm = ${norm} AND i.identifier_type IN ('historical_part_number','superseded_part_number','alias','competitor_part_number') ${mfrFilter}`;
  if (alt.length) return alt.map((r) => toMatch(r, r.identifierType === "competitor_part_number" ? "competitor_xref" : "historical"));

  if (!opts.allowFuzzy) return [];
  // Stage 3b: prefix (partial number) — only against primary identifiers
  const prefix = await sql`${baseSelect(sql)} WHERE i.identifier_norm LIKE ${norm + "%"} AND i.identifier_type IN ('canonical_sku','mfr_part_number') ${mfrFilter} ORDER BY length(i.identifier_norm) LIMIT ${limit}`;
  if (prefix.length) { const seen = new Set<string>(); return prefix.filter((r) => !seen.has(r.variantId) && seen.add(r.variantId)).map((r) => toMatch(r, "prefix")); }
  // Stage 3c: trigram similarity
  const fuzzy = await sql`${baseSelect(sql)}, similarity(i.identifier_norm, ${norm}) AS sim WHERE i.identifier_type IN ('canonical_sku','mfr_part_number') AND similarity(i.identifier_norm, ${norm}) > 0.45 ${mfrFilter} ORDER BY sim DESC LIMIT ${limit}`;
  const seen = new Set<string>();
  return fuzzy.filter((r) => !seen.has(r.variantId) && seen.add(r.variantId)).map((r) => toMatch(r, "fuzzy", Number(r.sim)));
}
