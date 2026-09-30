import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { Badge } from "@/components/Badge";
import { Panel } from "@/components/DataTable";
import { fmtDate, fmtPct } from "@/lib/format";

export default async function Dashboard() {
  const session = await getSession();
  if (!session.isInternal) redirect("/ask");
  const sql = db();
  const [c] = await sql`SELECT
      (SELECT count(*) FROM knowledge_assertions WHERE status IN ('verified','human_approved')) AS verified,
      (SELECT count(*) FROM knowledge_assertions WHERE status = 'pending') AS pending,
      (SELECT count(*) FROM knowledge_assertions WHERE status = 'conflicting') AS conflicting,
      (SELECT count(*) FROM knowledge_conflicts WHERE status = 'open') AS open_conflicts,
      (SELECT count(*) FROM knowledge_reviews WHERE status = 'open') AS open_reviews,
      (SELECT count(*) FROM human_escalations WHERE status = 'open') AS open_escalations,
      (SELECT count(*) FROM product_variants) AS variants,
      (SELECT count(*) FROM documents) AS documents,
      (SELECT count(*) FROM sync_conflicts WHERE status = 'open') AS sync_conflicts,
      (SELECT count(*) FROM agent_runs) AS runs,
      (SELECT count(*) FROM agent_runs WHERE outcome = 'abstained') AS abstained_runs`;
  const [lastEval] = await sql`SELECT id, dataset_version, finished_at, metrics, passed_gate FROM evaluation_runs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`;
  const recentRuns = await sql`SELECT id, agent, question, outcome, confidence, latency_ms, created_at FROM agent_runs ORDER BY created_at DESC LIMIT 8`;
  const m = (lastEval?.metrics ?? null) as Record<string, number> | null;
  const stat = (label: string, value: unknown, href?: string, tone?: "green" | "amber" | "red" | "grey") => (
    <div className="panel p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mono text-2xl font-semibold ${tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : tone === "green" ? "text-emerald-700" : ""}`}>{String(value)}</div>
      {href ? <Link href={href} className="text-[11.5px]">open →</Link> : null}
    </div>
  );
  return (
    <div className="space-y-4">
      <h1>Dashboard</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stat("Verified assertions", c.verified, "/products", "green")}
        {stat("Pending assertions", c.pending, "/review", "amber")}
        {stat("Open knowledge conflicts", c.openConflicts, "/conflicts", Number(c.openConflicts) ? "red" : "green")}
        {stat("Open reviews", c.openReviews, "/review", Number(c.openReviews) ? "amber" : "green")}
        {stat("Open escalations", c.openEscalations, "/admin")}
        {stat("Product variants", c.variants, "/products")}
        {stat("Documents", c.documents, "/documents")}
        {stat("Open sync conflicts", c.syncConflicts, "/sources", Number(c.syncConflicts) ? "amber" : "green")}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Last evaluation" right={lastEval ? <Link href={`/evaluations/${lastEval.id}`}>details →</Link> : <Link href="/evaluations">run one →</Link>}>
          {!lastEval || !m ? <p className="text-slate-500">No evaluation run recorded yet.</p> : (
            <div className="space-y-2">
              <div className="flex items-center gap-2"><Badge tone={lastEval.passedGate ? "green" : "red"}>release gate {lastEval.passedGate ? "PASS" : "FAIL"}</Badge><span className="text-slate-500">dataset v{lastEval.datasetVersion} · {fmtDate(lastEval.finishedAt)}</span></div>
              <dl className="kv">
                <dt>Cases passed</dt><dd className="mono">{m.passed}/{m.cases}</dd>
                <dt>Claim precision</dt><dd className="mono">{fmtPct(m.claimPrecision, 3)}</dd>
                <dt>Critical-claim precision</dt><dd className="mono">{fmtPct(m.criticalClaimPrecision, 3)}</dd>
                <dt>Citation validity</dt><dd className="mono">{fmtPct(m.citationValidity, 3)}</dd>
                <dt>Unsupported claim rate</dt><dd className="mono">{fmtPct(m.unsupportedClaimRate, 3)}</dd>
                <dt>Severity-1 errors</dt><dd className="mono">{m.severity1Errors}</dd>
                <dt>Abstention quality</dt><dd className="mono">{fmtPct(m.abstentionQuality, 1)}</dd>
              </dl>
            </div>
          )}
        </Panel>
        <Panel title="Quick links">
          <ul className="grid grid-cols-2 gap-1">
            {[["/ask", "Ask a product question"], ["/finder", "Find products by requirements"], ["/xref", "Cross-reference a part number"], ["/rfq", "Parse an RFQ into a BOM"], ["/assemblies", "Size an actuated assembly"], ["/documents", "Find a document"], ["/review", "Knowledge Review Center"], ["/conflicts", "Resolve knowledge conflicts"], ["/sources", "Sources & sync reconciliation"], ["/evaluations", "Evaluation runs & release gate"], ["/admin", "Users, rules, audit"]].map(([h, l]) => <li key={h}><Link href={h}>{l}</Link></li>)}
          </ul>
          <p className="mt-3 text-slate-500">{String(c.runs)} agent runs recorded ({String(c.abstainedRuns)} abstained).</p>
        </Panel>
      </div>
      <Panel title="Recent agent runs">
        <table className="data">
          <thead><tr><th>When</th><th>Agent</th><th>Question</th><th>Outcome</th><th>Confidence</th><th className="num">ms</th></tr></thead>
          <tbody>{recentRuns.length === 0 ? <tr><td colSpan={6} className="text-center text-slate-500">No runs yet.</td></tr> : recentRuns.map((r) => <tr key={r.id}><td className="whitespace-nowrap text-slate-500">{fmtDate(r.createdAt)}</td><td>{r.agent}</td><td className="max-w-md truncate">{r.question}</td><td><Badge tone={r.outcome === "answered" ? "green" : r.outcome === "partial" ? "amber" : "grey"}>{r.outcome}</Badge></td><td>{r.confidence}</td><td className="num mono">{r.latencyMs}</td></tr>)}</tbody>
        </table>
      </Panel>
    </div>
  );
}
