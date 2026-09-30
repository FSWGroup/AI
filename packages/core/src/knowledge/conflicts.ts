import type { Sql } from "../db/client.ts";
import { maxAuthorityForCriticality, sourceTypeAllowedForPredicate, type SourceType } from "./authority.ts";
import { rebuildAttributeProjection } from "./projection.ts";

/**
 * Detect knowledge conflicts.
 *
 * A BLOCKING conflict exists when two or more assertions on the same (subject, predicate) carry different values and
 * each is supported by at least one source that is allowed to support that predicate (see authority.ts). The assertions
 * are marked `conflicting`, an open knowledge_conflict is created and routed to review. Nothing picks a winner.
 *
 * A NON-BLOCKING disagreement exists when an ineligible source (e.g. Shopify merchandising copy for a pressure rating)
 * disagrees with eligible evidence. The verified assertion stays answerable; a low-priority review item is queued so a
 * human can fix the listing.
 */
export async function detectConflicts(sql: Sql): Promise<{ blocking: number; nonBlocking: number }> {
  const rows = await sql`
    SELECT a.id, a.subject_type, a.subject_id, a.predicate, a.status, a.criticality, coalesce(a.value_text, a.value_number::text, a.value_json::text) AS val,
           bool_or(s.source_type IS NOT NULL) AS has_evidence, array_agg(DISTINCT s.source_type) FILTER (WHERE s.source_type IS NOT NULL) AS source_types,
           min(s.authority_level) AS best_authority
    FROM knowledge_assertions a
    LEFT JOIN assertion_evidence e ON e.assertion_id = a.id
    LEFT JOIN source_records r ON r.id = e.source_record_id
    LEFT JOIN sources s ON s.id = r.source_id
    WHERE a.status IN ('verified','pending','conflicting','human_approved')
    GROUP BY a.id`;
  const groups = new Map<string, typeof rows>();
  for (const r of rows) { const k = `${r.subjectType}:${r.subjectId}:${r.predicate}`; if (!groups.has(k)) groups.set(k, [] as never); (groups.get(k) as unknown as typeof rows).push(r); }
  let blocking = 0, nonBlocking = 0;
  for (const [, g] of groups) {
    const distinct = new Set(g.map((r) => r.val));
    if (distinct.size < 2) continue;
    if (g.some((r) => r.status === "human_approved")) continue; // human override resolves it (precedence level 1)
    const predicate = g[0].predicate as string;
    const eligible = g.filter((r) => ((r.sourceTypes ?? []) as string[]).some((t) => sourceTypeAllowedForPredicate(predicate, t as SourceType)) && r.bestAuthority != null && Number(r.bestAuthority) <= maxAuthorityForCriticality(Number(r.criticality)));
    const eligibleValues = new Set(eligible.map((r) => r.val));
    const subjectType = g[0].subjectType as string, subjectId = g[0].subjectId as string;
    if (eligibleValues.size >= 2) {
      const ids = eligible.map((r) => r.id as string);
      const existing = await sql`SELECT id FROM knowledge_conflicts WHERE subject_type = ${subjectType} AND subject_id = ${subjectId} AND predicate = ${predicate} AND status = 'open'`;
      if (existing.length) continue;
      const description = `Conflicting values for ${predicate}: ${[...eligibleValues].join(" vs ")}`;
      const [c] = await sql`INSERT INTO knowledge_conflicts (subject_type, subject_id, predicate, assertion_ids, description) VALUES (${subjectType}, ${subjectId}, ${predicate}, ${ids}, ${description}) RETURNING id`;
      await sql`UPDATE knowledge_assertions SET status = 'conflicting', updated_at = now() WHERE id = ANY(${ids}) AND status IN ('verified','pending')`;
      await sql`INSERT INTO knowledge_reviews (review_type, target_type, target_id, summary, priority, payload) VALUES ('source_conflict', 'conflict', ${c.id}, ${description}, 1, ${sql.json({ assertionIds: ids })})`;
      blocking++;
    } else {
      const ineligible = g.filter((r) => !eligible.includes(r) && !eligibleValues.has(r.val));
      for (const r of ineligible) {
        const existing = await sql`SELECT id FROM knowledge_reviews WHERE review_type = 'low_confidence_assertion' AND target_type = 'assertion' AND target_id = ${r.id} AND status = 'open'`;
        if (existing.length) continue;
        await sql`INSERT INTO knowledge_reviews (review_type, target_type, target_id, summary, priority, payload) VALUES ('low_confidence_assertion', 'assertion', ${r.id}, ${`Non-authoritative source (${(r.sourceTypes ?? []).join(",")}) states ${predicate} = ${r.val}, disagreeing with verified evidence (${[...eligibleValues].join(",")})`}, 3, ${sql.json({ assertionId: r.id, eligibleValues: [...eligibleValues] })})`;
        nonBlocking++;
      }
    }
  }
  return { blocking, nonBlocking };
}

/** Resolve a conflict by choosing one assertion. Losing assertions are deprecated; the winner becomes human_approved. */
export async function resolveConflict(sql: Sql, conflictId: string, winningAssertionId: string, userId: string, note: string): Promise<void> {
  const [c] = await sql`SELECT * FROM knowledge_conflicts WHERE id = ${conflictId} AND status = 'open'`;
  if (!c) throw new Error("Conflict not found or not open");
  if (!(c.assertionIds as string[]).includes(winningAssertionId)) throw new Error("Winning assertion is not part of this conflict");
  await sql.begin(async (tx) => {
    await tx`UPDATE knowledge_assertions SET status = 'human_approved', updated_at = now() WHERE id = ${winningAssertionId}`;
    await tx`UPDATE knowledge_assertions SET status = 'deprecated', updated_at = now() WHERE id = ANY(${c.assertionIds}) AND id <> ${winningAssertionId}`;
    await tx`UPDATE knowledge_conflicts SET status = 'resolved', resolved_assertion_id = ${winningAssertionId}, resolved_by = ${userId}, resolved_at = now() WHERE id = ${conflictId}`;
    await tx`UPDATE knowledge_reviews SET status = 'approved', decided_by = ${userId}, decision_note = ${note}, decided_at = now() WHERE target_type = 'conflict' AND target_id = ${conflictId} AND status = 'open'`;
    await tx`INSERT INTO audit_events (user_id, action, target_type, target_id, details) VALUES (${userId}, 'conflict.resolve', 'knowledge_conflict', ${conflictId}, ${tx.json({ winningAssertionId, note })})`;
  });
  await rebuildAttributeProjection(sql);
}
