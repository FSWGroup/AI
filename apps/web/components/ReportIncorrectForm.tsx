"use client";
import { useActionState } from "react";
import { reportIncorrectAction, type ReportState } from "@/app/actions/answers";

const TEMPLATE = `{
  "outcome": "answered",
  "claims": [{ "subject": "BVW-S70-200", "predicate": "pressure_rating_psi", "value": "1000", "severity": 1 }],
  "forbiddenClaims": []
}`;

export function ReportIncorrectForm({ runId }: { runId: string }) {
  const [state, action, pending] = useActionState<ReportState, FormData>(reportIncorrectAction, {});
  return (
    <details className="panel">
      <summary className="panel-head cursor-pointer"><h2>Report incorrect answer</h2></summary>
      <form action={action} className="panel-body space-y-2">
        <input type="hidden" name="runId" value={runId} />
        <label className="block">
          <span className="text-slate-600">Corrected answer (JSON: outcome, claims[], forbiddenClaims[])</span>
          <textarea name="correctedAnswer" rows={7} defaultValue={TEMPLATE} className="mono mt-1 w-full" />
        </label>
        <label className="block">
          <span className="text-slate-600">Root cause</span>
          <input type="text" name="rootCause" className="mt-1 w-full" placeholder="e.g. stale datasheet revision cited; rule missing for territory" required />
        </label>
        <div className="flex items-center gap-3">
          <button className="btn" disabled={pending}>{pending ? "Submitting…" : "Submit correction"}</button>
          {state.message ? <span className={state.ok ? "text-emerald-700" : "text-red-700"}>{state.message}</span> : null}
        </div>
      </form>
    </details>
  );
}
