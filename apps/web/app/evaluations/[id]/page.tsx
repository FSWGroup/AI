import Link from "next/link";
import { notFound } from "next/navigation";
import { gateReasons as releaseGate, type EvalMetrics, type CaseResult } from "@/lib/evals";
import { db } from "@/lib/db";
import { requireInternal } from "@/lib/guard";
import { Badge, statusTone } from "@/components/Badge";
import { Panel, Empty } from "@/components/DataTable";
import { fmtDate, fmtPct, short } from "@/lib/format";

export default async function EvaluationDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ show?: string }> }) {
  await requireInternal();
  const { id } = await params;
  const { show } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [run] = await db()`SELECT * FROM evaluation_runs WHERE id = ${id}`;
  if (!run) notFound();
  const m = run.metrics as EvalMetrics | null;
  const results = ((run.results ?? []) as CaseResult[]);
  const gate = m ? releaseGate(m) : null;
  const shown = show === "all" ? results : results.filter((r) => !r.pass);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1>Evaluation run <span className="mono">{short(id)}</span></h1>
        {run.passedGate == null ? <Badge tone="grey">no result</Badge> : <Badge tone={run.passedGate ? "green" : "red"}>release gate {run.passedGate ? "PASS" : "FAIL"}</Badge>}
        <span className="text-slate-500">dataset v{run.datasetVersion} · {run.codeVersion ?? ""} · started {fmtDate(run.startedAt)} · finished {fmtDate(run.finishedAt)}</span>
        <Link href="/evaluations" className="ml-auto">← runs</Link>
      </div>
      {m ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <Panel title="Metrics">
            <dl className="kv">
              <dt>Cases passed</dt><dd className="mono">{m.passed}/{m.cases} ({fmtPct(m.caseAccuracy, 1)})</dd>
              <dt>Claim precision</dt><dd className="mono">{fmtPct(m.claimPrecision, 3)} ({m.claimsCorrect}/{m.claimsTotal})</dd>
              <dt>Critical-claim precision</dt><dd className="mono">{fmtPct(m.criticalClaimPrecision, 3)} ({m.criticalClaimsTotal - m.criticalClaimsIncorrect}/{m.criticalClaimsTotal})</dd>
              <dt>Citation validity</dt><dd className="mono">{fmtPct(m.citationValidity, 3)}</dd>
              <dt>Unsupported claim rate</dt><dd className="mono">{fmtPct(m.unsupportedClaimRate, 3)}</dd>
              <dt>Severity-1 errors</dt><dd className="mono">{m.severity1Errors}</dd>
              <dt>Abstention quality</dt><dd className="mono">{fmtPct(m.abstentionQuality, 1)} ({m.abstainedCorrectly}/{m.expectedAbstain})</dd>
              <dt>False answer rate</dt><dd className="mono">{fmtPct(m.falseAnswerRate, 1)}</dd>
              <dt>Answer / abstention rate</dt><dd className="mono">{fmtPct(m.answerRate, 1)} / {fmtPct(m.abstentionRate, 1)}</dd>
              <dt>Regression cases</dt><dd className="mono">{m.regressionPassed}/{m.regressionCases}</dd>
              <dt>Exact part lookup</dt><dd className="mono">{m.partLookupExact.passed}/{m.partLookupExact.cases}</dd>
            </dl>
          </Panel>
          <Panel title="Release gate">
            {gate?.passed ? <p className="font-medium text-emerald-700">All release gates satisfied.</p> : <ul className="list-disc pl-5 text-red-700">{gate?.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          </Panel>
          <Panel title="By category">
            <table className="data"><thead><tr><th>Category</th><th className="num">Cases</th><th className="num">Passed</th><th className="num">Claims</th><th className="num">Correct</th></tr></thead>
              <tbody>{Object.entries(m.byCategory).map(([k, b]) => <tr key={k}><td className="mono">{k}</td><td className="num">{b.cases}</td><td className={`num ${b.passed < b.cases ? "text-red-700" : ""}`}>{b.passed}</td><td className="num">{b.claims}</td><td className="num">{b.claimsCorrect}</td></tr>)}</tbody></table>
          </Panel>
        </div>
      ) : null}
      <Panel title={`Case results (${shown.length} of ${results.length})`} right={<Link href={show === "all" ? `/evaluations/${id}` : `/evaluations/${id}?show=all`}>{show === "all" ? "failing only" : "show all"}</Link>}>
        {shown.length === 0 ? <Empty>{results.length ? "All cases passed." : "No results recorded."}</Empty> : shown.map((r) => (
          <details key={r.id} open={!r.pass} className="mb-1 rounded border border-slate-200 p-2">
            <summary className="flex flex-wrap items-center gap-2">
              <Badge tone={r.pass ? "green" : "red"}>{r.pass ? "PASS" : "FAIL"}</Badge><span className="mono font-medium">{r.id}</span><Badge tone="neutral">{r.category}</Badge><Badge tone="neutral">{r.agent}</Badge><span className="text-slate-500">crit {r.criticality} · outcome <Badge tone={statusTone(r.outcome)}>{r.outcome}</Badge>{r.expectedOutcome ? <> expected <Badge tone={statusTone(r.expectedOutcome)}>{r.expectedOutcome}</Badge></> : null} · {r.latencyMs} ms</span>
            </summary>
            <div className="mt-2 space-y-2">
              {r.error ? <p className="text-red-700">error: {r.error}</p> : null}
              {r.severity1Failures.length ? <ul className="list-disc pl-5 text-red-700">{r.severity1Failures.map((f, i) => <li key={i}>SEV-1: {f}</li>)}</ul> : null}
              {r.missingExpected.length ? <div><b>Missing expected claims:</b><ul className="list-disc pl-5">{r.missingExpected.map((c, i) => <li key={i} className="mono">{c.subject} {c.predicate} = {c.value}</li>)}</ul></div> : null}
              {r.forbiddenHit.length ? <div className="text-red-700"><b>Forbidden claims returned:</b><ul className="list-disc pl-5">{r.forbiddenHit.map((c, i) => <li key={i} className="mono">{c.subject} {c.predicate}{c.value ? ` = ${c.value}` : ""}</li>)}</ul></div> : null}
              {r.dataFailures.length ? <div><b>Data expectations failed:</b><ul className="list-disc pl-5">{r.dataFailures.map((f, i) => <li key={i} className="mono text-[11.5px]">{f}</li>)}</ul></div> : null}
              {r.claims.length ? (
                <table className="data"><thead><tr><th>Subject</th><th>Predicate</th><th>Value</th><th className="num">Crit.</th><th>Correct</th><th>Expected</th><th>Citation valid</th><th>Reason</th></tr></thead>
                  <tbody>{r.claims.map((c, i) => <tr key={i} className={c.correct ? "" : "bg-red-50"}><td className="mono">{c.subject}</td><td className="mono">{c.predicate}</td><td className="mono">{c.value}</td><td className="num">{c.criticality}</td><td><Badge tone={c.correct ? "green" : "red"}>{c.correct ? "yes" : "NO"}</Badge></td><td>{c.expected ? "yes" : "—"}</td><td><Badge tone={c.citationValid ? "green" : "red"}>{c.citationValid ? "yes" : "no"}</Badge></td><td className="text-slate-600">{c.reason}</td></tr>)}</tbody></table>
              ) : <p className="text-slate-500">No verified claims returned.</p>}
            </div>
          </details>
        ))}
      </Panel>
    </div>
  );
}
