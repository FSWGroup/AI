import type { Sql } from "../db/client.ts";
import { maxAuthorityForCriticality, sourceTypeAllowedForPredicate, type SourceType } from "./authority.ts";

/**
 * product_attributes is a materialized projection of ANSWERABLE assertions used for structured filtering.
 * An assertion is projected only if:
 *   - status is verified or human_approved
 *   - no open knowledge conflict exists on (subject, predicate)
 *   - exactly one such assertion exists for the key (otherwise nothing is projected; a conflict should exist)
 *   - at least one evidence source satisfies the authority threshold for the attribute's criticality AND is a
 *     source type allowed for that predicate (same rules the answer gate applies)
 * It is rebuilt from assertions; it is never edited directly.
 */
export async function rebuildAttributeProjection(sql: Sql): Promise<number> {
  const rows = await sql`
    SELECT a.id, a.subject_id AS variant_id, a.predicate, a.value_text, a.value_number, a.value_number_max, a.unit, a.criticality,
           array_agg(DISTINCT s.source_type) FILTER (WHERE s.id IS NOT NULL) AS source_types,
           array_agg(DISTINCT s.authority_level) FILTER (WHERE s.id IS NOT NULL) AS authority_levels,
           bool_or(dv.is_current = false) AS has_superseded_only
    FROM knowledge_assertions a
    JOIN attribute_definitions d ON d.key = a.predicate
    LEFT JOIN assertion_evidence e ON e.assertion_id = a.id
    LEFT JOIN source_records r ON r.id = e.source_record_id
    LEFT JOIN sources s ON s.id = r.source_id
    LEFT JOIN document_versions dv ON dv.id = r.document_version_id
    WHERE a.subject_type = 'variant' AND a.status IN ('verified','human_approved')
      AND NOT EXISTS (SELECT 1 FROM knowledge_conflicts c WHERE c.status = 'open' AND c.subject_type = 'variant' AND c.subject_id = a.subject_id AND c.predicate = a.predicate)
    GROUP BY a.id`;
  const eligible = rows.filter((r) => {
    const types = (r.sourceTypes ?? []) as SourceType[];
    const levels = (r.authorityLevels ?? []) as number[];
    const max = maxAuthorityForCriticality(Number(r.criticality));
    return types.some((t, i) => sourceTypeAllowedForPredicate(r.predicate, t) && levels.some((l) => l <= max));
  });
  const perKey = new Map<string, typeof eligible>();
  for (const r of eligible) { const k = `${r.variantId}:${r.predicate}`; (perKey.get(k) ?? perKey.set(k, []).get(k)!).push(r); }
  await sql`DELETE FROM product_attributes`;
  let n = 0;
  for (const [, group] of perKey) {
    if (group.length !== 1) continue;
    const r = group[0];
    await sql`INSERT INTO product_attributes (variant_id, attribute_key, assertion_id, value_text, value_number, value_number_max, unit) VALUES (${r.variantId}, ${r.predicate}, ${r.id}, ${r.valueText}, ${r.valueNumber}, ${r.valueNumberMax}, ${r.unit})`;
    n++;
  }
  return n;
}
