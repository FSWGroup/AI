import Link from "next/link";
import type { Citation } from "@wpi/core";
import { Badge, verdictTone, statusTone, confidenceTone } from "./Badge";
import { CitationList, CitationsDisclosure } from "./CitationList";
import { Panel, Empty } from "./DataTable";
import { str } from "@/lib/format";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export function Sku({ sku }: { sku: string | null | undefined }) {
  if (!sku) return <span className="text-slate-400">—</span>;
  return <Link href={`/products/${encodeURIComponent(sku)}`} className="mono font-medium">{sku}</Link>;
}

/* ---------------------------------------------------------------- Product finder */
export function FinderPanel({ data }: { data: Any }) {
  const requirements: Any[] = data?.requirements ?? [];
  const matches: Any[] = data?.matches ?? [];
  const demoted: Any[] = data?.demoted ?? [];
  const near: Any[] = data?.nearMatches ?? [];
  const missing: string[] = data?.missingRequirements ?? [];
  return (
    <div className="space-y-3">
      <Panel title="Extracted requirements">
        {requirements.length === 0 ? <Empty>No requirements were extracted.</Empty> : (
          <table className="data">
            <thead><tr><th>Field</th><th>Value</th><th>Provenance</th><th>Note</th></tr></thead>
            <tbody>
              {requirements.map((r, i) => (
                <tr key={i}><td className="mono">{r.key}</td><td className="mono">{str(r.value)}</td><td><Badge tone={verdictTone(r.provenance)}>{r.provenance}</Badge></td><td className="text-slate-600">{r.note ?? ""}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel title={`Matches (${matches.length})`} right={data?.channel ? <Badge tone="blue">channel {data.channel}</Badge> : null}>
        {matches.length === 0 ? <Empty>No verified product satisfies the explicit requirements.</Empty> : matches.map((m) => <MatchCard key={m.sku} m={m} />)}
      </Panel>
      {demoted.length ? (
        <Panel title={`Demoted candidates (${demoted.length})`}>
          <ul className="list-disc pl-5">{demoted.map((d) => <li key={d.sku}><Sku sku={d.sku} /> — {(d.removedClaims ?? []).join("; ")}</li>)}</ul>
        </Panel>
      ) : null}
      <Panel title={`Near matches (${near.length})`}>
        {near.length === 0 ? <Empty>None.</Empty> : (
          <table className="data">
            <thead><tr><th>SKU</th><th>Name</th><th>Mismatched requirements</th></tr></thead>
            <tbody>{near.map((n) => (
              <tr key={n.sku}><td><Sku sku={n.sku} /></td><td>{n.name}</td><td>{(n.mismatches ?? []).map((x: Any, i: number) => <div key={i}><span className="mono">{x.key}</span>: required {str(x.required)}, actual {str(x.actual)}</div>)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Panel>
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Missing requirements">{missing.length ? <ul className="list-disc pl-5 mono">{missing.map((m) => <li key={m}>{m}</li>)}</ul> : <Empty>None.</Empty>}</Panel>
        <Panel title="Next action"><p className="font-medium">{data?.nextAction ?? "—"}</p></Panel>
      </div>
    </div>
  );
}

function MatchCard({ m }: { m: Any }) {
  const matrix: Any[] = m.matrix ?? [];
  const e = m.eligibility ?? {};
  return (
    <div className="mb-3 rounded border border-slate-200 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Sku sku={m.sku} /><span>{m.name}</span><Badge tone="neutral">{m.manufacturer}</Badge>{m.series ? <Badge tone="neutral">series {m.series}</Badge> : null}
        <span className="text-slate-500">{m.matchedRequirements} matched · {m.unknownRequirements} unknown</span>
        <EligibilityBadge e={e} />
      </div>
      <table className="data mt-2">
        <thead><tr><th>Requirement</th><th>Required</th><th>Provenance</th><th>Actual</th><th>Verdict</th></tr></thead>
        <tbody>{matrix.map((r, i) => (
          <tr key={i}><td className="mono">{r.key}</td><td className="mono">{str(r.required)}</td><td><Badge tone={verdictTone(r.provenance)}>{r.provenance}</Badge></td><td className="mono">{r.actual ?? "—"}</td><td><Badge tone={verdictTone(r.verdict)}>{r.verdict}</Badge></td></tr>
        ))}</tbody>
      </table>
      {e.explanation ? <p className="mt-1 text-slate-600">{e.explanation}</p> : null}
      <div className="mt-1"><CitationsDisclosure citations={m.citations} /></div>
    </div>
  );
}

export function EligibilityBadge({ e }: { e: Any }) {
  if (!e) return null;
  if (e.authorized === null || e.authorized === undefined) return <Badge tone="grey">eligibility unknown</Badge>;
  return (
    <span className="inline-flex gap-1">
      <Badge tone={e.authorized ? "green" : "red"}>{e.authorized ? "authorized" : "NOT authorized"}</Badge>
      {e.rfqOnly ? <Badge tone="amber">RFQ only</Badge> : null}
      {e.ecommerce ? <Badge tone="blue">ecommerce</Badge> : null}
      {e.requiresApproval ? <Badge tone="amber">approval required</Badge> : null}
    </span>
  );
}

/* ---------------------------------------------------------------- Cross reference */
const XREF_SECTIONS: { key: string; title: string; note?: string; tone: "green" | "blue" | "amber" | "grey" }[] = [
  { key: "MANUFACTURER_APPROVED_SUBSTITUTE", title: "Manufacturer-approved substitutes", tone: "green" },
  { key: "WELSFORD_APPROVED_SUBSTITUTE", title: "Welsford-approved substitutes", tone: "blue" },
  { key: "TECHNICALLY_SIMILAR_ALTERNATIVE", title: "Technically similar", note: "NOT substitutes — these items share characteristics but are not approved as replacements. Do not quote as an equivalent.", tone: "amber" },
  { key: "POSSIBLE_MATCH_REQUIRING_REVIEW", title: "Possible matches requiring review", note: "Unverified. Application-engineering review is required before any of these is presented to a customer.", tone: "grey" },
];

export function XrefPanel({ data }: { data: Any }) {
  const cats = data?.categories ?? {};
  const supersedes: string[] = data?.supersedes ?? [];
  const candidates: Any[] = data?.candidates ?? [];
  return (
    <div className="space-y-3">
      {data?.sku ? <div className="flex flex-wrap items-center gap-2">Resolved: <Sku sku={data.sku} /> <span>{data.name}</span> <Badge tone="neutral">{data.manufacturer}</Badge> <Badge tone="neutral">match {data.matchType}</Badge></div> : null}
      {XREF_SECTIONS.map((s) => {
        const rows: Any[] = cats[s.key] ?? [];
        return (
          <Panel key={s.key} title={`${s.title} (${rows.length})`} right={<Badge tone={s.tone}>{s.key}</Badge>}>
            {s.note ? <p className="mb-2 rounded border border-amber-300 bg-amber-50 p-2 font-medium text-amber-900">{s.note}</p> : null}
            {rows.length === 0 ? <Empty>None recorded.</Empty> : (
              <table className="data">
                <thead><tr><th>SKU</th><th>Name</th><th>Manufacturer</th><th>Direction</th><th>Verified</th><th>Notes / conditions</th><th>Citations</th></tr></thead>
                <tbody>{rows.map((r, i) => (
                  <tr key={i}><td><Sku sku={r.sku} /></td><td>{r.name}</td><td>{r.manufacturer}</td><td>{r.direction}</td><td><Badge tone={r.verified ? "green" : "grey"}>{r.verified ? "verified" : r.reason ?? "unverified"}</Badge></td><td className="text-slate-600">{r.notes ?? ""}{r.conditions ? <code className="ml-1 text-[11px]">{JSON.stringify(r.conditions)}</code> : null}</td><td><CitationsDisclosure citations={r.citations} /></td></tr>
                ))}</tbody>
              </table>
            )}
          </Panel>
        );
      })}
      <Panel title={`Supersession (${supersedes.length})`}>
        {supersedes.length === 0 ? <Empty>No historical part numbers are recorded as replaced by this item.</Empty> : <ul className="list-disc pl-5">{supersedes.map((s) => <li key={s}><span className="mono">{s}</span> → replaced by <Sku sku={data.sku} /></li>)}</ul>}
      </Panel>
      {candidates.length ? <Panel title="Partial identifier candidates (not asserted)"><ul className="list-disc pl-5">{candidates.map((c, i) => <li key={i}><Sku sku={c.sku} /> <Badge tone="grey">{c.matchType}</Badge></li>)}</ul></Panel> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- Assembly */
export function AssemblyPanel({ data }: { data: Any }) {
  if (!data?.valve) return null;
  const candidates: Any[] = data.candidates ?? [];
  const bom: Any[] = data.bom ?? [];
  return (
    <div className="space-y-3">
      <Panel title="Torque calculation">
        <dl className="kv">
          <dt>Valve</dt><dd><Sku sku={data.valve} /></dd>
          <dt>Break torque (verified)</dt><dd className="mono">{data.breakTorqueInLb} in-lb</dd>
          <dt>Safety factor</dt><dd className="mono">{data.safetyFactor}</dd>
          <dt>Required torque</dt><dd className="mono font-semibold">{data.breakTorqueInLb} × {data.safetyFactor} = {data.requiredTorqueInLb} in-lb</dd>
          <dt>Supply pressure</dt><dd className="mono">{data.supplyPressurePsi} psi</dd>
          <dt>Actuation</dt><dd>{data.actuation}</dd>
          <dt>Selected actuator</dt><dd>{data.selected ? <Sku sku={data.selected} /> : <Badge tone="grey">none</Badge>}</dd>
        </dl>
      </Panel>
      <Panel title={`Candidate actuators (${candidates.length})`}>
        {candidates.length === 0 ? <Empty>No actuator has a verified mounting relationship to this valve.</Empty> : (
          <table className="data">
            <thead><tr><th>SKU</th><th>Name</th><th>Actuation</th><th className="num">Deliverable (in-lb)</th><th className="num">Required (in-lb)</th><th>Result</th><th>Reason</th><th>Accessory</th></tr></thead>
            <tbody>{candidates.map((c) => (
              <tr key={c.sku}><td><Sku sku={c.sku} /></td><td>{c.name}</td><td>{c.actuation ?? "—"}</td><td className="num mono">{c.deliverable ?? "—"}</td><td className="num mono">{data.requiredTorqueInLb}</td><td>{c.passes == null ? <Badge tone="grey">n/a</Badge> : <Badge tone={c.passes ? "green" : "red"}>{c.passes ? "PASS" : "FAIL"}</Badge>}</td><td className="text-slate-600">{c.reason}</td><td className="mono">{c.accessory ?? ""}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Panel>
      <Panel title={`Bill of materials (${bom.length})`}>
        {bom.length === 0 ? <Empty>No BOM: no verified actuator passed the torque check.</Empty> : (
          <table className="data">
            <thead><tr><th>Line</th><th>SKU</th><th>Description</th><th className="num">Qty</th><th>Role</th><th>Basis</th></tr></thead>
            <tbody>{bom.map((b) => <tr key={b.line}><td>{b.line}</td><td><Sku sku={b.sku} /></td><td>{b.description}</td><td className="num">{b.qty}</td><td>{b.role}</td><td className="text-slate-600">{b.basis}</td></tr>)}</tbody>
          </table>
        )}
        {(data.accessoriesUnknown ?? []).length ? <ul className="mt-2 list-disc pl-5 text-amber-800">{data.accessoriesUnknown.map((a: string) => <li key={a}>{a}</li>)}</ul> : null}
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------- RFQ / BOM (read-only view) */
export function RfqLinesTable({ lines }: { lines: Any[] }) {
  if (!lines.length) return <Empty>No lines were parsed from the input.</Empty>;
  return (
    <table className="data">
      <thead><tr><th>Line</th><th className="num">Qty</th><th>Part text</th><th>Description</th><th>Candidate SKU</th><th>Match</th><th>Confidence</th><th>Questions</th><th>Citations</th></tr></thead>
      <tbody>{lines.map((l) => (
        <tr key={l.lineNo}><td>{l.lineNo}</td><td className="num">{l.quantity ?? "?"}</td><td className="mono">{l.partNumberText ?? ""}</td><td className="max-w-xs text-slate-700">{l.description}</td><td><Sku sku={l.candidateSku} />{l.candidateName ? <div className="text-slate-500">{l.candidateName}</div> : null}{(l.candidates ?? []).length ? <details><summary>{l.candidates.length} candidate(s)</summary><ul>{l.candidates.map((c: Any) => <li key={c.sku}><Sku sku={c.sku} /> <Badge tone="grey">{c.matchType}</Badge></li>)}</ul></details> : null}</td><td><Badge tone={l.matchType === "none" ? "grey" : "blue"}>{l.matchType}</Badge></td><td><Badge tone={confidenceTone(l.confidence)}>{l.confidence}</Badge></td><td className="text-slate-600">{(l.questions ?? []).join("; ")}</td><td><CitationsDisclosure citations={l.citations} /></td></tr>
      ))}</tbody>
    </table>
  );
}

export function RfqPanel({ data }: { data: Any }) {
  return (
    <Panel title={`BOM lines (${data?.summary?.total ?? 0}; ${data?.summary?.verified ?? 0} verified, ${data?.summary?.needsReview ?? 0} need review)`} right={data?.rfqId ? <Link href={`/rfq/${data.rfqId}`} className="btn small secondary">Open RFQ {String(data.rfqId).slice(0, 8)} to edit</Link> : null}>
      <RfqLinesTable lines={data?.lines ?? []} />
    </Panel>
  );
}

/* ---------------------------------------------------------------- Documents */
export function DocumentsPanel({ data }: { data: Any }) {
  const docs: Any[] = data?.documents ?? [];
  return (
    <Panel title={`Documents (${docs.length})`} right={data?.documentType ? <Badge tone="blue">{data.documentType}</Badge> : null}>
      {docs.length === 0 ? <Empty>No current document is indexed for this request.</Empty> : (
        <table className="data">
          <thead><tr><th>Title</th><th>Number</th><th>Type</th><th>Rev</th><th className="num">Page</th><th>Snippet</th><th>Verified</th><th>Open</th></tr></thead>
          <tbody>{docs.map((d, i) => (
            <tr key={i}><td>{d.title}</td><td className="mono">{d.documentNumber ?? ""}</td><td>{d.documentType}</td><td className="mono">{d.revision}</td><td className="num">{d.pageNumber}</td><td className="max-w-sm text-slate-600" dangerouslySetInnerHTML={{ __html: sanitizeHeadline(d.snippet) }} /><td><Badge tone={d.verified ? "green" : "grey"}>{d.verified ? "verified" : "unverified"}</Badge></td><td><Link href={`/sources/record/${d.sourceRecordId}`}>record</Link></td></tr>
          ))}</tbody>
        </table>
      )}
    </Panel>
  );
}

/** ts_headline output only contains <b>…</b>; strip everything else. */
export function sanitizeHeadline(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/&lt;b&gt;/g, "<b>").replace(/&lt;\/b&gt;/g, "</b>");
}

/* ---------------------------------------------------------------- Pricing / inventory / eligibility / part lookup */
export function PricingPanel({ data }: { data: Any }) {
  const prices: Any[] = data?.prices ?? [];
  return (
    <Panel title="Pricing" right={data?.channel ? <Badge tone="blue">{data.channel}</Badge> : null}>
      {prices.length === 0 ? <Empty>No verified price record for this channel.</Empty> : (
        <table className="data">
          <thead><tr><th>Type</th><th className="num">Price</th><th>Unit</th><th>Citations</th></tr></thead>
          <tbody>{prices.map((p, i) => <tr key={i}><td className="mono">{p.type}</td><td className="num mono font-medium">{p.price}</td><td>{p.unit}</td><td><CitationsDisclosure citations={p.citations} /></td></tr>)}</tbody>
        </table>
      )}
    </Panel>
  );
}

export function InventoryPanel({ data }: { data: Any }) {
  const rows: Any[] = data?.locations ?? [];
  return (
    <Panel title="Inventory" right={data?.system ? <Badge tone="blue">{String(data.system).toUpperCase()}</Badge> : null}>
      {rows.length === 0 ? <Empty>No synchronized inventory record.</Empty> : (
        <table className="data">
          <thead><tr><th>Field</th><th className="num">Value</th><th>Citations</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><td className="mono">{r.predicate}</td><td className="num mono font-medium">{r.value}</td><td><CitationsDisclosure citations={r.citations} /></td></tr>)}</tbody>
        </table>
      )}
    </Panel>
  );
}

export function EligibilityPanel({ data }: { data: Any }) {
  const d = data?.decision;
  if (!d) return null;
  return (
    <Panel title="Channel eligibility" right={<Badge tone="blue">{data.channel}{data.state ? ` / ${data.state}` : ""}</Badge>}>
      <div className="mb-2"><EligibilityBadge e={d} /></div>
      <p>{d.explanation}</p>
      {(d.appliedRules ?? []).length ? (
        <table className="data mt-2">
          <thead><tr><th>Rule</th><th>Scope</th><th>Territory</th><th>Customer class</th><th>Notes</th></tr></thead>
          <tbody>{d.appliedRules.map((r: Any, i: number) => <tr key={i}><td className="mono">{r.ruleType}</td><td>{r.scopeType}</td><td className="mono">{r.territory ?? "any"}</td><td>{r.customerClass ?? "all"}</td><td className="text-slate-600">{r.notes ?? ""}</td></tr>)}</tbody>
        </table>
      ) : null}
    </Panel>
  );
}

export function PartLookupPanel({ data }: { data: Any }) {
  const resolved: Any[] = data?.resolved ?? [];
  const candidates: Any[] = data?.candidates ?? [];
  const Table = ({ rows }: { rows: Any[] }) => (
    <table className="data">
      <thead><tr><th>SKU</th><th>Name</th><th>Manufacturer</th><th>Series</th><th>Category</th><th>Status</th><th>Match</th><th>Matched identifier</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}><td><Sku sku={r.sku} /></td><td>{r.name}</td><td>{r.manufacturer}</td><td className="mono">{r.series ?? ""}</td><td>{r.category}</td><td><Badge tone={statusTone(r.status)}>{r.status}</Badge></td><td><Badge tone={["exact", "normalized", "historical", "competitor_xref"].includes(r.matchType) ? "green" : "grey"}>{r.matchType}</Badge></td><td className="mono">{r.matchedIdentifier} <span className="text-slate-500">({r.identifierType})</span></td></tr>)}</tbody>
    </table>
  );
  return (
    <div className="space-y-3">
      <Panel title={`Resolved (${resolved.length})`}>{resolved.length ? <Table rows={resolved} /> : <Empty>No exact identifier match.</Empty>}</Panel>
      {candidates.length ? <Panel title={`Partial / fuzzy candidates (${candidates.length}) — not asserted`}><Table rows={candidates} /></Panel> : null}
    </div>
  );
}

export function SpecsPanel({ data }: { data: Any }) {
  if (!data?.sku) return null;
  return (
    <Panel title="Product">
      <div className="flex flex-wrap items-center gap-2"><Sku sku={data.sku} /><span>{data.name}</span><Badge tone="neutral">{data.manufacturer}</Badge>{data.requested?.length ? <span className="text-slate-500">requested: <span className="mono">{data.requested.join(", ")}</span></span> : null}</div>
    </Panel>
  );
}

export function CitationBlock({ citations }: { citations: Citation[] }) {
  return <CitationList citations={citations} />;
}
