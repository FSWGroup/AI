/**
 * Epicor Prophet 21 connector.
 *
 *   - P21FixtureConnector: reads fixtures/p21.json (DEV ONLY, mode = "fixture")
 *   - P21ApiConnector:     Prophet 21 REST/OData API (mode = "live"). Endpoint paths follow the P21 API
 *                          (/api/inventory/..., /odataservice/odata4/views/...) but have NOT been validated
 *                          against a live tenant; treat as a scaffold to be verified during ValveMan cutover.
 *
 * P21 is the intended long-term system of record for inventory, cost, customer pricing, customers, orders.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface P21Item { itemId: string; invMastUid: number; itemDesc: string; supplierPartNo: string | null; manufacturer: string | null; defaultUom: string; productGroup: string | null; deleteFlag: boolean }
export interface P21Inventory { itemId: string; locationId: string; qtyOnHand: number; qtyAllocated: number; qtyAvailable: number; qtyOnOrder: number; leadTimeDays: number | null }
export interface P21Customer { customerId: string; customerName: string; customerClass: string | null; state: string | null; salesrep: string | null; channel: "welsford" | "valveman" }
export interface P21Price { itemId: string; priceType: "list" | "customer_contract" | "ecommerce" | "cost"; customerId: string | null; channel: "welsford" | "valveman"; unitPrice: number; uom: string }

export interface P21Connector {
  readonly mode: "fixture" | "live";
  readonly label: string;
  /** timestamp the snapshot represents (fixture) or the fetch time (live) */
  asOf(): Promise<Date>;
  listItems(): AsyncGenerator<P21Item>;
  listInventory(): AsyncGenerator<P21Inventory>;
  listCustomers(): AsyncGenerator<P21Customer>;
  listPrices(): AsyncGenerator<P21Price>;
}

const here = dirname(fileURLToPath(import.meta.url));

export class P21FixtureConnector implements P21Connector {
  readonly mode = "fixture" as const;
  readonly label = "Prophet 21 (DEV FIXTURE)";
  private data: any;
  constructor(private readonly path = join(here, "..", "..", "fixtures", "p21.json")) {
    this.data = JSON.parse(readFileSync(this.path, "utf8"));
  }
  /** A fixture sync represents "now": the snapshot is taken at sync time, exactly like a live pull. */
  async asOf() { return new Date(); }
  async *listItems() {
    for (const i of this.data.items) yield { itemId: i.item_id, invMastUid: i.inv_mast_uid, itemDesc: i.item_desc, supplierPartNo: i.supplier_part_no ?? null, manufacturer: i.manufacturer ?? null, defaultUom: i.default_uom, productGroup: i.product_group ?? null, deleteFlag: i.delete_flag === "Y" } as P21Item;
  }
  async *listInventory() {
    for (const r of this.data.inventory) yield { itemId: r.item_id, locationId: r.location_id, qtyOnHand: r.qty_on_hand, qtyAllocated: r.qty_allocated, qtyAvailable: r.qty_available, qtyOnOrder: r.qty_on_order, leadTimeDays: r.lead_time_days ?? null } as P21Inventory;
  }
  async *listCustomers() {
    for (const c of this.data.customers) yield { customerId: c.customer_id, customerName: c.customer_name, customerClass: c.customer_class ?? null, state: c.state ?? null, salesrep: c.salesrep ?? null, channel: c.channel } as P21Customer;
  }
  async *listPrices() {
    for (const p of this.data.prices) yield { itemId: p.item_id, priceType: p.price_type, customerId: p.customer_id ?? null, channel: p.channel, unitPrice: Number(p.unit_price), uom: p.uom } as P21Price;
  }
}

/** Live scaffold. Each method issues an authenticated request and maps the response; paths must be validated at cutover. */
export class P21ApiConnector implements P21Connector {
  readonly mode = "live" as const;
  readonly label: string;
  private uidToItemId = new Map<string, string>();
  constructor(private readonly baseUrl: string, private readonly token: string) { this.label = `Prophet 21 API (${baseUrl})`; }
  async asOf() { return new Date(); }
  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" } });
    if (!res.ok) throw new Error(`P21 API ${res.status} for ${path}: ${await res.text()}`);
    return (await res.json()) as T;
  }
  async *listItems() {
    const rows = await this.get<{ value: any[] }>(`/odataservice/odata4/views/p21_view_inv_mast?$select=item_id,inv_mast_uid,item_desc,delete_flag,default_sales_unit`);
    for (const r of rows.value) { this.uidToItemId.set(String(r.inv_mast_uid), r.item_id); yield { itemId: r.item_id, invMastUid: r.inv_mast_uid, itemDesc: r.item_desc, supplierPartNo: null, manufacturer: null, defaultUom: r.default_sales_unit ?? "EA", productGroup: null, deleteFlag: r.delete_flag === "Y" } as P21Item; }
  }
  async *listInventory() {
    const rows = await this.get<{ value: any[] }>(`/odataservice/odata4/views/p21_view_inv_loc?$select=inv_mast_uid,location_id,qty_on_hand,qty_allocated,qty_on_order`);
    if (!this.uidToItemId.size) for await (const _ of this.listItems()) { /* populate uid → item_id map */ }
    for (const r of rows.value) yield { itemId: this.uidToItemId.get(String(r.inv_mast_uid)) ?? String(r.inv_mast_uid), locationId: String(r.location_id), qtyOnHand: r.qty_on_hand, qtyAllocated: r.qty_allocated, qtyAvailable: r.qty_on_hand - r.qty_allocated, qtyOnOrder: r.qty_on_order, leadTimeDays: null } as P21Inventory;
  }
  async *listCustomers() {
    const rows = await this.get<{ value: any[] }>(`/odataservice/odata4/views/p21_view_customer?$select=customer_id,customer_name,class_1id,delete_flag`);
    for (const r of rows.value) if (r.delete_flag !== "Y") yield { customerId: String(r.customer_id), customerName: r.customer_name, customerClass: r.class_1id ?? null, state: null, salesrep: null, channel: "welsford" } as P21Customer;
  }
  async *listPrices() {
    // Contract / library pricing in P21 is spread across price pages; this scaffold reads the item list price only.
    const rows = await this.get<{ value: any[] }>(`/odataservice/odata4/views/p21_view_inv_mast?$select=item_id,list_price`);
    for (const r of rows.value) if (r.list_price != null) yield { itemId: r.item_id, priceType: "list", customerId: null, channel: "welsford", unitPrice: Number(r.list_price), uom: "EA" } as P21Price;
  }
}

export function createP21Connector(env = process.env): P21Connector {
  if (env.P21_BASE_URL && env.P21_API_TOKEN) return new P21ApiConnector(env.P21_BASE_URL, env.P21_API_TOKEN);
  return new P21FixtureConnector();
}
