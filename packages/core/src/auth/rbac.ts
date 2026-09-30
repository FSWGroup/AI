/**
 * Role-based access control enforced at the data/agent layer (never by prompt alone).
 * A Principal is resolved from a user row (or is the anonymous public principal for the ValveMan assistant).
 */
import type { Sql } from "../db/client.ts";

export interface Principal {
  userId: string | null;
  roleId: string;
  permissions: Set<string>;
  organizationSlug: "welsford" | "valveman" | null;
  customerId: string | null;   // for authenticated customers
  displayName: string;
}

export const PUBLIC_PRINCIPAL: Principal = { userId: null, roleId: "public", permissions: new Set(["view_public_inventory"]), organizationSlug: "valveman", customerId: null, displayName: "Anonymous" };

export async function loadPrincipalByEmail(sql: Sql, email: string): Promise<Principal | null> {
  const [u] = await sql`SELECT u.id, u.display_name, u.role_id, u.customer_id, r.permissions, o.slug FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN organizations o ON o.id = u.organization_id WHERE u.email = ${email}`;
  if (!u) return null;
  return { userId: u.id, roleId: u.roleId, permissions: new Set(u.permissions as string[]), organizationSlug: u.slug ?? null, customerId: u.customerId ?? null, displayName: u.displayName };
}

export function can(p: Principal, permission: string): boolean {
  return p.permissions.has(permission);
}

/** Predicates a principal may never receive; the answer gate removes claims on them (defense in depth). */
export function restrictedPredicatesFor(p: Principal, opts: { customerId?: string | null } = {}): Set<string> {
  const restricted = new Set<string>();
  if (!can(p, "view_cost")) { restricted.add("cost"); restricted.add("margin"); restricted.add("supplier_price"); }
  const ownCustomer = opts.customerId && p.customerId && opts.customerId === p.customerId;
  if (!can(p, "view_customer_pricing") && !(can(p, "view_own_pricing") && ownCustomer)) restricted.add("customer_contract_price");
  if (!can(p, "view_internal")) { restricted.add("internal_note"); restricted.add("supplier"); restricted.add("list_price"); }
  if (!can(p, "view_territory_rules")) restricted.add("territory_rule_detail");
  if (!can(p, "view_inventory") && !can(p, "view_public_inventory")) { restricted.add("qty_available"); restricted.add("qty_on_hand"); }
  if (!can(p, "view_inventory")) { restricted.add("qty_on_hand"); restricted.add("qty_committed"); restricted.add("qty_on_order"); }
  return restricted;
}

/** Which sales channel a principal is acting in. Welsford staff can act in either; public/customers only in valveman. */
export function allowedChannels(p: Principal): ("welsford" | "valveman")[] {
  if (p.roleId === "public" || p.roleId === "customer") return ["valveman"];
  return ["welsford", "valveman"];
}
