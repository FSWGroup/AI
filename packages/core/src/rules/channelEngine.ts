/**
 * Deterministic channel / territory rule engine.
 * Rules are rows in channel_rules scoped to manufacturer, family, series or variant. Resolution:
 *   1. collect rules for the variant's manufacturer/series/variant in the channel
 *   2. filter by territory (rule.territory NULL = anywhere, 'US-NATIONAL' = any US state) and customer class
 *   3. lowest priority number wins for authorization; other rule types are additive flags
 * An explanation is produced from the applied rule rows (each carries its source record), never from prose.
 */
import type { Sql } from "../db/client.ts";

export interface EligibilityInput { variantId: string; channelId: "welsford" | "valveman"; state?: string | null; customerClass?: string | null }
export interface AppliedRule { id: string; ruleType: string; scopeType: string; territoryCode: string | null; customerClass: string | null; priority: number; sourceRecordId: string | null; notes: string | null }
export interface EligibilityDecision {
  channelId: string;
  variantId: string;
  authorized: boolean | null;          // null = no rule found (unknown; must abstain)
  rfqOnly: boolean;
  ecommerce: boolean;
  pricingVisible: boolean;
  pricingLoginRequired: boolean;
  requiresApproval: boolean;
  appliedRules: AppliedRule[];
  territoryConsidered: string | null;
  explanation: string;
}

export async function decideEligibility(sql: Sql, input: EligibilityInput): Promise<EligibilityDecision> {
  const [scope] = await sql`SELECT v.id AS variant_id, p.manufacturer_id, p.series_id, p.family_id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ${input.variantId}`;
  if (!scope) throw new Error("variant not found");
  const territory = input.state ? `US-${input.state.toUpperCase()}` : null;
  const rules = await sql`
    SELECT id, rule_type, scope_type, territory_code, customer_class, priority, source_record_id, notes
    FROM channel_rules
    WHERE channel_id = ${input.channelId}
      AND ((scope_type = 'manufacturer' AND scope_id = ${scope.manufacturerId}) OR (scope_type = 'series' AND scope_id = ${scope.seriesId}) OR (scope_type = 'family' AND scope_id = ${scope.familyId}) OR (scope_type = 'variant' AND scope_id = ${scope.variantId}))
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY priority ASC, CASE scope_type WHEN 'variant' THEN 0 WHEN 'series' THEN 1 WHEN 'family' THEN 2 ELSE 3 END`;
  const territoryMatches = (code: string | null) => code == null || (territory != null && (code === territory || code === "US-NATIONAL"));
  const classMatches = (cls: string | null) => cls == null || (input.customerClass != null && cls === input.customerClass);
  const applicable = rules.filter((r) => classMatches(r.customerClass) && territoryMatches(r.territoryCode)).map((r) => r as unknown as AppliedRule);
  const authRules = applicable.filter((r) => r.ruleType === "authorized" || r.ruleType === "not_authorized");
  // territory-specific authorization rules exist but none matched the given state → not authorized in that state
  const hasTerritoryScopedAuth = rules.some((r) => r.ruleType === "authorized" && r.territoryCode != null);
  let authorized: boolean | null;
  if (authRules.length) authorized = authRules[0].ruleType === "authorized";           // lowest priority wins
  else if (hasTerritoryScopedAuth && territory) authorized = false;
  else if (rules.some((r) => r.ruleType === "not_authorized" && r.territoryCode == null)) authorized = false;
  else authorized = null;
  // When the state falls outside every territory-scoped authorization, the basis is that set of rules (they define the territory).
  const basisRules = authRules.length ? applicable : (authorized === false ? rules.filter((r) => r.ruleType === "authorized" && r.territoryCode != null || (r.ruleType === "not_authorized" && r.territoryCode == null)).map((r) => r as unknown as AppliedRule) : applicable);
  const flag = (t: string) => applicable.some((r) => r.ruleType === t);
  const decision: EligibilityDecision = {
    channelId: input.channelId, variantId: input.variantId, authorized,
    rfqOnly: flag("rfq_only"), ecommerce: flag("ecommerce"), pricingVisible: flag("pricing_visible") && !flag("pricing_login_required"),
    pricingLoginRequired: flag("pricing_login_required"), requiresApproval: flag("requires_approval"),
    appliedRules: basisRules, territoryConsidered: territory, explanation: "",
  };
  decision.explanation = explain(decision, hasTerritoryScopedAuth, input);
  return decision;
}

function explain(d: EligibilityDecision, territoryScoped: boolean, input: EligibilityInput): string {
  const ch = d.channelId === "welsford" ? "Welsford" : "ValveMan";
  if (d.authorized === null) return territoryScoped && !input.state ? `${ch} authorization for this product depends on the customer's state; no state was provided.` : `No ${ch} channel rule is encoded for this product; eligibility is unknown and requires human confirmation.`;
  const parts: string[] = [];
  parts.push(d.authorized ? `${ch} is authorized to sell this product${d.territoryConsidered ? ` in ${d.territoryConsidered.replace("US-", "")}` : ""}.` : `${ch} is NOT authorized to sell this product${d.territoryConsidered ? ` in ${d.territoryConsidered.replace("US-", "")}` : ""}.`);
  if (d.authorized) {
    if (d.rfqOnly) parts.push("Quotation is manual (RFQ only).");
    if (d.ecommerce) parts.push("Eligible for ecommerce sale.");
    if (d.pricingLoginRequired) parts.push("Pricing requires customer login."); else if (d.pricingVisible) parts.push("Pricing may be shown publicly.");
    if (d.requiresApproval) parts.push("Manager approval is required for this customer class.");
  }
  const basis = d.appliedRules.map((r) => r.notes).filter(Boolean);
  if (basis.length) parts.push(`Basis: ${[...new Set(basis)].join("; ")}.`);
  return parts.join(" ");
}
