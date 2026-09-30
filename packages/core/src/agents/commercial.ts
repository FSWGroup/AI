/**
 * Pricing and inventory agents. System-of-record rules (docs/prophet21-integration.md):
 *   ERP inventory & customer/contract/list pricing & cost → Prophet 21
 *   Ecommerce price → Prophet 21 when a P21 ecommerce price exists, else Shopify (pre-cutover)
 * Answers always state the system and the as-of time of the record cited.
 */
import type { AgentContext } from "./context.ts";
import { gate, buildAnswer, recordRun, trace, restricted, channelDenied } from "./context.ts";
import type { Answer, ProposedClaim } from "../answer/types.ts";
import { identityClaims, resolveVariant } from "./partLookup.ts";
import { can } from "../auth/rbac.ts";

export async function pricingAgent(ctx: AgentContext, params: { partNumber: string; channel?: "welsford" | "valveman"; customerId?: string | null; customerP21Id?: string | null }): Promise<Answer> {
  const t0 = Date.now();
  const channel = params.channel ?? ctx.channelId;
  let customerId = params.customerId ?? ctx.customerId ?? null;
  if (!customerId && params.customerP21Id) customerId = (await ctx.sql`SELECT id FROM customers WHERE p21_customer_id = ${params.customerP21Id}`)[0]?.id ?? null;
  const question = `Price for ${params.partNumber} (${channel}${customerId ? `, customer ${params.customerP21Id ?? customerId}` : ""})`;
  const denied = await channelDenied(ctx, "pricing", question, channel); if (denied) return denied;
  const blocked = restricted(ctx);
  const match = await resolveVariant(ctx, params.partNumber);
  if (!match) return abstainNoPart(ctx, "pricing", question, params.partNumber, t0);
  const rows = await trace(ctx, "pricing_lookup", { sku: match.canonicalSku, channel, customerId }, () => ctx.sql`
    SELECT cp.price_type, cp.system, cp.unit_price, cp.uom, cp.currency, cp.as_of, cp.source_record_id, cp.customer_id, c.name AS customer_name, c.p21_customer_id
    FROM customer_pricing cp LEFT JOIN customers c ON c.id = cp.customer_id
    WHERE cp.variant_id = ${match.variantId} AND cp.channel_id = ${channel} AND (cp.customer_id IS NULL OR cp.customer_id = ${customerId})
    ORDER BY cp.price_type, cp.system`, (r) => r.length);
  const claims: ProposedClaim[] = [...identityClaims(match)];
  const pick = (type: string) => { const p21 = rows.find((r) => r.priceType === type && r.system === "p21" && r.customerId == null); return p21 ?? rows.find((r) => r.priceType === type && r.customerId == null) ?? null; };
  const list = pick("list"), ecom = pick("ecommerce"), cost = pick("cost");
  const contract = customerId ? rows.find((r) => r.priceType === "customer_contract" && r.customerId === customerId) ?? null : null;
  const add = (row: typeof rows[number] | null, predicate: string, label: string, critical = false) => {
    if (!row || blocked.has(predicate)) return;
    claims.push({ subjectRef: match.canonicalSku, predicate, value: Number(row.unitPrice).toFixed(2), unit: `${row.currency}/${row.uom}`, criticality: 2, kind: "commercial", critical,
      support: { sourceRecordIds: [row.sourceRecordId] }, label: `${match.canonicalSku} ${label}: ${Number(row.unitPrice).toFixed(2)} ${row.currency}/${row.uom} (${row.system.toUpperCase()}, as of ${new Date(row.asOf).toISOString()})` });
  };
  if (channel === "welsford") add(list, "list_price", "list price");
  if (channel === "valveman") add(ecom, "ecommerce_price", "ValveMan web price", !customerId);
  add(contract, "customer_contract_price", `contract price for ${contract?.customerName ?? "customer"}`, !!customerId);
  if (can(ctx.principal, "view_cost")) add(cost, "cost", "cost");
  const g = await gate(ctx, claims);
  const priceClaims = g.claims.filter((c) => c.kind === "commercial");
  if (!priceClaims.some((c) => c.status === "verified")) { g.outcome = "abstained"; g.confidence = "INSUFFICIENT_EVIDENCE"; }
  const answer = buildAnswer({
    agent: "pricing", question, input: { partNumber: params.partNumber, channel, customerP21Id: params.customerP21Id ?? null }, criticality: 2, gate: g,
    data: { sku: match.canonicalSku, channel, customerId, prices: priceClaims.filter((c) => c.status === "verified").map((c) => ({ type: c.predicate, price: c.value, unit: c.unit, citations: c.citations })) },
    unknown: priceClaims.some((c) => c.status === "verified") ? undefined : [customerId ? `No verified ${channel} price record exists for ${match.canonicalSku} for this customer` : `No verified ${channel} price record exists for ${match.canonicalSku}`],
    resolvingSources: ["Prophet 21 price library / customer contract for this item"],
    humanReview: g.outcome !== "answered",
  });
  await recordRun(ctx, answer, Date.now() - t0);
  return answer;
}

export async function inventoryAgent(ctx: AgentContext, params: { partNumber: string }): Promise<Answer> {
  const t0 = Date.now();
  const question = `Inventory / availability for ${params.partNumber}`;
  const match = await resolveVariant(ctx, params.partNumber);
  if (!match) return abstainNoPart(ctx, "inventory", question, params.partNumber, t0);
  const rows = await trace(ctx, "inventory_lookup", { sku: match.canonicalSku }, () => ctx.sql`SELECT * FROM inventory WHERE variant_id = ${match.variantId} ORDER BY system, location_code`, (r) => r.length);
  const claims: ProposedClaim[] = [...identityClaims(match)];
  const blocked = restricted(ctx);
  const p21 = rows.filter((r) => r.system === "p21");
  const chosen = p21.length ? p21 : rows.filter((r) => r.system === "shopify");
  for (const r of chosen) {
    const asOf = new Date(r.asOf).toISOString();
    const loc = `${r.system.toUpperCase()} ${r.locationCode}`;
    claims.push({ subjectRef: match.canonicalSku, predicate: "qty_available", value: String(Number(r.qtyAvailable)), criticality: 2, kind: "commercial", critical: true, support: { sourceRecordIds: [r.sourceRecordId] }, label: `${match.canonicalSku} available quantity at ${loc}: ${Number(r.qtyAvailable)} (as of ${asOf})` });
    if (r.system === "p21" && !blocked.has("qty_on_hand")) {
      claims.push({ subjectRef: match.canonicalSku, predicate: "qty_on_hand", value: String(Number(r.qtyOnHand)), criticality: 2, kind: "commercial", support: { sourceRecordIds: [r.sourceRecordId] }, label: `${match.canonicalSku} on hand at ${loc}: ${Number(r.qtyOnHand)}` });
      claims.push({ subjectRef: match.canonicalSku, predicate: "qty_committed", value: String(Number(r.qtyCommitted)), criticality: 2, kind: "commercial", support: { sourceRecordIds: [r.sourceRecordId] }, label: `${match.canonicalSku} allocated at ${loc}: ${Number(r.qtyCommitted)}` });
      claims.push({ subjectRef: match.canonicalSku, predicate: "qty_on_order", value: String(Number(r.qtyOnOrder)), criticality: 2, kind: "commercial", support: { sourceRecordIds: [r.sourceRecordId] }, label: `${match.canonicalSku} on order: ${Number(r.qtyOnOrder)}` });
      if (r.leadTimeDays != null) claims.push({ subjectRef: match.canonicalSku, predicate: "lead_time_days", value: String(r.leadTimeDays), criticality: 2, kind: "commercial", support: { sourceRecordIds: [r.sourceRecordId] }, label: `${match.canonicalSku} replenishment lead time: ${r.leadTimeDays} days` });
    }
  }
  const g = await gate(ctx, claims);
  if (!g.claims.some((c) => c.kind === "commercial" && c.status === "verified")) { g.outcome = "abstained"; g.confidence = "INSUFFICIENT_EVIDENCE"; }
  const answer = buildAnswer({
    agent: "inventory", question, input: { partNumber: params.partNumber }, criticality: 2, gate: g,
    data: { sku: match.canonicalSku, system: chosen[0]?.system ?? null, locations: g.claims.filter((c) => c.kind === "commercial" && c.status === "verified").map((c) => ({ predicate: c.predicate, value: c.value, citations: c.citations })) },
    unknown: chosen.length ? undefined : [`No synchronized inventory record exists for ${match.canonicalSku}`],
    resolvingSources: ["Prophet 21 inventory snapshot for this item"],
  });
  await recordRun(ctx, answer, Date.now() - t0);
  return answer;
}

async function abstainNoPart(ctx: AgentContext, agent: string, question: string, partNumber: string, t0: number): Promise<Answer> {
  const g = await gate(ctx, []); g.outcome = "abstained"; g.confidence = "INSUFFICIENT_EVIDENCE";
  const answer = buildAnswer({ agent, question, input: { partNumber }, criticality: 2, gate: g, unknown: [`"${partNumber}" does not resolve to exactly one verified catalog item`], resolvingSources: ["P21 item master / manufacturer part list"], humanReview: true });
  await recordRun(ctx, answer, Date.now() - t0);
  return answer;
}
