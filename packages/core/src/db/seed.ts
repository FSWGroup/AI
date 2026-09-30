import { fileURLToPath } from "node:url";
import { getSql, closeSql } from "./client.ts";
import { seedCatalog } from "../ingest/seedCatalog.ts";
import { runShopifySync } from "../ingest/shopifySync.ts";
import { runP21Sync } from "../ingest/p21Sync.ts";
import { reconcileShopifyP21 } from "../ingest/reconcile.ts";
import { createShopifyConnector } from "../connectors/shopify.ts";
import { createP21Connector } from "../connectors/p21.ts";
import { detectConflicts } from "../knowledge/conflicts.ts";
import { rebuildAttributeProjection } from "../knowledge/projection.ts";
import { loadGoldenDataset } from "../eval/dataset.ts";

export async function seedAll(): Promise<void> {
  const sql = getSql();
  const existing = await sql`SELECT count(*)::int AS n FROM manufacturers`;
  if (existing[0].n > 0) throw new Error("Database already seeded; run db:reset first");
  await seedCatalog(sql);
  const shopify = createShopifyConnector();
  const p21 = createP21Connector();
  const s = await runShopifySync(sql, shopify);
  const p = await runP21Sync(sql, p21);
  await detectConflicts(sql);
  await rebuildAttributeProjection(sql);
  const report = await reconcileShopifyP21(sql, p.jobId);
  const cases = await loadGoldenDataset(sql);
  console.log(`Seeded catalog. Shopify [${shopify.mode}]: ${JSON.stringify(s.stats)}. P21 [${p21.mode}]: ${JSON.stringify(p.stats)}.`);
  console.log(`Reconciliation: ${Object.entries(report).map(([k, v]) => `${k}=${(v as unknown[]).length}`).join(", ")}`);
  console.log(`Golden dataset loaded: ${cases} cases`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedAll().then(() => closeSql()).catch((e) => { console.error(e); process.exit(1); });
}
