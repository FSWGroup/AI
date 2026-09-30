import { db } from "@/lib/db";
import { requireInternal } from "@/lib/guard";
import { loadAssertionsWithEvidence, assertionValue } from "@/lib/evidence";
import { resolveConflictAction } from "@/app/actions/review";
import { Badge, statusTone } from "@/components/Badge";
import { Panel, Empty } from "@/components/DataTable";
import { CitationList } from "@/components/CitationList";
import { Sku } from "@/components/panels";
import { fmtDate, short } from "@/lib/format";

export default async function ConflictsPage({ searchParams }: { searchParams: Promise<{ msg?: string; show?: string }> }) {
  const session = await requireInternal();
  const { msg, show } = await searchParams;
  const sql = db();
  const conflicts = await sql`SELECT c.*, v.canonical_sku, v.name AS variant_name, u.display_name AS resolved_by_name FROM knowledge_conflicts c LEFT JOIN product_variants v ON v.id = c.subject_id LEFT JOIN users u ON u.id = c.resolved_by ${show === "all" ? sql`` : sql`WHERE c.status = 'open'`} ORDER BY c.status = 'open' DESC, c.created_at DESC LIMIT 100`;
  const subjectIds = [...new Set(conflicts.map((c) => c.subjectId as string))];
  const assertions = await loadAssertionsWithEvidence(sql, subjectIds);
  const byId = new Map(assertions.map((a) => [a.id as string, a]));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1>Knowledge Conflicts</h1>
        <span className="text-slate-500">Two or more authoritative sources disagree on the same subject + predicate. Nothing is answerable until a human picks the winner.</span>
        {msg ? <span className="rounded border border-blue-200 bg-blue-50 px-2 py-[2px] text-blue-900">{msg}</span> : null}
        <a href={show === "all" ? "/conflicts" : "/conflicts?show=all"} className="ml-auto">{show === "all" ? "open only" : "show resolved too"}</a>
      </div>
      {conflicts.length === 0 ? <Panel title="Conflicts"><Empty>No open conflicts.</Empty></Panel> : conflicts.map((c) => {
        const ids = c.assertionIds as string[];
        const rows = ids.map((id) => byId.get(id)).filter(Boolean) as typeof assertions;
        return (
          <section key={c.id} className="panel">
            <div className="panel-head">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                <Sku sku={c.canonicalSku} /><span className="text-slate-600">{c.variantName}</span>
                <span className="mono font-medium">{c.predicate}</span>
                <span>{c.description}</span>
              </div>
              <span className="mono text-[11px] text-slate-500">{short(c.id)} · {fmtDate(c.createdAt)}</span>
            </div>
            <div className="panel-body">
              {c.status !== "open" ? <p className="mb-2 text-slate-600">Resolved by {c.resolvedByName ?? "?"} at {fmtDate(c.resolvedAt)}; winning assertion <span className="mono">{short(c.resolvedAssertionId)}</span>.</p> : null}
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(rows.length, 3))}, minmax(0, 1fr))` }}>
                {rows.map((a) => (
                  <div key={a.id} className={`rounded border p-2 ${c.resolvedAssertionId === a.id ? "border-emerald-400 bg-emerald-50" : "border-slate-200"}`}>
                    <div className="flex items-center gap-2"><span className="mono text-xl font-semibold">{assertionValue(a)}{a.unit ? <span className="text-sm font-normal text-slate-500"> {a.unit}</span> : null}</span><Badge tone={statusTone(a.status)}>{a.status}</Badge></div>
                    <div className="text-[11px] text-slate-500">assertion {short(a.id)} · criticality {a.criticality} · effective {a.effectiveDate ? String(a.effectiveDate).slice(0, 10) : "—"} · updated {fmtDate(a.updatedAt)}</div>
                    <div className="mt-2"><CitationList citations={a.evidence} compact /></div>
                    {c.status === "open" && session.canReview ? (
                      <form action={resolveConflictAction} className="mt-2 flex gap-1">
                        <input type="hidden" name="conflictId" value={c.id} /><input type="hidden" name="assertionId" value={a.id} />
                        <input type="text" name="note" placeholder="resolution note" className="w-full" />
                        <button className="btn small">Resolve with this value</button>
                      </form>
                    ) : null}
                  </div>
                ))}
              </div>
              {c.status === "open" && !session.canReview ? <p className="mt-2 text-slate-500">Read-only: review_knowledge permission is required to resolve.</p> : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
