import type { GatedClaim } from "@wpi/core";
import { Badge, statusTone } from "./Badge";
import { CitationsDisclosure } from "./CitationList";

export function ClaimsTable({ claims }: { claims: GatedClaim[] }) {
  if (!claims.length) return <p className="text-slate-500">No claims were proposed.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="data">
        <thead>
          <tr>
            <th>#</th><th>Subject</th><th>Predicate</th><th>Value</th><th>Unit</th><th>Kind</th><th className="num">Crit.</th><th>Status</th><th>Reason</th><th>Citations</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((c, i) => (
            <tr key={i} className={c.status === "verified" ? "" : "opacity-80"}>
              <td className="text-slate-400">{i}</td>
              <td className="mono">{c.subjectRef}</td>
              <td className="mono">{c.predicate}</td>
              <td className="mono font-medium">{c.value}</td>
              <td>{c.unit ?? ""}</td>
              <td>{c.kind}</td>
              <td className="num">{c.criticality}{c.critical ? <span title="critical: unverifiable → whole answer abstains" className="text-red-700">*</span> : null}</td>
              <td><Badge tone={statusTone(c.status)}>{c.status}</Badge></td>
              <td className="max-w-xs text-slate-600">{c.reason ?? ""}</td>
              <td><CitationsDisclosure citations={c.citations} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
