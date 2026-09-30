import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { Badge, statusTone } from "@/components/Badge";
import { Panel, Empty } from "@/components/DataTable";
import { Sku } from "@/components/panels";
import { fmtDate } from "@/lib/format";
import { assertionValue } from "@/lib/evidence";

export default async function SourceRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const session = await getSession();
  const sql = db();
  const [r] = await sql`SELECT r.*, s.source_type, s.name AS source_name, s.authority_level, s.is_fixture, s.origin_url, m.name AS manufacturer, d.id AS document_id, d.title AS document_title, d.document_number, d.document_type, dv.revision AS dv_revision, dv.is_current, dv.page_count
    FROM source_records r JOIN sources s ON s.id = r.source_id LEFT JOIN manufacturers m ON m.id = s.manufacturer_id LEFT JOIN document_versions dv ON dv.id = r.document_version_id LEFT JOIN documents d ON d.id = dv.document_id WHERE r.id = ${id}`;
  if (!r) notFound();
  const [assertions, relationships] = await Promise.all([
    sql`SELECT a.id, a.predicate, a.value_text, a.value_number, a.value_number_max, a.value_json, a.unit, a.status, e.supporting_text, v.canonical_sku FROM assertion_evidence e JOIN knowledge_assertions a ON a.id = e.assertion_id LEFT JOIN product_variants v ON v.id = a.subject_id WHERE e.source_record_id = ${id} ORDER BY v.canonical_sku, a.predicate`,
    sql`SELECT p.id, p.relationship_type, p.status, p.approval_authority, f.canonical_sku AS from_sku, t.canonical_sku AS to_sku, e.supporting_text FROM relationship_evidence e JOIN product_relationships p ON p.id = e.relationship_id JOIN product_variants f ON f.id = p.from_variant_id JOIN product_variants t ON t.id = p.to_variant_id WHERE e.source_record_id = ${id}`,
  ]);
  const structured = r.structured as Record<string, unknown> | null;
  // Cost/margin and internal fields never reach public principals, even via raw records.
  const hideStructured = !session.isInternal && (r.sourceType === "p21" || r.sourceType === "internal_approved" || r.sourceType === "internal_historical" || r.sourceType === "human_override");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1>Source record</h1><span className="mono text-slate-500">{id}</span>
        <Badge tone="blue">{r.sourceType}</Badge>
        <Badge tone="neutral">authority L{r.authorityLevel}</Badge>
        {r.isFixture ? <Badge tone="amber">FIXTURE</Badge> : <Badge tone="green">production</Badge>}
        {r.documentVersionId ? (r.isCurrent ? <Badge tone="green">current revision</Badge> : <Badge tone="red">superseded revision</Badge>) : null}
      </div>
      <div className="grid gap-3 lg:grid-cols-[360px_1fr]">
        <Panel title="Record">
          <dl className="kv">
            <dt>Source</dt><dd>{r.sourceName}{r.manufacturer ? ` (${r.manufacturer})` : ""}</dd>
            <dt>Locator</dt><dd className="mono">{r.recordLocator ?? "—"}</dd>
            {r.documentTitle ? <><dt>Document</dt><dd><Link href={`/documents/${r.documentVersionId}?page=${r.pageNumber ?? 1}`}>{r.documentTitle}</Link> <span className="mono">{r.documentNumber ?? ""} Rev {r.dvRevision}</span>, page {r.pageNumber ?? "?"} of {r.pageCount ?? "?"}</dd></> : null}
            <dt>Source version</dt><dd className="mono">{r.sourceVersion ?? "—"}{r.revision ? ` / rev ${r.revision}` : ""}</dd>
            <dt>Effective</dt><dd>{r.effectiveDate ? String(r.effectiveDate).slice(0, 10) : "—"}</dd>
            <dt>Ingested</dt><dd>{fmtDate(r.ingestedAt)}</dd>
            <dt>Last verified</dt><dd>{fmtDate(r.lastVerifiedAt)}</dd>
            <dt>Checksum</dt><dd className="mono break-all">{r.checksum}</dd>
            {r.originUrl ? <><dt>Origin</dt><dd className="break-all">{r.originUrl}</dd></> : null}
          </dl>
        </Panel>
        <Panel title="Extracted text (verbatim; untrusted data)">
          {r.extractedText ? <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap text-[12.5px] leading-relaxed">{r.extractedText}</pre> : <Empty>No extracted text.</Empty>}
        </Panel>
      </div>
      <Panel title="Structured fields">
        {hideStructured ? <Empty>Structured payload is not shown for this role.</Empty> : structured ? <pre className="max-h-96 overflow-auto rounded bg-slate-50 p-2 text-[11.5px]">{JSON.stringify(structured, null, 2)}</pre> : <Empty>None.</Empty>}
      </Panel>
      <Panel title={`Assertions supported by this record (${assertions.length})`}>
        {assertions.length === 0 ? <Empty>None.</Empty> : (
          <table className="data"><thead><tr><th>Subject</th><th>Predicate</th><th>Value</th><th>Unit</th><th>Status</th><th>Supporting text</th></tr></thead>
            <tbody>{assertions.map((a) => <tr key={a.id}><td><Sku sku={a.canonicalSku} /></td><td className="mono">{a.predicate}</td><td className="mono">{assertionValue(a)}</td><td>{a.unit ?? ""}</td><td><Badge tone={statusTone(a.status)}>{a.status}</Badge></td><td className="max-w-md text-slate-600">{a.supportingText ?? ""}</td></tr>)}</tbody></table>
        )}
      </Panel>
      {relationships.length ? (
        <Panel title={`Relationships supported by this record (${relationships.length})`}>
          <table className="data"><thead><tr><th>From</th><th>Type</th><th>To</th><th>Authority</th><th>Status</th><th>Supporting text</th></tr></thead>
            <tbody>{relationships.map((p) => <tr key={p.id}><td><Sku sku={p.fromSku} /></td><td className="mono">{p.relationshipType}</td><td><Sku sku={p.toSku} /></td><td>{p.approvalAuthority ?? "none"}</td><td><Badge tone={statusTone(p.status)}>{p.status}</Badge></td><td className="text-slate-600">{p.supportingText ?? ""}</td></tr>)}</tbody></table>
        </Panel>
      ) : null}
    </div>
  );
}
