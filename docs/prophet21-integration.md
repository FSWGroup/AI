# Prophet 21 Integration

Code: `/home/user/AI/packages/core/src/connectors/p21.ts`, `src/ingest/p21Sync.ts`, `src/ingest/reconcile.ts`, `src/agents/commercial.ts`. Fixture: `packages/core/fixtures/p21.json`.

Epicor Prophet 21 is the intended long-term system of record for inventory, cost, customer pricing, customers and orders. ValveMan is migrating its ERP to P21; until cutover, Shopify supplies the ecommerce price and online quantity as a fallback (see `shopify-integration.md`).

## Connector interface

```ts
interface P21Connector {
  readonly mode: "fixture" | "live";
  readonly label: string;
  asOf(): Promise<Date>;                       // snapshot time (fixture) or fetch time (live)
  listItems(): AsyncGenerator<P21Item>;
  listInventory(): AsyncGenerator<P21Inventory>;
  listCustomers(): AsyncGenerator<P21Customer>;
  listPrices(): AsyncGenerator<P21Price>;
}
```

| Entity | Fields |
|---|---|
| `P21Item` | `itemId`, `invMastUid`, `itemDesc`, `supplierPartNo`, `manufacturer`, `defaultUom`, `productGroup`, `deleteFlag` |
| `P21Inventory` | `itemId`, `locationId`, `qtyOnHand`, `qtyAllocated`, `qtyAvailable`, `qtyOnOrder`, `leadTimeDays` |
| `P21Customer` | `customerId`, `customerName`, `customerClass`, `state`, `salesrep`, `channel` (`welsford` / `valveman`) |
| `P21Price` | `itemId`, `priceType` (`list` / `customer_contract` / `ecommerce` / `cost`), `customerId` (null for non-contract), `channel`, `unitPrice`, `uom` |

## Fixture vs live

| | Fixture | Live |
|---|---|---|
| Class | `P21FixtureConnector` | `P21ApiConnector` |
| Selected when | default | `P21_BASE_URL` **and** `P21_API_TOKEN` set (`createP21Connector(env)`) |
| Data | `fixtures/p21.json`: `items` (19 incl. one deliberate duplicate `BVW-S70-200` with `delete_flag = "Y"`), `inventory` (location `MAIN`), `customers`, `prices` | `GET <P21_BASE_URL><path>` with `Authorization: Bearer <token>` |
| `asOf()` | `new Date()` at sync time (a fixture sync represents "now", exactly like a live pull) | `new Date()` |
| `sources.is_fixture` | true | false |
| Label | `Prophet 21 (DEV FIXTURE)` | `Prophet 21 API (<base url>)` |

### Live scaffold — unvalidated

The `P21ApiConnector` paths follow the P21 OData view naming but **have not been validated against a live tenant** (comment in `connectors/p21.ts`). Treat them as a scaffold to be verified during ValveMan cutover:

| Method | Path used | Known gaps |
|---|---|---|
| `listItems` | `/odataservice/odata4/views/p21_view_inv_mast?$select=item_id,inv_mast_uid,item_desc,delete_flag,default_sales_unit` | `supplierPartNo`, `manufacturer`, `productGroup` are returned as null |
| `listInventory` | `/odataservice/odata4/views/p21_view_inv_loc?$select=inv_mast_uid,location_id,qty_on_hand,qty_allocated,qty_on_order` | Yields `itemId = String(inv_mast_uid)`, while `runP21Sync` keys its item→variant map by `item_id`; live inventory rows will not join to items until this is reconciled. `qtyAvailable` computed as on_hand − allocated; `leadTimeDays` null |
| `listCustomers` | `/odataservice/odata4/views/p21_view_customer?$select=customer_id,customer_name,class_1id,delete_flag` | `state` null, `salesrep` null, `channel` hard-coded `welsford` — territory rules need `state` |
| `listPrices` | `/odataservice/odata4/views/p21_view_inv_mast?$select=item_id,list_price` | List price only; contract / library / cost pricing not read ("spread across price pages") |
| Paging | none | OData `$top`/`$skip`/`@odata.nextLink` not handled |

## Entities synced (`runP21Sync`)

One `sync_jobs` row (`system = 'p21'`, `job_type = 'item_master+inventory+pricing'`). A **new** `sources` row of type `p21` (authority 4) is inserted on every run.

| Step | Target | Details |
|---|---|---|
| Item master | `p21_mappings` (insert; duplicate `p21_item_id` → `sync_conflicts.duplicate_sku` and skip) | Mapping by `normalizeIdentifier(item_id)` against identifier types `canonical_sku`, `p21_item_id`, `mfr_part_number`; exactly one hit → `mapped` |
| | `source_records` (`p21:item:<id>`, text `"<id> <desc> UOM <uom>"`) and `product_identifiers` row of type `p21_item_id` | Only for mapped, non-deleted items |
| Inventory | `source_records` (`p21:inventory:<item>:<location>`, text with on hand / allocated / available / on order / lead time) + `inventory` upsert (`system = 'p21'`) | Only for items mapped in this run |
| Customers | `customers` upsert on `p21_customer_id` (name, class, state, channel, salesperson) | All customers |
| Prices | `source_records` (`p21:price:<item>:<type>:<customer or list>`, text `"<item> <type>[ for <customer>]: <price> USD / <uom>"`) + `customer_pricing` upsert (`system = 'p21'`) | Skipped when the item is unmapped or a contract price references an unknown customer |

Stats: `items`, `mapped`, `unmapped`, `duplicates`, `inventory`, `customers`, `prices`.

### Planned entities (schema exists, nothing syncs them)

| Entity | Schema hook |
|---|---|
| Purchase orders / receipts | none yet; `inventory.qty_on_order` is the only PO-derived figure |
| Quotes | `quotes.p21_quote_id`, `quote_lines.price_source_record_id` |
| Orders / invoices | none yet |
| Contract & library pricing, cost from live P21 | `customer_pricing.price_type` already supports `customer_contract` and `cost`; fixture supplies them, live scaffold does not |

## System-of-record rules by field

From the header of `agents/commercial.ts` and the pick logic in `pricingAgent` / `inventoryAgent`:

| Field | System of record | Fallback | How the agent chooses |
|---|---|---|---|
| Inventory (on hand, committed, available, on order, lead time) | P21 (`inventory.system = 'p21'`, all locations) | Shopify `online` quantity when no P21 row exists | `inventoryAgent`: `p21.length ? p21 : shopify` |
| List price (welsford channel) | P21 `list` | none | `pick("list")` prefers `system = 'p21'`, `customer_id IS NULL` |
| Customer contract price | P21 `customer_contract` for the resolved `customer_id` | none | only when a customer context exists; claim marked critical |
| Cost | P21 `cost` | none | only proposed when principal `can("view_cost")`; also removed by the gate for others |
| Ecommerce price (valveman channel) | P21 `ecommerce` when present | Shopify `ecommerce` (pre-cutover) | `pick("ecommerce")` prefers p21 |
| Customers (class, state, salesperson) | P21 | — | `customers` table; `state` feeds territory rules |
| Item identity | Catalog (`product_variants.canonical_sku`); P21 item id is an alias | — | `p21_item_id` identifier rows |
| Technical specifications | **Never P21** | — | `sourceTypeAllowedForPredicate` forbids `p21` for technical predicates |

Every commercial claim label states the system and the as-of time, e.g. `BVW-S70-200 list price: 189.00 USD/EA (P21, as of 2026-09-30T…)`; citations read `Prophet 21 p21:price:… (as of …)`.

## Cutover validation via the reconciliation report

`reconcileShopifyP21(sql, jobId)` produces and persists (`sync_conflicts`) the following; each is a cutover checklist item:

| Report key | Conflict type | Cutover meaning |
|---|---|---|
| `unmappedP21Items` | `missing_product` | P21 items with no catalog variant — create the variant or add a `p21_item_id` identifier |
| `unmappedShopifySkus` | `unmapped_sku` | Shopify variants without a catalog variant — fix SKU or add identifier |
| `duplicateSkus` | `duplicate_sku` | Same `item_id` twice in the item master (fixture: legacy `BVW-S70-200` record flagged deleted) — purge before go-live |
| `manufacturerMismatches` | `manufacturer_mismatch` | Shopify vendor / P21 manufacturer name disagree with the catalog manufacturer |
| `descriptionMismatches` | `description_mismatch` | Size token differs between Shopify title and P21 description |
| `priceDiscrepancies` | `price_discrepancy` | Shopify price ≠ P21 ecommerce price (> 0.005) |
| `missingInShopify` | (not persisted) | Mapped P21 item not listed online; annotated with whether the manufacturer has a `valveman` ecommerce rule |
| `uomConflicts` | `uom_conflict` | P21 UOM other than `EA` (fixture: `CVA-LS-2` is `BX`) — must be resolved before quantities/prices are quoted per unit |

Conflicts are `open` until worked in review (`status` resolved / ignored); there is no UI yet.

## Freshness

`freshnessWindowDays("p21") = 1`. A P21-backed claim is only citable if its `source_records.last_verified_at` (= the sync `asOf`) is within 24 hours of the question. Operationally this requires at least a daily sync; a stale snapshot makes pricing and inventory answers abstain (`removed_stale`) rather than serve old numbers.

## Environment

```
P21_BASE_URL=       # blank → fixture mode
P21_API_TOKEN=      # blank → fixture mode
```
