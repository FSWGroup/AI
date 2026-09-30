import "server-only";
import type { Citation } from "@wpi/core";
import type { Sql } from "@wpi/core";

export interface EvidenceRow {
  sourceRecordId: string; supportingText: string | null; sourceType: string; sourceName: string; authorityLevel: number; isFixture: boolean;
  documentTitle: string | null; documentNumber: string | null; revision: string | null; pageNumber: number | null; recordLocator: string | null; lastVerifiedAt: string | null; documentVersionId: string | null;
}

/** Build a display Citation for a source record (mirrors core's citation labeling for UI-only listings). */
export function toCitation(e: EvidenceRow): Citation {
  let label: string;
  if (e.documentTitle) label = `${e.documentTitle} (${e.documentNumber ?? "n/a"}) Rev ${e.revision ?? "?"}, p.${e.pageNumber ?? "?"}`;
  else if (e.sourceType === "p21") label = `Prophet 21 ${e.recordLocator ?? ""}`;
  else if (e.sourceType === "shopify") label = `Shopify ${e.recordLocator ?? ""}`;
  else label = `${e.sourceName}${e.recordLocator ? ` ${e.recordLocator}` : ""}`;
  return { sourceRecordId: e.sourceRecordId, label, sourceType: e.sourceType, authorityLevel: e.authorityLevel, isFixture: e.isFixture, supportingText: e.supportingText, documentTitle: e.documentTitle, documentNumber: e.documentNumber, revision: e.revision, pageNumber: e.pageNumber, recordLocator: e.recordLocator, asOf: e.lastVerifiedAt };
}

/** Assertions for a set of subject ids with their evidence rows (any status). */
export async function loadAssertionsWithEvidence(sql: Sql, subjectIds: string[]) {
  if (!subjectIds.length) return [];
  const rows = await sql`
    SELECT a.id, a.subject_id, a.predicate, a.value_text, a.value_number, a.value_number_max, a.value_json, a.unit, a.status, a.criticality, a.effective_date, a.expires_at, a.supersedes_id, a.created_at, a.updated_at,
           coalesce(json_agg(json_build_object(
             'sourceRecordId', r.id, 'supportingText', e.supporting_text, 'sourceType', s.source_type, 'sourceName', s.name, 'authorityLevel', s.authority_level, 'isFixture', s.is_fixture,
             'documentTitle', d.title, 'documentNumber', d.document_number, 'revision', coalesce(dv.revision, r.revision), 'pageNumber', r.page_number, 'recordLocator', r.record_locator, 'lastVerifiedAt', r.last_verified_at, 'documentVersionId', r.document_version_id
           ) ORDER BY s.authority_level) FILTER (WHERE e.id IS NOT NULL), '[]') AS evidence
    FROM knowledge_assertions a
    LEFT JOIN assertion_evidence e ON e.assertion_id = a.id
    LEFT JOIN source_records r ON r.id = e.source_record_id
    LEFT JOIN sources s ON s.id = r.source_id
    LEFT JOIN document_versions dv ON dv.id = r.document_version_id
    LEFT JOIN documents d ON d.id = dv.document_id
    WHERE a.subject_id = ANY(${subjectIds})
    GROUP BY a.id ORDER BY a.predicate, a.status, a.created_at DESC`;
  return rows.map((r) => ({ ...r, evidence: (r.evidence as EvidenceRow[]).map(toCitation) }));
}

export function assertionValue(a: { valueText?: string | null; valueNumber?: unknown; valueNumberMax?: unknown; valueJson?: unknown }): string {
  if (a.valueText != null) return a.valueText;
  if (a.valueNumber != null) return a.valueNumberMax != null ? `${Number(a.valueNumber)} – ${Number(a.valueNumberMax)}` : String(Number(a.valueNumber));
  if (a.valueJson != null) return JSON.stringify(a.valueJson);
  return "";
}
