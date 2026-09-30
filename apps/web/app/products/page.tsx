import Link from "next/link";
import { lookupPartNumber, searchProductsText } from "@wpi/core";
import { db } from "@/lib/db";
import { Badge, statusTone } from "@/components/Badge";
import { Panel } from "@/components/DataTable";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim().slice(0, 200);
  const sql = db();
  let variantIds: string[] | null = null;
  let matchInfo = new Map<string, string>();
  if (query) {
    const byId = await lookupPartNumber(sql, query, { allowFuzzy: true, limit: 50 });
    const byText = await searchProductsText(sql, query, 50);
    matchInfo = new Map<string, string>();
    for (const m of byId) if (!matchInfo.has(m.variantId)) matchInfo.set(m.variantId, `${m.matchType}: ${m.matchedIdentifier}`);
    for (const t of byText) if (!matchInfo.has(t.variantId)) matchInfo.set(t.variantId, "text search");
    variantIds = [...matchInfo.keys()];
  }
  const rows = await sql`
    SELECT v.id, v.canonical_sku, v.name, v.status, p.category, m.name AS manufacturer, s.code AS series,
           (SELECT count(*) FROM knowledge_assertions a WHERE a.subject_id = v.id AND a.status IN ('verified','human_approved')) AS verified_assertions,
           (SELECT count(*) FROM knowledge_assertions a WHERE a.subject_id = v.id AND a.status IN ('pending','conflicting')) AS open_assertions,
           (SELECT string_agg(i.identifier_raw, ', ' ORDER BY i.identifier_type) FROM product_identifiers i WHERE i.variant_id = v.id AND i.identifier_type IN ('mfr_part_number','p21_item_id','shopify_sku')) AS identifiers
    FROM product_variants v JOIN products p ON p.id = v.product_id JOIN manufacturers m ON m.id = p.manufacturer_id LEFT JOIN product_series s ON s.id = p.series_id
    ${variantIds ? sql`WHERE v.id = ANY(${variantIds})` : sql``}
    ORDER BY m.name, v.canonical_sku LIMIT 500`;
  return (
    <div className="space-y-4">
      <h1>Products</h1>
      <form method="get" className="panel flex flex-wrap items-center gap-2 p-3">
        <input type="search" name="q" defaultValue={query} placeholder="part number, P21 item, Shopify SKU, competitor number, or text (e.g. stainless ball valve)" className="w-[32rem] max-w-full" />
        <button className="btn" type="submit">Search</button>
        {query ? <Link href="/products" className="text-slate-500">clear</Link> : null}
        <span className="text-slate-500">Identifier lookup is exact → normalized → historical/competitor → prefix/fuzzy; text search uses full-text over name/description.</span>
      </form>
      <Panel title={`${rows.length} variant${rows.length === 1 ? "" : "s"}${query ? ` matching "${query}"` : ""}`}>
        <table className="data">
          <thead><tr><th>SKU</th><th>Name</th><th>Manufacturer</th><th>Series</th><th>Category</th><th>Status</th><th>Other identifiers</th><th className="num">Verified</th><th className="num">Open</th>{query ? <th>Match</th> : null}</tr></thead>
          <tbody>{rows.length === 0 ? <tr><td colSpan={10} className="text-center text-slate-500">No products match.</td></tr> : rows.map((r) => (
            <tr key={r.id}><td><Link href={`/products/${encodeURIComponent(r.canonicalSku)}`} className="mono font-medium">{r.canonicalSku}</Link></td><td>{r.name}</td><td>{r.manufacturer}</td><td className="mono">{r.series ?? ""}</td><td>{r.category}</td><td><Badge tone={statusTone(r.status)}>{r.status}</Badge></td><td className="mono text-[11px] text-slate-600">{r.identifiers ?? ""}</td><td className="num">{r.verifiedAssertions}</td><td className="num">{r.openAssertions}</td>{query ? <td className="text-slate-600">{matchInfo.get(r.id)}</td> : null}</tr>
          ))}</tbody>
        </table>
      </Panel>
    </div>
  );
}
