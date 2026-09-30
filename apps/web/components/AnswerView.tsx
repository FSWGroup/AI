import type { Answer } from "@wpi/core";
import { ABSTAIN_TEXT } from "@wpi/core";
import { Badge, ConfidenceBadge } from "./Badge";
import { ClaimsTable } from "./ClaimsTable";
import { Panel } from "./DataTable";
import { ReportIncorrectForm } from "./ReportIncorrectForm";
import { AssemblyPanel, DocumentsPanel, EligibilityPanel, FinderPanel, InventoryPanel, PartLookupPanel, PricingPanel, RfqPanel, SpecsPanel, XrefPanel } from "./panels";

function AgentData({ answer }: { answer: Answer }) {
  const d = answer.data;
  if (!d) return null;
  switch (answer.agent) {
    case "product_finder": return <FinderPanel data={d} />;
    case "cross_reference": return <XrefPanel data={d} />;
    case "assembly": return <AssemblyPanel data={d} />;
    case "rfq_bom": return <RfqPanel data={d} />;
    case "document_finder": return <DocumentsPanel data={d} />;
    case "pricing": return <PricingPanel data={d} />;
    case "inventory": return <InventoryPanel data={d} />;
    case "eligibility": return <EligibilityPanel data={d} />;
    case "part_lookup": return <PartLookupPanel data={d} />;
    case "product_specs": return <SpecsPanel data={d} />;
    default: return null;
  }
}

export function AnswerView({ answer, canReport = false, showClaims = true }: { answer: Answer; canReport?: boolean; showClaims?: boolean }) {
  const abstained = answer.outcome === "abstained";
  const routed = answer.data?.routedIntent as string | undefined;
  return (
    <div className="space-y-3">
      <section className="panel">
        <div className="panel-head">
          <div className="flex flex-wrap items-center gap-2">
            <ConfidenceBadge confidence={answer.confidence} outcome={answer.outcome} />
            <Badge tone="neutral">agent {answer.agent}</Badge>
            {routed ? <Badge tone="neutral">intent {routed}</Badge> : null}
            <Badge tone="neutral">criticality {answer.criticality}</Badge>
            {answer.humanReviewRecommended ? <Badge tone="amber">human review recommended</Badge> : null}
            <Badge tone={answer.llmUsed ? "blue" : "grey"}>{answer.llmUsed ? "LLM assisted" : "deterministic"}</Badge>
          </div>
          {answer.runId ? <span className="mono text-[11px] text-slate-500">run {answer.runId}</span> : null}
        </div>
        <div className="panel-body space-y-3">
          {abstained ? (
            <div className="abstain">
              <div className="text-base">{ABSTAIN_TEXT}</div>
              <div className="mt-1 text-xs font-normal text-slate-700">{answer.summary.replace(ABSTAIN_TEXT, "").trim()}</div>
            </div>
          ) : (
            <p className="text-sm leading-relaxed">{answer.summary}</p>
          )}
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <h3 className="text-emerald-800">Known (verified)</h3>
              {answer.known.length ? <ul className="mt-1 list-disc pl-5">{answer.known.map((k, i) => <li key={i}>{k}</li>)}</ul> : <p className="text-slate-500">Nothing verified.</p>}
            </div>
            <div>
              <h3 className="text-red-800">Unknown / not verified</h3>
              {answer.unknown.length ? <ul className="mt-1 list-disc pl-5">{answer.unknown.map((k, i) => <li key={i}>{k}</li>)}</ul> : <p className="text-slate-500">None.</p>}
            </div>
            <div>
              <h3 className="text-slate-700">What would resolve this</h3>
              {answer.resolvingSources.length ? <ul className="mt-1 list-disc pl-5">{answer.resolvingSources.map((k, i) => <li key={i}>{k}</li>)}</ul> : <p className="text-slate-500">Nothing outstanding.</p>}
            </div>
          </div>
        </div>
      </section>

      <AgentData answer={answer} />

      {showClaims ? (
        <Panel title={`Claims (${answer.claims.length})`}>
          <ClaimsTable claims={answer.claims} />
        </Panel>
      ) : null}

      <Panel title="Answer gate report" right={<span className="text-slate-600">proposed {answer.gate.proposed} · verified <span className="text-emerald-700">{answer.gate.verified}</span> · removed <span className="text-red-700">{answer.gate.removed}</span> · removed critical {answer.gate.removedCritical}</span>}>
        {answer.gate.checks.length ? (
          <details>
            <summary>{answer.gate.checks.length} gate checks</summary>
            <table className="data mt-2">
              <thead><tr><th>Claim</th><th>Check</th><th>Passed</th><th>Detail</th></tr></thead>
              <tbody>{answer.gate.checks.map((c, i) => <tr key={i}><td>{c.claim}</td><td className="mono">{c.check}</td><td><Badge tone={c.passed ? "green" : "red"}>{c.passed ? "pass" : "fail"}</Badge></td><td className="text-slate-600">{c.detail ?? ""}</td></tr>)}</tbody>
            </table>
          </details>
        ) : <p className="text-slate-500">No checks (no claims proposed).</p>}
        {answer.runId ? <p className="mt-2 text-slate-500">Run id: <span className="mono">{answer.runId}</span></p> : null}
      </Panel>

      {canReport && answer.runId ? <ReportIncorrectForm runId={answer.runId} /> : null}
    </div>
  );
}
