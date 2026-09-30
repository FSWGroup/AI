import type { Sql } from "../db/client.ts";
import type { Citation } from "../answer/types.ts";

export interface SourceRecordInfo {
  id: string;
  sourceId: string;
  sourceType: string;
  sourceName: string;
  authorityLevel: number;
  isFixture: boolean;
  extractedText: string | null;
  recordLocator: string | null;
  pageNumber: number | null;
  revision: string | null;
  lastVerifiedAt: Date | null;
  ingestedAt: Date;
  documentTitle: string | null;
  documentNumber: string | null;
  documentVersionCurrent: boolean | null;
  documentVersionId: string | null;
}

export async function loadSourceRecords(sql: Sql, ids: string[]): Promise<Map<string, SourceRecordInfo>> {
  if (!ids.length) return new Map();
  const rows = await sql`
    SELECT r.id, r.source_id, s.source_type, s.name AS source_name, s.authority_level, s.is_fixture, r.extracted_text, r.record_locator, r.page_number,
           r.revision, r.last_verified_at, r.ingested_at, d.title AS document_title, d.document_number, dv.is_current AS document_version_current, r.document_version_id
    FROM source_records r
    JOIN sources s ON s.id = r.source_id
    LEFT JOIN document_versions dv ON dv.id = r.document_version_id
    LEFT JOIN documents d ON d.id = dv.document_id
    WHERE r.id = ANY(${ids})`;
  return new Map(rows.map((r) => [r.id as string, r as unknown as SourceRecordInfo]));
}

export function citationFor(rec: SourceRecordInfo, supportingText: string | null): Citation {
  let label: string;
  if (rec.documentTitle) label = `${rec.documentTitle} (${rec.documentNumber ?? "n/a"}) Rev ${rec.revision ?? "?"}, p.${rec.pageNumber ?? "?"}`;
  else if (rec.sourceType === "p21") label = `Prophet 21 ${rec.recordLocator ?? ""} (as of ${rec.lastVerifiedAt?.toISOString() ?? "unknown"})`;
  else if (rec.sourceType === "shopify") label = `Shopify ${rec.recordLocator ?? ""} (synchronized ${rec.lastVerifiedAt?.toISOString() ?? "unknown"})`;
  else label = `${rec.sourceName} ${rec.recordLocator ?? ""}`.trim();
  if (rec.isFixture) label = `[FIXTURE] ${label}`;
  return {
    sourceRecordId: rec.id, label, sourceType: rec.sourceType, authorityLevel: rec.authorityLevel, isFixture: rec.isFixture, supportingText,
    documentTitle: rec.documentTitle, documentNumber: rec.documentNumber, revision: rec.revision, pageNumber: rec.pageNumber, recordLocator: rec.recordLocator,
    asOf: rec.lastVerifiedAt ? rec.lastVerifiedAt.toISOString() : null,
  };
}

export interface AssertionWithEvidence {
  id: string;
  subjectId: string;
  predicate: string;
  valueText: string | null;
  valueNumber: number | null;
  valueNumberMax: number | null;
  unit: string | null;
  status: string;
  criticality: number;
  evidence: { sourceRecordId: string; supportingText: string | null; extractionMethod: string }[];
}

/** All assertions (any status) for variants, with evidence pointers. The gate decides eligibility. */
export async function loadAssertions(sql: Sql, variantIds: string[], predicates?: string[]): Promise<AssertionWithEvidence[]> {
  if (!variantIds.length) return [];
  const rows = await sql`
    SELECT a.id, a.subject_id, a.predicate, a.value_text, a.value_number, a.value_number_max, a.unit, a.status, a.criticality,
           coalesce(json_agg(json_build_object('sourceRecordId', e.source_record_id, 'supportingText', e.supporting_text, 'extractionMethod', e.extraction_method)) FILTER (WHERE e.id IS NOT NULL), '[]') AS evidence
    FROM knowledge_assertions a
    LEFT JOIN assertion_evidence e ON e.assertion_id = a.id
    WHERE a.subject_type = 'variant' AND a.subject_id = ANY(${variantIds})
      ${predicates ? sql`AND a.predicate = ANY(${predicates})` : sql``}
    GROUP BY a.id
    ORDER BY a.predicate`;
  return rows.map((r) => ({ ...(r as unknown as AssertionWithEvidence), valueNumber: r.valueNumber == null ? null : Number(r.valueNumber), valueNumberMax: r.valueNumberMax == null ? null : Number(r.valueNumberMax) }));
}

export function assertionValueString(a: { valueText: string | null; valueNumber: number | null; valueNumberMax: number | null }): string {
  if (a.valueNumber != null) return a.valueNumberMax != null ? `${a.valueNumber}–${a.valueNumberMax}` : String(a.valueNumber);
  return a.valueText ?? "";
}

export async function openConflictPredicates(sql: Sql, variantIds: string[]): Promise<Set<string>> {
  if (!variantIds.length) return new Set();
  const rows = await sql`SELECT subject_id, predicate FROM knowledge_conflicts WHERE status = 'open' AND subject_type = 'variant' AND subject_id = ANY(${variantIds})`;
  return new Set(rows.map((r) => `${r.subjectId}:${r.predicate}`));
}
