# Shopify Integration

Code: `/home/user/AI/packages/core/src/connectors/shopify.ts`, `src/ingest/shopifySync.ts`, `src/ingest/reconcile.ts`. Fixture: `packages/core/fixtures/shopify-products.json`.

## Connector interface

```ts
interface ShopifyConnector {
  readonly mode: "fixture" | "live";
  readonly label: string;
  listProducts(): AsyncGenerator<ShopifyProduct>;
}
```

`ShopifyProduct` fields: `id` (gid), `title`, `bodyHtml`, `vendor`, `productType`, `handle`, `status`, `tags[]`, `publishedAt`, `updatedAt`, `onlineStoreUrl`, `variants[]`, `images[]`, `metafields[] {namespace, key, value, type}`, `collections[]` (handles).

`ShopifyVariant` fields: `id` (gid), `sku`, `title`, `price`, `compareAtPrice`, `inventoryQuantity`, `inventoryPolicy`, `weight`, `weightUnit`, `barcode`, `selectedOptions[]`.

The rest of the platform only sees this interface; the sync job records `connector.mode` in `sync_jobs.mode`.

## Fixture vs live

| | Fixture | Live |
|---|---|---|
| Class | `ShopifyFixtureConnector` | `ShopifyAdminConnector` |
| Selected when | default | `SHOPIFY_SHOP_DOMAIN` **and** `SHOPIFY_ADMIN_ACCESS_TOKEN` set (`createShopifyConnector(env)`) |
| Data | `fixtures/shopify-products.json` — REST-shaped `products` payload, converted by `restProductToModel`; 6 products / 20 variants; fictional vendors | Admin GraphQL `POST https://<shop>/admin/api/<SHOPIFY_API_VERSION>/graphql.json`, header `X-Shopify-Access-Token`; API version default `2025-07` |
| Query | — | `PRODUCTS_QUERY`: `products(first: 50, after: $cursor)` with `collections(first: 20)`, `images(first: 10)`, `metafields(first: 50)`, `variants(first: 100)` incl. `inventoryItem.measurement.weight`; cursor pagination until `hasNextPage` is false |
| Label | `Shopify (DEV FIXTURE)` | `Shopify Admin API (<shop>)` |
| `sources.is_fixture` | true | false |
| Errors | — | non-2xx or GraphQL `errors` throw; the job is marked `failed` with the error text |

Fixture `onlineStoreUrl` is `https://valveman.example.invalid/products/<handle>`; fixture `collections` is always empty.

## What is synced (`runShopifySync`)

One `sync_jobs` row (`system = 'shopify'`, `job_type = 'products'`). One `sources` row of type `shopify` per mode is reused across runs (looked up by `source_type` + `is_fixture`).

Per variant:

| Target | Fields | Notes |
|---|---|---|
| `shopify_mappings` (upsert on `shopify_variant_id`) | shopify_product_id, shopify_variant_id, shopify_sku, variant_id, handle, title (`"<product title> — <variant title>"`), vendor, product_type, status, tags, price, compare_at_price, inventory_quantity, raw (product without variants + this variant), mapping_status, last_synced_at | Always written, mapped or not |
| `source_records` | `record_locator = shopify:variant:<gid>`, `extracted_text = "<title>: price <p>; inventory <q>; status <s>"`, `structured = {sku, price, compareAtPrice, inventoryQuantity, status, handle, url}`, `checksum = sha256(variant + updatedAt)`, `source_version = product.updatedAt`, `last_verified_at = sync time` | Only for mapped variants; a new record every run |
| `customer_pricing` (upsert) | `channel_id = 'valveman'`, `price_type = 'ecommerce'`, `system = 'shopify'`, `unit_price`, `uom = 'EA'`, `customer_id = NULL`, `as_of` | Only when `price > 0` (fixture RFQ-only butterfly valves are listed at 0.00 and produce no price row) |
| `inventory` (upsert) | `system = 'shopify'`, `location_code = 'online'`, `qty_on_hand = qty_available = inventoryQuantity`, `qty_committed = 0`, `as_of` | Only when `inventoryQuantity` is not null; a single presentation-level quantity, not per location |
| `knowledge_assertions` + `assertion_evidence` | For each metafield with `namespace = 'specs'`: predicate = key (`pressure_rating` is renamed to `pressure_rating_psi` and parsed as a leading number in psi), **status `pending`**, criticality from `attribute_definitions`, evidence method `api_sync`, `supporting_text = "metafield specs.<key> = <value>"` | Skipped if an assertion on that predicate with Shopify evidence already exists |

Stats returned: `products`, `variants`, `mapped`, `unmapped`, `pendingAssertions`.

## Mapping (how a Shopify variant becomes a catalog variant)

`normalizeIdentifier(variant.sku)` is compared with `product_identifiers.identifier_norm` for identifier types `canonical_sku`, `shopify_sku`, `mfr_part_number`:

| Matches | `mapping_status` | Effect |
|---|---|---|
| exactly 1 variant | `mapped` | source record, price, inventory, pending assertions written |
| > 1 | `ambiguous` | mapping row only |
| 0 or no SKU | `unmapped` | mapping row only |

The sync does **not** insert a `shopify_sku` identifier row; mapping relies on the Shopify SKU equalling the canonical SKU or manufacturer part number (the fixture uses canonical SKUs, e.g. `BVW-S70-050`). `mapping_status = 'conflict'` exists in the schema but is not set by code.

## What Shopify is and is not the system of record for

| Data | Shopify role | Where it is used |
|---|---|---|
| Merchandising copy, handle, tags, product type, online status, images | System of record for online presentation | `shopify_mappings` (informational); not answerable claims |
| Ecommerce price | Pre-cutover source for the ValveMan web price. `pricingAgent.pick()` prefers a `p21` row of the same price type; Shopify is used only when no P21 ecommerce price exists | `customer_pricing` rows cited with "Shopify … (synchronized <time>)" |
| Online inventory quantity | Fallback only: `inventoryAgent` uses P21 rows when any exist, else Shopify | `inventory` rows, location `online` |
| Technical specifications | **Never an authority.** `sourceTypeAllowedForPredicate` forbids `shopify` for every technical predicate; metafield specs are stored as `pending` assertions so `detectConflicts` can flag disagreements with manufacturer evidence (non-blocking review, `low_confidence_assertion`) | Never projected, never cited for specs |
| Customers / orders | Not synced (`customers.shopify_customer_id` column exists) | — |

Gate freshness for `shopify` records is 7 days (`freshnessWindowDays`), so a price or quantity from a sync older than a week cannot be cited.

## Reconciliation (`reconcileShopifyP21`)

Run after both syncs (in `seedAll`) and persisted to `sync_conflicts` (idempotent on identical `details`):

| Report key | `conflict_type` | Detection |
|---|---|---|
| `unmappedShopifySkus` | `unmapped_sku` | `shopify_mappings.mapping_status <> 'mapped'` |
| `unmappedP21Items` | `missing_product` | `p21_mappings.mapping_status <> 'mapped'` |
| `duplicateSkus` | `duplicate_sku` | open conflicts created by the P21 sync |
| `manufacturerMismatches` | `manufacturer_mismatch` | Shopify `vendor` not equal (case-insensitive) to the catalog manufacturer name/aliases; or P21 `manufacturer_name` not starting with the manufacturer's first word |
| `descriptionMismatches` | `description_mismatch` | size token (`1/2"`, `2 in`, `S70 200` style) differs between Shopify title and P21 description |
| `priceDiscrepancies` | `price_discrepancy` | Shopify price > 0 and differs from the P21 `ecommerce` list price by more than 0.005 |
| `missingInShopify` | (report only, not persisted) | Variant has a mapped P21 item but no Shopify mapping; note says whether the manufacturer has a `valveman` `ecommerce` rule ("ecommerce-eligible but not listed" vs. "not ecommerce-eligible (expected)") |
| `uomConflicts` | `uom_conflict` | P21 UOM ≠ `EA` |

## Environment

```
SHOPIFY_SHOP_DOMAIN=            # blank → fixture mode
SHOPIFY_ADMIN_ACCESS_TOKEN=     # blank → fixture mode
SHOPIFY_API_VERSION=2025-07
```

## Remaining for production (planned)

- **Webhooks** (`products/update`, `inventory_levels/update`, orders): nothing listens; today only full re-syncs via `runShopifySync`.
- **Collections**: fetched by the live query (`collections.nodes.handle`) but not stored or used; fixture returns none.
- **Media**: images are fetched and kept only inside `shopify_mappings.raw`.
- **Metafields beyond `specs.*`**: ignored.
- **Inventory levels per location**: only the aggregate `inventoryQuantity` is stored under `location_code = 'online'`; `inventoryLevels` / locations are not queried.
- **Customers and orders**: not synced.
- **Incremental sync**: no `updated_at` filtering; every run reads all products and appends a new `source_records` row per mapped variant.
- **Access scopes / rate limiting / retries**: not handled.
- **Ecommerce price after P21 cutover**: once P21 supplies `ecommerce` prices, Shopify price rows are superseded automatically by `pricingAgent.pick()`, and `priceDiscrepancies` in the reconciliation report becomes the control that the storefront matches the ERP.
