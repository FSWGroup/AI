import Link from "next/link";
import { documentFinderAgent } from "@wpi/core";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { AnswerView } from "@/components/AnswerView";
import { Badge } from "@/components/Badge";
import { Panel } from "@/components/DataTable";
import { fmtDate } from "@/lib/format";

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim().slice(0, 500);
  const { ctx, session } = await getContext();
  const answer = query ? await documentFinderAgent(ctx, { query }) : null;
  const sql = db();
  const docs = await sql`SELECT d.id, d.title, d.document_number, d.document_type, m.name AS manufacturer, s.name AS source_name, s.is_fixture, s.authority_level,
      coalesce(json_agg(json_build_object('id', dv.id, 'revision', dv.revision, 'isCurrent', dv.is_current, 'pageCount', dv.page_count, 'publicationDate', dv.publication_date, 'ingestedAt', dv.ingested_at, 'supersededAt', dv.superseded_at) ORDER BY dv.is_current DESC, dv.ingested_at DESC) FILTER (WHERE dv.id IS NOT NULL), '[]') AS versions
    FROM documents d LEFT JOIN manufacturers m ON m.id = d.manufacturer_id JOIN sources s ON s.id = d.source_id LEFT JOIN document_versions dv ON dv.document_id = d.id
    GROUP BY d.id, m.name, s.name, s.is_fixture, s.authority_level ORDER BY m.name, d.title`;
  return (
    <div className="space-y-4">
      <h1>Documents</h1>
      <form method="get" className="panel flex flex-wrap items-center gap-2 p-3">
        <input type="search" name="q" defaultValue={query} placeholder="e.g. IOM for BVW-S70-200, Series 70 pressure temperature chart, torque bulletin" className="w-[32rem] max-w-full" />
        <button className="btn" type="submit">Find document</button>
        <span className="text-slate-500">Resolves the part number, then finds current documents linked by evidence, falling back to full-text search.</span>
      </form>
      {answer ? <AnswerView answer={answer} canReport={session.canReview} showClaims={false} /> : null}
      <Panel title={`Document library (${docs.length})`}>
        <table className="data">
          <thead><tr><th>Title</th><th>Number</th><th>Type</th><th>Manufacturer</th><th>Source</th><th>Versions</th></tr></thead>
          <tbody>{docs.map((d) => (
            <tr key={d.id}>
              <td>{d.title}</td><td className="mono">{d.documentNumber ?? ""}</td><td>{d.documentType}</td><td>{d.manufacturer ?? "—"}</td>
              <td>{d.sourceName} <Badge tone="neutral">auth L{d.authorityLevel}</Badge> {d.isFixture ? <Badge tone="amber">FIXTURE</Badge> : null}</td>
              <td>{(d.versions as { id: string; revision: string; isCurrent: boolean; pageCount: number | null; publicationDate: string | null; ingestedAt: string; supersededAt: string | null }[]).map((v) => (
                <div key={v.id} className="flex flex-wrap items-center gap-1">
                  <Link href={`/documents/${v.id}`} className="mono">Rev {v.revision}</Link>
                  {v.isCurrent ? <Badge tone="green">current</Badge> : <Badge tone="grey">superseded</Badge>}
                  <span className="text-slate-500">{v.pageCount ?? "?"} pages · pub {v.publicationDate ? String(v.publicationDate).slice(0, 10) : "?"} · ingested {fmtDate(v.ingestedAt).slice(0, 10)}</span>
                </div>
              ))}</td>
            </tr>
          ))}</tbody>
        </table>
      </Panel>
    </div>
  );
}
