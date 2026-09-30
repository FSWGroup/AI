import Link from "next/link";
import { db } from "@/lib/db";
import { requireInternal } from "@/lib/guard";
import { submitRfqAction } from "@/app/actions/rfq";
import { Badge, statusTone } from "@/components/Badge";
import { Panel } from "@/components/DataTable";
import { fmtDate, short } from "@/lib/format";

const SAMPLE = `Hi, please quote:
2 ea BVW-S70-200
Qty 4 Bramwell S40-100 brass ball valve
1 x CVA-DA-150 double acting actuator
3 ea 2" stainless ball valve NPT`;

export default async function RfqPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireInternal();
  const { error } = await searchParams;
  const sql = db();
  const rfqs = await sql`SELECT r.id, r.channel_id, r.source_kind, r.status, r.created_at, u.display_name AS created_by, (SELECT count(*) FROM rfq_lines l WHERE l.rfq_id = r.id) AS lines, (SELECT count(*) FROM rfq_lines l WHERE l.rfq_id = r.id AND l.review_required) AS review_lines, left(r.raw_text, 80) AS preview FROM rfqs r LEFT JOIN users u ON u.id = r.created_by ORDER BY r.created_at DESC LIMIT 50`;
  return (
    <div className="space-y-4">
      <h1>RFQ / BOM</h1>
      <form action={submitRfqAction} className="panel p-3" encType="multipart/form-data">
        <label className="block text-slate-600">Paste an RFQ email, spreadsheet rows or CSV (untrusted input: it is parsed, never executed). Each line is resolved with the same identifier retrieval as everywhere else; anything but an exact/normalized/historical match requires review.</label>
        <textarea name="text" rows={7} className="mono mt-1 w-full" placeholder={SAMPLE} />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label>Source <select name="kind" defaultValue="email"><option value="email">email</option><option value="text">text</option></select></label>
          <label>or upload <input type="file" name="file" accept=".csv,.txt,text/plain,text/csv" /></label>
          <button className="btn" type="submit">Parse into BOM</button>
          {error === "empty" ? <span className="text-red-700">Nothing to parse.</span> : null}
        </div>
      </form>
      <Panel title={`Recent RFQs (${rfqs.length})`}>
        <table className="data">
          <thead><tr><th>RFQ</th><th>Created</th><th>By</th><th>Channel</th><th>Source</th><th>Status</th><th className="num">Lines</th><th className="num">Need review</th><th>Preview</th></tr></thead>
          <tbody>{rfqs.length === 0 ? <tr><td colSpan={9} className="text-center text-slate-500">No RFQs yet.</td></tr> : rfqs.map((r) => <tr key={r.id}><td><Link href={`/rfq/${r.id}`} className="mono">{short(r.id)}</Link></td><td className="whitespace-nowrap text-slate-500">{fmtDate(r.createdAt)}</td><td>{r.createdBy ?? "—"}</td><td>{r.channelId}</td><td>{r.sourceKind}</td><td><Badge tone={statusTone(r.status)}>{r.status}</Badge></td><td className="num">{r.lines}</td><td className="num">{r.reviewLines}</td><td className="max-w-md truncate text-slate-600">{r.preview}</td></tr>)}</tbody>
        </table>
      </Panel>
    </div>
  );
}
