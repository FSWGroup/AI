/** Retrieval stages 6-7: Postgres full-text search over products and document pages; vector retrieval is an optional adapter. */
import type { Sql } from "../db/client.ts";

export interface ProductTextHit { variantId: string; canonicalSku: string; name: string; rank: number }
export interface PageHit { sourceRecordId: string; documentTitle: string; documentNumber: string | null; revision: string; pageNumber: number; documentType: string; snippet: string; rank: number; isCurrent: boolean; manufacturerCode: string | null }

export async function searchProductsText(sql: Sql, query: string, limit = 20): Promise<ProductTextHit[]> {
  const rows = await sql`
    SELECT v.id AS variant_id, v.canonical_sku, v.name, ts_rank(p.search_tsv, q) AS rank
    FROM products p JOIN product_variants v ON v.product_id = p.id, plainto_tsquery('english', ${query}) q
    WHERE p.search_tsv @@ q ORDER BY rank DESC LIMIT ${limit}`;
  return rows.map((r) => ({ variantId: r.variantId, canonicalSku: r.canonicalSku, name: r.name, rank: Number(r.rank) }));
}

export async function searchDocumentPages(sql: Sql, query: string, opts: { manufacturerCode?: string | null; documentType?: string | null; currentOnly?: boolean; limit?: number } = {}): Promise<PageHit[]> {
  const rows = await sql`
    SELECT r.id AS source_record_id, d.title AS document_title, d.document_number, dv.revision, pg.page_number, d.document_type, dv.is_current, m.code AS manufacturer_code,
           ts_headline('english', pg.text, q, 'MaxFragments=2, MaxWords=25, MinWords=8') AS snippet, ts_rank(pg.search_tsv, q) AS rank
    FROM document_pages pg
    JOIN document_versions dv ON dv.id = pg.document_version_id
    JOIN documents d ON d.id = dv.document_id
    LEFT JOIN manufacturers m ON m.id = d.manufacturer_id
    JOIN source_records r ON r.document_version_id = dv.id AND r.page_number = pg.page_number,
    plainto_tsquery('english', ${query}) q
    WHERE pg.search_tsv @@ q
      ${opts.currentOnly === false ? sql`` : sql`AND dv.is_current`}
      ${opts.manufacturerCode ? sql`AND m.code = ${opts.manufacturerCode}` : sql``}
      ${opts.documentType ? sql`AND d.document_type = ${opts.documentType}` : sql``}
    ORDER BY rank DESC LIMIT ${opts.limit ?? 10}`;
  return rows.map((r) => ({ ...(r as unknown as PageHit), rank: Number(r.rank) }));
}

/** Vector retrieval adapter. Disabled unless pgvector is installed and embeddings are configured; never used as evidence. */
export interface VectorRetriever { enabled: boolean; search(query: string, limit: number): Promise<PageHit[]> }
export const disabledVectorRetriever: VectorRetriever = { enabled: false, async search() { return []; } };
