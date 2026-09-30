/**
 * Retrieval stage 4: structured attribute filtering over the verified projection (product_attributes).
 * Only verified, non-conflicting attributes exist in the projection, so a filter hit is itself evidence-backed.
 */
import type { Sql } from "../db/client.ts";

export type AttributeConstraint =
  | { key: string; op: "eq"; value: string }
  | { key: string; op: "in"; values: string[] }
  | { key: string; op: "gte" | "lte" | "num_eq"; value: number }
  | { key: string; op: "contains"; value: string };

export interface FilterHit {
  variantId: string;
  canonicalSku: string;
  name: string;
  manufacturerName: string;
  manufacturerCode: string;
  seriesCode: string | null;
  category: string;
  attributes: Record<string, { value: string; number: number | null; unit: string | null; assertionId: string }>;
}

export async function filterByAttributes(sql: Sql, constraints: AttributeConstraint[], opts: { limit?: number; manufacturerCode?: string | null } = {}): Promise<FilterHit[]> {
  const where = constraints.map((c) => {
    switch (c.op) {
      case "eq": return sql`EXISTS (SELECT 1 FROM product_attributes a WHERE a.variant_id = v.id AND a.attribute_key = ${c.key} AND lower(a.value_text) = ${c.value.toLowerCase()})`;
      case "in": return sql`EXISTS (SELECT 1 FROM product_attributes a WHERE a.variant_id = v.id AND a.attribute_key = ${c.key} AND lower(a.value_text) = ANY(${c.values.map((x) => x.toLowerCase())}))`;
      case "gte": return sql`EXISTS (SELECT 1 FROM product_attributes a WHERE a.variant_id = v.id AND a.attribute_key = ${c.key} AND a.value_number >= ${c.value})`;
      case "lte": return sql`EXISTS (SELECT 1 FROM product_attributes a WHERE a.variant_id = v.id AND a.attribute_key = ${c.key} AND a.value_number <= ${c.value})`;
      case "num_eq": return sql`EXISTS (SELECT 1 FROM product_attributes a WHERE a.variant_id = v.id AND a.attribute_key = ${c.key} AND abs(a.value_number - ${c.value}) < 1e-6)`;
      case "contains": return sql`EXISTS (SELECT 1 FROM product_attributes a WHERE a.variant_id = v.id AND a.attribute_key = ${c.key} AND lower(a.value_text) LIKE ${"%" + c.value.toLowerCase() + "%"})`;
    }
  });
  let clause = sql`TRUE`;
  for (const w of where) clause = sql`${clause} AND ${w}`;
  const rows = await sql`
    SELECT v.id AS variant_id, v.canonical_sku, v.name, m.name AS manufacturer_name, m.code AS manufacturer_code, s.code AS series_code, p.category,
      (SELECT json_object_agg(a.attribute_key, json_build_object('value', coalesce(a.value_text, a.value_number::text), 'number', a.value_number, 'unit', a.unit, 'assertionId', a.assertion_id)) FROM product_attributes a WHERE a.variant_id = v.id) AS attributes
    FROM product_variants v JOIN products p ON p.id = v.product_id JOIN manufacturers m ON m.id = p.manufacturer_id LEFT JOIN product_series s ON s.id = p.series_id
    WHERE v.status = 'active' AND ${clause} ${opts.manufacturerCode ? sql`AND m.code = ${opts.manufacturerCode}` : sql``}
    ORDER BY v.canonical_sku LIMIT ${opts.limit ?? 50}`;
  return rows.map((r) => ({ ...(r as unknown as FilterHit), attributes: Object.fromEntries(Object.entries((r.attributes ?? {}) as Record<string, any>).map(([k, v]) => [k, { ...v, number: v.number == null ? null : Number(v.number) }])) }));
}
