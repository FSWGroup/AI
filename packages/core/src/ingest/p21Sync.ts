import { createHash } from "node:crypto";
import type { Sql } from "../db/client.ts";
import type { P21Connector } from "../connectors/p21.ts";
import { normalizeIdentifier } from "../identifiers.ts";
import { AUTHORITY_BY_SOURCE_TYPE } from "../knowledge/authority.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Prophet 21 → p21_mappings, customers, customer_pricing (system = p21), inventory (system = p21). */
export async function runP21Sync(sql: Sql, connector: P21Connector): Promise<{ jobId: string; stats: Record<string, number> }> {
  const [job] = await sql`INSERT INTO sync_jobs (system, job_type, mode, status, started_at) VALUES ('p21', 'item_master+inventory+pricing', ${connector.mode}, 'running', now()) RETURNING id`;
  const stats = { items: 0, mapped: 0, unmapped: 0, duplicates: 0, inventory: 0, customers: 0, prices: 0 };
  const asOf = await connector.asOf();
  const [existingSrc] = await sql`SELECT id FROM sources WHERE source_type = 'p21' AND is_fixture = ${connector.mode === "fixture"} ORDER BY created_at LIMIT 1`;
  const src = existingSrc ?? (await sql`INSERT INTO sources (source_type, name, authority_level, is_fixture, notes) VALUES ('p21', ${connector.label}, ${AUTHORITY_BY_SOURCE_TYPE.p21}, ${connector.mode === "fixture"}, 'ERP system of record for inventory, cost, customer pricing') RETURNING id`)[0];
  const itemVariant = new Map<string, string>();
  try {
    for await (const item of connector.listItems()) {
      stats.items++;
      const norm = normalizeIdentifier(item.itemId);
      const match = await sql`SELECT DISTINCT variant_id FROM product_identifiers WHERE identifier_norm = ${norm} AND identifier_type IN ('canonical_sku','p21_item_id','mfr_part_number')`;
      const variantId = match.length === 1 ? match[0].variantId : null;
      const dup = await sql`SELECT id, p21_inv_mast_uid FROM p21_mappings WHERE p21_item_id = ${item.itemId}`;
      if (dup.length) {
        stats.duplicates++;
        await sql`INSERT INTO sync_conflicts (sync_job_id, conflict_type, variant_id, p21_item_id, details) VALUES (${job.id}, 'duplicate_sku', ${variantId}, ${item.itemId}, ${sql.json({ invMastUids: [dup[0].p21InvMastUid, item.invMastUid], deleteFlag: item.deleteFlag, itemDesc: item.itemDesc })})`;
        continue;
      }
      if (variantId) stats.mapped++; else stats.unmapped++;
      await sql`INSERT INTO p21_mappings (p21_item_id, p21_inv_mast_uid, variant_id, item_desc, supplier_part_number, manufacturer_name, uom, raw, mapping_status, last_synced_at)
        VALUES (${item.itemId}, ${String(item.invMastUid)}, ${variantId}, ${item.itemDesc}, ${item.supplierPartNo}, ${item.manufacturer}, ${item.defaultUom}, ${sql.json(item as never)}, ${variantId ? "mapped" : "unmapped"}, ${asOf})`;
      if (variantId) {
        itemVariant.set(item.itemId, variantId);
        if (item.deleteFlag) continue;
        const [rec] = await sql`INSERT INTO source_records (source_id, record_locator, extracted_text, structured, checksum, source_version, last_verified_at)
          VALUES (${src.id}, ${`p21:item:${item.itemId}`}, ${`${item.itemId} ${item.itemDesc} UOM ${item.defaultUom}`}, ${sql.json(item as never)}, ${sha(JSON.stringify(item))}, ${asOf.toISOString()}, ${asOf}) RETURNING id`;
        await sql`INSERT INTO product_identifiers (variant_id, identifier_type, identifier_raw, identifier_norm, is_primary, source_record_id) VALUES (${variantId}, 'p21_item_id', ${item.itemId}, ${norm}, false, ${rec.id}) ON CONFLICT DO NOTHING`;
      }
    }
    for await (const inv of connector.listInventory()) {
      const variantId = itemVariant.get(inv.itemId);
      if (!variantId) continue;
      const [rec] = await sql`INSERT INTO source_records (source_id, record_locator, extracted_text, structured, checksum, source_version, last_verified_at)
        VALUES (${src.id}, ${`p21:inventory:${inv.itemId}:${inv.locationId}`}, ${`${inv.itemId} @ ${inv.locationId}: on hand ${inv.qtyOnHand}, allocated ${inv.qtyAllocated}, available ${inv.qtyAvailable}, on order ${inv.qtyOnOrder}, lead time ${inv.leadTimeDays ?? "n/a"} days`}, ${sql.json(inv as never)}, ${sha(JSON.stringify(inv))}, ${asOf.toISOString()}, ${asOf}) RETURNING id`;
      await sql`INSERT INTO inventory (variant_id, system, location_code, qty_on_hand, qty_committed, qty_available, qty_on_order, lead_time_days, source_record_id, as_of)
        VALUES (${variantId}, 'p21', ${inv.locationId}, ${inv.qtyOnHand}, ${inv.qtyAllocated}, ${inv.qtyAvailable}, ${inv.qtyOnOrder}, ${inv.leadTimeDays}, ${rec.id}, ${asOf})
        ON CONFLICT (variant_id, system, location_code) DO UPDATE SET qty_on_hand = EXCLUDED.qty_on_hand, qty_committed = EXCLUDED.qty_committed, qty_available = EXCLUDED.qty_available, qty_on_order = EXCLUDED.qty_on_order, lead_time_days = EXCLUDED.lead_time_days, source_record_id = EXCLUDED.source_record_id, as_of = EXCLUDED.as_of`;
      stats.inventory++;
    }
    const customerIds = new Map<string, string>();
    for await (const c of connector.listCustomers()) {
      const [row] = await sql`INSERT INTO customers (p21_customer_id, name, customer_class, state, channel_id, salesperson) VALUES (${c.customerId}, ${c.customerName}, ${c.customerClass}, ${c.state}, ${c.channel}, ${c.salesrep})
        ON CONFLICT (p21_customer_id) DO UPDATE SET name = EXCLUDED.name, customer_class = EXCLUDED.customer_class, state = EXCLUDED.state RETURNING id`;
      customerIds.set(c.customerId, row.id);
      stats.customers++;
    }
    for await (const p of connector.listPrices()) {
      const variantId = itemVariant.get(p.itemId);
      if (!variantId) continue;
      const customerId = p.customerId ? customerIds.get(p.customerId) ?? null : null;
      if (p.customerId && !customerId) continue;
      const [rec] = await sql`INSERT INTO source_records (source_id, record_locator, extracted_text, structured, checksum, source_version, last_verified_at)
        VALUES (${src.id}, ${`p21:price:${p.itemId}:${p.priceType}:${p.customerId ?? "list"}`}, ${`${p.itemId} ${p.priceType}${p.customerId ? ` for ${p.customerId}` : ""}: ${p.unitPrice.toFixed(2)} USD / ${p.uom}`}, ${sql.json(p as never)}, ${sha(JSON.stringify(p))}, ${asOf.toISOString()}, ${asOf}) RETURNING id`;
      await sql`INSERT INTO customer_pricing (customer_id, channel_id, variant_id, price_type, system, unit_price, uom, source_record_id, as_of)
        VALUES (${customerId}, ${p.channel}, ${variantId}, ${p.priceType}, 'p21', ${p.unitPrice}, ${p.uom}, ${rec.id}, ${asOf})
        ON CONFLICT (system, channel_id, variant_id, price_type, coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO UPDATE SET unit_price = EXCLUDED.unit_price, source_record_id = EXCLUDED.source_record_id, as_of = EXCLUDED.as_of`;
      stats.prices++;
    }
    await sql`UPDATE sync_jobs SET status = 'succeeded', finished_at = now(), stats = ${sql.json(stats)} WHERE id = ${job.id}`;
  } catch (e) {
    await sql`UPDATE sync_jobs SET status = 'failed', finished_at = now(), error = ${String(e)} WHERE id = ${job.id}`;
    throw e;
  }
  return { jobId: job.id, stats };
}
