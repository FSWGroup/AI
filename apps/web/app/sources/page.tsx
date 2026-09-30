import Link from "next/link";
import { db } from "@/lib/db";
import { requireInternal } from "@/lib/guard";
import { Badge, statusTone } from "@/components/Badge";
import { Panel, Empty } from "@/components/DataTable";
import { Sku } from "@/components/panels";
import { fmtDate, short } from "@/lib/format";

export default async function SourcesPage() {
  await requireInternal();
  const sql = db();
  const [sources, jobs, conflicts] = await Promise.all([
    sql`SELECT s.*, m.name AS manufacturer, (SELECT count(*) FROM source_records r WHERE r.source_id = s.id) AS records, (SELECT count(*) FROM documents d WHERE d.source_id = s.id) AS docs FROM sources s LEFT JOIN manufacturers m ON m.id = s.manufacturer_id ORDER BY s.authority_level, s.name`,
    sql`SELECT * FROM sync_jobs ORDER BY coalesce(started_at, finished_at) DESC NULLS LAST LIMIT 50`,
    sql`SELECT c.*, v.canonical_sku FROM sync_conflicts c LEFT JOIN product_variants v ON v.id = c.variant_id ORDER BY c.conflict_type, c.created_at DESC LIMIT 500`,
  ]);
  const grouped = new Map<string, typeof conflicts>();
  for (const c of conflicts) { if (!grouped.has(c.conflictType)) grouped.set(c.conflictType, [] as unknown as typeof conflicts); (grouped.get(c.conflictType) as unknown as (typeof conflicts)[number][]).push(c); }
  return (
    <div className="space-y-4">
      <h1>Sources</h1>
      <Panel title={`Sources (${sources.length})`} right={<span className="text-slate-500">authority level 1 = highest precedence · fixtures can never be mistaken for production</span>}>
        <table className="data">
          <thead><tr><th>Type</th><th>Name</th><th className="num">Authority</th><th>Fixture</th><th>Manufacturer</th><th className="num">Records</th><th className="num">Documents</th><th>Origin</th><th>Notes</th></tr></thead>
          <tbody>{sources.map((s) => <tr key={s.id}><td className="mono">{s.sourceType}</td><td>{s.name}</td><td className="num">L{s.authorityLevel}</td><td>{s.isFixture ? <Badge tone="amber">FIXTURE</Badge> : <Badge tone="green">production</Badge>}</td><td>{s.manufacturer ?? "—"}</td><td className="num">{s.records}</td><td className="num">{s.docs}</td><td className="max-w-xs truncate text-slate-500">{s.originUrl ?? ""}</td><td className="max-w-md text-slate-600">{s.notes ?? ""}</td></tr>)}</tbody>
        </table>
      </Panel>
      <Panel title={`Sync jobs (${jobs.length})`}>
        {jobs.length === 0 ? <Empty>No sync jobs recorded.</Empty> : (
          <table className="data">
            <thead><tr><th>System</th><th>Job</th><th>Mode</th><th>Status</th><th>Started</th><th>Finished</th><th>Stats</th><th>Error</th></tr></thead>
            <tbody>{jobs.map((j) => <tr key={j.id}><td>{j.system}</td><td>{j.jobType}</td><td><Badge tone={j.mode === "fixture" ? "amber" : "green"}>{j.mode}</Badge></td><td><Badge tone={statusTone(j.status)}>{j.status}</Badge></td><td className="whitespace-nowrap text-slate-500">{fmtDate(j.startedAt)}</td><td className="whitespace-nowrap text-slate-500">{fmtDate(j.finishedAt)}</td><td><code className="text-[11px]">{j.stats ? JSON.stringify(j.stats) : ""}</code></td><td className="text-red-700">{j.error ?? ""}</td></tr>)}</tbody>
          </table>
        )}
      </Panel>
      <Panel title={`Reconciliation report — sync conflicts (${conflicts.length})`} right={<span className="text-slate-500">Shopify ↔ Prophet 21 disagreements, grouped by type</span>}>
        {grouped.size === 0 ? <Empty>No sync conflicts.</Empty> : [...grouped.entries()].map(([type, rows]) => (
          <div key={type} className="mb-3">
            <h3 className="mono">{type} <span className="font-normal text-slate-500">({rows.length})</span></h3>
            <table className="data mt-1">
              <thead><tr><th>Status</th><th>SKU</th><th>Shopify variant</th><th>P21 item</th><th>Details</th><th>Job</th><th>Created</th></tr></thead>
              <tbody>{rows.map((c) => <tr key={c.id}><td><Badge tone={statusTone(c.status)}>{c.status}</Badge></td><td><Sku sku={c.canonicalSku} /></td><td className="mono">{c.shopifyVariantId ?? ""}</td><td className="mono">{c.p21ItemId ?? ""}</td><td><code className="text-[11px]">{JSON.stringify(c.details)}</code></td><td className="mono text-slate-500">{short(c.syncJobId)}</td><td className="whitespace-nowrap text-slate-500">{fmtDate(c.createdAt)}</td></tr>)}</tbody>
            </table>
          </div>
        ))}
      </Panel>
      <p className="text-slate-500">Individual evidence records open at <span className="mono">/sources/record/&lt;id&gt;</span> from any citation. <Link href="/documents">Document library →</Link></p>
    </div>
  );
}
