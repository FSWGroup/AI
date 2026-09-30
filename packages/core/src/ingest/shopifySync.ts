import { createHash } from "node:crypto";
import type { Sql } from "../db/client.ts";
import type { ShopifyConnector } from "../connectors/shopify.ts";
import { normalizeIdentifier } from "../identifiers.ts";
import { AUTHORITY_BY_SOURCE_TYPE } from "../knowledge/authority.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Shopify → shopify_mappings + source_records + ecommerce price + presentation inventory.
 * Shopify is the system of record for merchandising copy and online visibility. It is NOT a technical authority:
 * nothing here creates a verified technical assertion. Metafield specs are captured as `pending` assertions so
 * that the conflict detector can surface disagreements with manufacturer evidence.
 */
export async function runShopifySync(sql: Sql, connector: ShopifyConnector): Promise<{ jobId: string; stats: Record<string, number> }> {
  const [job] = await sql`INSERT INTO sync_jobs (system, job_type, mode, status, started_at) VALUES ('shopify', 'products', ${connector.mode}, 'running', now()) RETURNING id`;
  const stats = { products: 0, variants: 0, mapped: 0, unmapped: 0, pendingAssertions: 0 };
  const [source] = await sql`SELECT id FROM sources WHERE source_type = 'shopify' AND is_fixture = ${connector.mode === "fixture"} ORDER BY created_at LIMIT 1`;
  const sourceId = source?.id ?? (await sql`INSERT INTO sources (source_type, name, authority_level, is_fixture, notes) VALUES ('shopify', ${connector.label}, ${AUTHORITY_BY_SOURCE_TYPE.shopify}, ${connector.mode === "fixture"}, 'Merchandising copy; not a technical authority') RETURNING id`)[0].id;
  const now = new Date();
  try {
    for await (const p of connector.listProducts()) {
      stats.products++;
      for (const v of p.variants) {
        stats.variants++;
        const norm = v.sku ? normalizeIdentifier(v.sku) : null;
        const match = norm ? await sql`SELECT DISTINCT variant_id FROM product_identifiers WHERE identifier_norm = ${norm} AND identifier_type IN ('canonical_sku','shopify_sku','mfr_part_number')` : [];
        const variantId = match.length === 1 ? match[0].variantId : null;
        const mappingStatus = match.length === 1 ? "mapped" : match.length > 1 ? "ambiguous" : "unmapped";
        if (variantId) stats.mapped++; else stats.unmapped++;
        const raw = { product: { ...p, variants: undefined }, variant: v };
        await sql`INSERT INTO shopify_mappings (shopify_product_id, shopify_variant_id, shopify_sku, variant_id, handle, title, vendor, product_type, status, tags, price, compare_at_price, inventory_quantity, raw, mapping_status, last_synced_at)
          VALUES (${p.id}, ${v.id}, ${v.sku}, ${variantId}, ${p.handle}, ${`${p.title} — ${v.title}`}, ${p.vendor}, ${p.productType}, ${p.status}, ${sql.array(p.tags)}, ${v.price}, ${v.compareAtPrice}, ${v.inventoryQuantity}, ${sql.json(raw as never)}, ${mappingStatus}, ${now})
          ON CONFLICT (shopify_variant_id) DO UPDATE SET variant_id = EXCLUDED.variant_id, title = EXCLUDED.title, vendor = EXCLUDED.vendor, product_type = EXCLUDED.product_type, status = EXCLUDED.status, tags = EXCLUDED.tags, price = EXCLUDED.price, compare_at_price = EXCLUDED.compare_at_price, inventory_quantity = EXCLUDED.inventory_quantity, raw = EXCLUDED.raw, mapping_status = EXCLUDED.mapping_status, last_synced_at = EXCLUDED.last_synced_at`;
        if (!variantId) continue;
        const [rec] = await sql`INSERT INTO source_records (source_id, record_locator, extracted_text, structured, checksum, source_version, last_verified_at)
          VALUES (${sourceId}, ${`shopify:variant:${v.id}`}, ${`${p.title} — ${v.title}: price ${v.price}; inventory ${v.inventoryQuantity}; status ${p.status}`}, ${sql.json({ sku: v.sku, price: v.price, compareAtPrice: v.compareAtPrice, inventoryQuantity: v.inventoryQuantity, status: p.status, handle: p.handle, url: p.onlineStoreUrl })}, ${sha(JSON.stringify(v) + p.updatedAt)}, ${p.updatedAt}, ${now}) RETURNING id`;
        if (Number(v.price) > 0) {
          await sql`INSERT INTO customer_pricing (customer_id, channel_id, variant_id, price_type, system, unit_price, uom, source_record_id, as_of)
            VALUES (NULL, 'valveman', ${variantId}, 'ecommerce', 'shopify', ${v.price}, 'EA', ${rec.id}, ${now})
            ON CONFLICT (system, channel_id, variant_id, price_type, coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO UPDATE SET unit_price = EXCLUDED.unit_price, source_record_id = EXCLUDED.source_record_id, as_of = EXCLUDED.as_of`;
        }
        if (v.inventoryQuantity != null) {
          await sql`INSERT INTO inventory (variant_id, system, location_code, qty_on_hand, qty_committed, qty_available, source_record_id, as_of)
            VALUES (${variantId}, 'shopify', 'online', ${v.inventoryQuantity}, 0, ${v.inventoryQuantity}, ${rec.id}, ${now})
            ON CONFLICT (variant_id, system, location_code) DO UPDATE SET qty_on_hand = EXCLUDED.qty_on_hand, qty_available = EXCLUDED.qty_available, source_record_id = EXCLUDED.source_record_id, as_of = EXCLUDED.as_of`;
        }
        // Metafield specs → pending assertions (never verified from Shopify alone)
        for (const m of p.metafields.filter((m) => m.namespace === "specs")) {
          const key = m.key === "pressure_rating" ? "pressure_rating_psi" : m.key;
          const num = /^(\d+(?:\.\d+)?)/.exec(m.value);
          const isPressure = key === "pressure_rating_psi";
          const existing = await sql`SELECT a.id FROM knowledge_assertions a JOIN assertion_evidence e ON e.assertion_id = a.id JOIN source_records r ON r.id = e.source_record_id WHERE a.subject_id = ${variantId} AND a.predicate = ${key} AND r.source_id = ${sourceId}`;
          if (existing.length) continue;
          const [as] = await sql`INSERT INTO knowledge_assertions (subject_type, subject_id, predicate, value_text, value_number, unit, status, criticality)
            VALUES ('variant', ${variantId}, ${key}, ${isPressure ? null : m.value}, ${isPressure && num ? Number(num[1]) : null}, ${isPressure ? "psi" : null}, 'pending', ${(await sql`SELECT criticality FROM attribute_definitions WHERE key = ${key}`)[0]?.criticality ?? 1}) RETURNING id`;
          await sql`INSERT INTO assertion_evidence (assertion_id, source_record_id, supporting_text, extraction_method) VALUES (${as.id}, ${rec.id}, ${`metafield specs.${m.key} = ${m.value}`}, 'api_sync')`;
          stats.pendingAssertions++;
        }
      }
    }
    await sql`UPDATE sync_jobs SET status = 'succeeded', finished_at = now(), stats = ${sql.json(stats)} WHERE id = ${job.id}`;
  } catch (e) {
    await sql`UPDATE sync_jobs SET status = 'failed', finished_at = now(), error = ${String(e)} WHERE id = ${job.id}`;
    throw e;
  }
  return { jobId: job.id, stats };
}
