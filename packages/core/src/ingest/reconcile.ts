import type { Sql } from "../db/client.ts";

export interface ReconciliationReport {
  unmappedShopifySkus: { shopifyVariantId: string; sku: string | null; title: string }[];
  unmappedP21Items: { p21ItemId: string; itemDesc: string }[];
  duplicateSkus: { p21ItemId: string; details: unknown }[];
  manufacturerMismatches: { sku: string; shopifyVendor: string; p21Manufacturer: string | null }[];
  descriptionMismatches: { sku: string; shopifyTitle: string; p21Desc: string; reason: string }[];
  priceDiscrepancies: { sku: string; shopifyPrice: number; p21EcommercePrice: number }[];
  missingInShopify: { sku: string; p21ItemId: string; note: string }[];
  uomConflicts: { sku: string; p21Uom: string }[];
}

const sizeToken = (s: string): string | null => {
  const m = /(\d+(?:-\d+\/\d+)?|\d+\/\d+)\s*(?:"|in\b|inch)/i.exec(s) ?? /\bS\d+ (\d+(?:-\d+\/\d+)?|\d+\/\d+)\b/.exec(s);
  return m ? m[1] : null;
};

/** Shopify ↔ P21 reconciliation. Findings are persisted as sync_conflicts so they can be worked through review. */
export async function reconcileShopifyP21(sql: Sql, jobId?: string): Promise<ReconciliationReport> {
  const report: ReconciliationReport = { unmappedShopifySkus: [], unmappedP21Items: [], duplicateSkus: [], manufacturerMismatches: [], descriptionMismatches: [], priceDiscrepancies: [], missingInShopify: [], uomConflicts: [] };
  for (const r of await sql`SELECT shopify_variant_id, shopify_sku, title FROM shopify_mappings WHERE mapping_status <> 'mapped'`) report.unmappedShopifySkus.push({ shopifyVariantId: r.shopifyVariantId, sku: r.shopifySku, title: r.title });
  for (const r of await sql`SELECT p21_item_id, item_desc FROM p21_mappings WHERE mapping_status <> 'mapped'`) report.unmappedP21Items.push({ p21ItemId: r.p21ItemId, itemDesc: r.itemDesc });
  for (const r of await sql`SELECT p21_item_id, details FROM sync_conflicts WHERE conflict_type = 'duplicate_sku' AND status = 'open'`) report.duplicateSkus.push({ p21ItemId: r.p21ItemId, details: r.details });

  const joined = await sql`
    SELECT v.canonical_sku AS sku, s.vendor, s.title, s.price AS shopify_price, p.p21_item_id, p.item_desc, p.manufacturer_name, p.uom, m.name AS mfr_name, m.aliases,
           (SELECT unit_price FROM customer_pricing cp WHERE cp.variant_id = v.id AND cp.system = 'p21' AND cp.price_type = 'ecommerce' AND cp.customer_id IS NULL) AS p21_ecom_price
    FROM product_variants v
    JOIN products pr ON pr.id = v.product_id JOIN manufacturers m ON m.id = pr.manufacturer_id
    LEFT JOIN shopify_mappings s ON s.variant_id = v.id
    LEFT JOIN p21_mappings p ON p.variant_id = v.id AND p.mapping_status = 'mapped'`;
  for (const r of joined) {
    if (r.p21ItemId && !r.vendor) {
      const ecom = await sql`SELECT 1 FROM channel_rules cr JOIN products pr ON pr.manufacturer_id = cr.scope_id JOIN product_variants v ON v.product_id = pr.id WHERE v.canonical_sku = ${r.sku} AND cr.channel_id = 'valveman' AND cr.rule_type = 'ecommerce' AND cr.scope_type = 'manufacturer'`;
      report.missingInShopify.push({ sku: r.sku, p21ItemId: r.p21ItemId, note: ecom.length ? "ecommerce-eligible but not listed" : "not ecommerce-eligible (expected)" });
      continue;
    }
    if (!r.p21ItemId || !r.vendor) continue;
    const vendorNorm = String(r.vendor).toUpperCase();
    const mfrNames = [r.mfrName, ...(r.aliases as string[])].map((x) => String(x).toUpperCase());
    const vendorOk = mfrNames.includes(vendorNorm);
    const p21Ok = !r.manufacturerName || mfrNames.some((n) => String(r.manufacturerName).toUpperCase().startsWith(n.split(" ")[0]));
    if (!vendorOk || !p21Ok) report.manufacturerMismatches.push({ sku: r.sku, shopifyVendor: r.vendor, p21Manufacturer: r.manufacturerName });
    const a = sizeToken(String(r.title)); const b = sizeToken(String(r.itemDesc));
    if (a && b && a !== b) report.descriptionMismatches.push({ sku: r.sku, shopifyTitle: r.title, p21Desc: r.itemDesc, reason: `size token differs (${a} vs ${b})` });
    if (r.p21EcomPrice != null && r.shopifyPrice != null && Number(r.shopifyPrice) > 0 && Math.abs(Number(r.p21EcomPrice) - Number(r.shopifyPrice)) > 0.005) report.priceDiscrepancies.push({ sku: r.sku, shopifyPrice: Number(r.shopifyPrice), p21EcommercePrice: Number(r.p21EcomPrice) });
    if (r.uom && r.uom !== "EA") report.uomConflicts.push({ sku: r.sku, p21Uom: r.uom });
  }
  const persist = async (type: string, sku: string | null, details: unknown, shopifyVariantId?: string, p21ItemId?: string) => {
    const v = sku ? await sql`SELECT id FROM product_variants WHERE canonical_sku = ${sku}` : [];
    const existing = await sql`SELECT id FROM sync_conflicts WHERE conflict_type = ${type} AND status = 'open' AND details = ${sql.json(details as never)}`;
    if (existing.length) return;
    await sql`INSERT INTO sync_conflicts (sync_job_id, conflict_type, variant_id, shopify_variant_id, p21_item_id, details) VALUES (${jobId ?? null}, ${type}, ${v[0]?.id ?? null}, ${shopifyVariantId ?? null}, ${p21ItemId ?? null}, ${sql.json(details as never)})`;
  };
  for (const x of report.unmappedShopifySkus) await persist("unmapped_sku", null, x, x.shopifyVariantId);
  for (const x of report.unmappedP21Items) await persist("missing_product", null, x, undefined, x.p21ItemId);
  for (const x of report.missingInShopify.filter((m) => m.note.startsWith("ecommerce-eligible"))) await persist("missing_product", x.sku, x, undefined, x.p21ItemId);
  for (const x of report.manufacturerMismatches) await persist("manufacturer_mismatch", x.sku, x);
  for (const x of report.descriptionMismatches) await persist("description_mismatch", x.sku, x);
  for (const x of report.priceDiscrepancies) await persist("price_discrepancy", x.sku, x);
  for (const x of report.uomConflicts) await persist("uom_conflict", x.sku, x);
  return report;
}
