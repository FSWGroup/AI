import Link from "next/link";
import { releaseGate, type EvalMetrics } from "@wpi/core/src/eval/runner.ts";
import { db } from "@/lib/db";
import { requireInternal } from "@/lib/guard";
import { runEvaluationAction } from "@/app/actions/evaluations";
import { Badge } from "@/components/Badge";
import { Panel, Empty } from "@/components/DataTable";
import { fmtDate, fmtPct, short } from "@/lib/format";

export default async function EvaluationsPage() {
  await requireInternal();
  const sql = db();
  const runs = await sql`SELECT id, dataset_version, code_version, llm_model, started_at, finished_at, metrics, passed_gate FROM evaluation_runs ORDER BY started_at DESC LIMIT 50`;
  const [{ cases, regression }] = await sql`SELECT count(*) AS cases, count(*) FILTER (WHERE is_regression) AS regression FROM evaluation_cases`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1>Evaluations</h1>
        <span className="text-slate-500">{String(cases)} cases loaded ({String(regression)} regression)</span>
        <form action={runEvaluationAction} className="ml-auto"><button className="btn" type="submit">Run evaluation</button></form>
      </div>
      <p className="text-slate-500">Every golden and regression case runs through the real agents (deterministic, LLM disabled) and is scored at claim level. Release gate: claim precision ≥ 99.9%, critical-claim precision 100%, zero severity-1 errors, citation validity ≥ 99.9%, unsupported rate ≤ 0.1%, all regression cases pass, exact part lookup 100%, abstention quality 100%, pricing / inventory / territory categories 100%.</p>
      <Panel title={`Evaluation runs (${runs.length})`}>
        {runs.length === 0 ? <Empty>No runs yet. Click "Run evaluation".</Empty> : (
          <table className="data">
            <thead><tr><th>Run</th><th>Finished</th><th>Dataset</th><th>Gate</th><th className="num">Cases</th><th className="num">Claim prec.</th><th className="num">Critical prec.</th><th className="num">Citation valid.</th><th className="num">Unsupported</th><th className="num">Sev-1</th><th className="num">Abstention q.</th><th className="num">Regression</th><th>Gate reasons</th></tr></thead>
            <tbody>{runs.map((r) => {
              const m = r.metrics as EvalMetrics | null;
              const gate = m ? releaseGate(m) : null;
              return (
                <tr key={r.id}>
                  <td><Link href={`/evaluations/${r.id}`} className="mono">{short(r.id)}</Link></td>
                  <td className="whitespace-nowrap text-slate-500">{r.finishedAt ? fmtDate(r.finishedAt) : <Badge tone="amber">running</Badge>}</td>
                  <td className="mono">v{r.datasetVersion}{r.codeVersion ? ` · ${r.codeVersion}` : ""}</td>
                  <td>{r.passedGate == null ? <Badge tone="grey">—</Badge> : <Badge tone={r.passedGate ? "green" : "red"}>{r.passedGate ? "PASS" : "FAIL"}</Badge>}</td>
                  <td className="num mono">{m ? `${m.passed}/${m.cases}` : "—"}</td>
                  <td className="num mono">{fmtPct(m?.claimPrecision, 3)}</td>
                  <td className="num mono">{fmtPct(m?.criticalClaimPrecision, 3)}</td>
                  <td className="num mono">{fmtPct(m?.citationValidity, 3)}</td>
                  <td className="num mono">{fmtPct(m?.unsupportedClaimRate, 3)}</td>
                  <td className="num mono">{m?.severity1Errors ?? "—"}</td>
                  <td className="num mono">{fmtPct(m?.abstentionQuality, 1)}</td>
                  <td className="num mono">{m ? `${m.regressionPassed}/${m.regressionCases}` : "—"}</td>
                  <td className="max-w-md text-red-700">{gate && !gate.passed ? <ul className="list-disc pl-4">{gate.reasons.map((x) => <li key={x}>{x}</li>)}</ul> : gate?.passed ? <span className="text-emerald-700">all gates satisfied</span> : ""}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
