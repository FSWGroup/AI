"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { saveBomAction, type SaveBomState } from "@/app/actions/rfq";
import { Badge, confidenceTone } from "./Badge";
import { CitationsDisclosure } from "./CitationList";
import type { Citation } from "@wpi/core";

export interface BomLine {
  id: string; lineNo: number; raw: string; quantity: number | null; partNumberText: string | null; description: string | null;
  candidateSku: string | null; candidateName: string | null; matchType: string | null; confidence: string | null; questions: string[]; citations: Citation[];
  candidates: { sku: string; name: string; matchType: string }[];
}

export function BomEditor({ rfqId, initial }: { rfqId: string; initial: BomLine[] }) {
  const [lines, setLines] = useState(initial);
  const [state, action, pending] = useActionState<SaveBomState, FormData>(saveBomAction, {});
  const update = (id: string, patch: Partial<BomLine>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const payload = JSON.stringify(lines.map((l) => ({ id: l.id, quantity: l.quantity, candidateSku: l.candidateSku })));
  return (
    <form action={action}>
      <input type="hidden" name="rfqId" value={rfqId} />
      <input type="hidden" name="lines" value={payload} />
      <div className="overflow-x-auto">
        <table className="data">
          <thead><tr><th>Line</th><th className="num">Qty</th><th>Part text</th><th>Description</th><th>Candidate SKU</th><th>Match</th><th>Confidence</th><th>Questions</th><th>Citations</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>{l.lineNo}</td>
                <td className="num"><input type="number" min={0} value={l.quantity ?? ""} onChange={(e) => update(l.id, { quantity: e.target.value === "" ? null : Number(e.target.value) })} className="mono w-20 text-right" /></td>
                <td className="mono">{l.partNumberText ?? ""}</td>
                <td className="max-w-xs text-slate-700" title={l.raw}>{l.description}</td>
                <td>
                  <input type="text" value={l.candidateSku ?? ""} onChange={(e) => update(l.id, { candidateSku: e.target.value.toUpperCase() || null })} className="mono w-40" placeholder="BVW-…" list={`cands-${l.id}`} />
                  <datalist id={`cands-${l.id}`}>{l.candidates.map((c) => <option key={c.sku} value={c.sku}>{c.name}</option>)}</datalist>
                  {l.candidateSku ? <div className="text-[11px]"><Link href={`/products/${encodeURIComponent(l.candidateSku)}`}>{l.candidateName ?? "open"}</Link></div> : null}
                  {l.candidates.length ? <div className="text-[11px] text-slate-500">{l.candidates.length} suggestion(s)</div> : null}
                </td>
                <td><Badge tone={!l.matchType || l.matchType === "none" ? "grey" : "blue"}>{l.matchType ?? "none"}</Badge></td>
                <td><Badge tone={confidenceTone(l.confidence)}>{l.confidence ?? "—"}</Badge></td>
                <td className="max-w-xs text-slate-600">{l.questions.join("; ")}</td>
                <td><CitationsDisclosure citations={l.citations} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button className="btn" disabled={pending}>{pending ? "Saving…" : "Save BOM"}</button>
        {state.message ? <span className={state.ok ? "text-emerald-700" : "text-red-700"}>{state.message}</span> : null}
        <span className="text-slate-500">Edited SKUs are re-resolved server-side; any edited line is marked NEEDS_REVIEW.</span>
      </div>
    </form>
  );
}
