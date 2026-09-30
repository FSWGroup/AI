import Link from "next/link";
import { listReviews } from "@wpi/core";
import { db } from "@/lib/db";
import { requireInternal } from "@/lib/guard";
import { assertionValue } from "@/lib/evidence";
import { approveReviewAction, rejectReviewAction, correctAssertionAction, commentReviewAction } from "@/app/actions/review";
import { Badge, statusTone } from "@/components/Badge";
import { Panel, Empty } from "@/components/DataTable";
import { Sku } from "@/components/panels";
import { fmtDate, short } from "@/lib/format";

const STATUSES = ["open", "approved", "rejected", "corrected", "superseded", "closed"];
const TYPES = ["new_relationship", "source_conflict", "possible_substitution", "missing_attribute", "ambiguous_mapping", "document_revision", "taxonomy_change", "stale_evidence", "low_confidence_assertion", "answer_correction", "escalation"];

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ status?: string; type?: string; msg?: string }> }) {
  const session = await requireInternal();
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status ?? "") ? sp.status : sp.status === "all" ? undefined : "open";
  const type = TYPES.includes(sp.type ?? "") ? sp.type : undefined;
  const sql = db();
  const reviews = await listReviews(sql, { status, type, limit: 200 });
  const assertionIds = reviews.filter((r) => r.targetType === "assertion" && r.targetId).map((r) => r.targetId as string);
  const assertions = assertionIds.length ? await sql`SELECT a.id, a.predicate, a.value_text, a.value_number, a.value_number_max, a.value_json, a.unit, a.status, v.canonical_sku FROM knowledge_assertions a LEFT JOIN product_variants v ON v.id = a.subject_id WHERE a.id = ANY(${assertionIds})` : [];
  const aMap = new Map(assertions.map((a) => [a.id as string, a]));
  const reviewIds = reviews.map((r) => r.id as string);
  const comments = reviewIds.length ? await sql`SELECT c.review_id, c.body, c.created_at, u.display_name FROM review_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.review_id = ANY(${reviewIds}) ORDER BY c.created_at` : [];
  const regressions = await sql`SELECT rc.*, ec.agent, ec.category, kr.status AS review_status FROM regression_cases rc JOIN evaluation_cases ec ON ec.id = rc.evaluation_case_id LEFT JOIN knowledge_reviews kr ON kr.id = rc.review_id ORDER BY rc.created_at DESC LIMIT 100`;
  const canAct = session.canReview;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1>Knowledge Review Center</h1>
        {canAct ? <Badge tone="green">review_knowledge</Badge> : <Badge tone="grey">read-only (no review_knowledge permission)</Badge>}
        {sp.msg ? <span className="rounded border border-blue-200 bg-blue-50 px-2 py-[2px] text-blue-900">{sp.msg}</span> : null}
      </div>
      <form method="get" className="panel flex flex-wrap items-center gap-2 p-3">
        <label>Status <select name="status" defaultValue={status ?? "all"}><option value="all">all</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <label>Type <select name="type" defaultValue={type ?? ""}><option value="">all</option>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <button className="btn secondary" type="submit">Filter</button>
        <span className="text-slate-500">{reviews.length} review(s), ordered by priority</span>
      </form>
      {reviews.length === 0 ? <Panel title="Reviews"><Empty>No reviews match the filter.</Empty></Panel> : reviews.map((r) => {
        const a = r.targetType === "assertion" && r.targetId ? aMap.get(r.targetId as string) : null;
        const cs = comments.filter((c) => c.reviewId === r.id);
        const payload = r.payload as Record<string, unknown> | null;
        return (
          <section key={r.id} className="panel">
            <div className="panel-head">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                <Badge tone="blue">{r.reviewType}</Badge>
                <Badge tone="neutral">P{r.priority}</Badge>
                <span className="font-medium">{r.summary}</span>
              </div>
              <span className="mono text-[11px] text-slate-500">{short(r.id)} · {fmtDate(r.createdAt)}</span>
            </div>
            <div className="panel-body grid gap-3 lg:grid-cols-[1fr_380px]">
              <div className="space-y-2">
                <div className="text-slate-600">Target: <span className="mono">{r.targetType}</span> {r.targetType === "conflict" ? <Link href="/conflicts">open in Conflicts →</Link> : r.targetType === "answer" ? <span className="mono">run {short(r.targetId)}</span> : <span className="mono">{short(r.targetId)}</span>}</div>
                {a ? (
                  <table className="data"><thead><tr><th>Subject</th><th>Predicate</th><th>Current value</th><th>Unit</th><th>Assertion status</th></tr></thead>
                    <tbody><tr><td><Sku sku={a.canonicalSku} /></td><td className="mono">{a.predicate}</td><td className="mono">{assertionValue(a)}</td><td>{a.unit ?? ""}</td><td><Badge tone={statusTone(a.status)}>{a.status}</Badge></td></tr></tbody></table>
                ) : null}
                {payload ? <details><summary>payload</summary><pre className="mt-1 max-h-60 overflow-auto rounded bg-slate-50 p-2 text-[11px]">{JSON.stringify(payload, null, 2)}</pre></details> : null}
                {r.decidedByName ? <div className="text-slate-600">Decided by {r.decidedByName} at {fmtDate(r.decidedAt)}{r.decisionNote ? ` — ${r.decisionNote}` : ""}</div> : null}
                {cs.length ? <ul className="space-y-1 border-l-2 border-slate-200 pl-2">{cs.map((c, i) => <li key={i}><span className="text-slate-500">{c.displayName ?? "?"} · {fmtDate(c.createdAt)}:</span> {c.body}</li>)}</ul> : null}
              </div>
              {canAct ? (
                <div className="space-y-2 border-l border-slate-200 pl-3">
                  {r.status === "open" && (r.targetType === "assertion" || r.targetType === "relationship") ? (
                    <div className="flex flex-wrap gap-2">
                      <form action={approveReviewAction} className="flex gap-1"><input type="hidden" name="reviewId" value={r.id} /><input type="text" name="note" placeholder="note" className="w-36" /><button className="btn small">Approve</button></form>
                      <form action={rejectReviewAction} className="flex gap-1"><input type="hidden" name="reviewId" value={r.id} /><input type="text" name="note" placeholder="note" className="w-36" /><button className="btn small danger">Reject</button></form>
                    </div>
                  ) : null}
                  {a && r.status === "open" ? (
                    <form action={correctAssertionAction} className="space-y-1 rounded border border-slate-200 p-2">
                      <input type="hidden" name="reviewId" value={r.id} /><input type="hidden" name="assertionId" value={a.id} />
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">Correct value (creates a human_approved override)</div>
                      <div className="flex gap-1"><input type="text" name="value" placeholder="new value" className="mono w-32" required /><input type="text" name="unit" placeholder="unit" defaultValue={a.unit ?? ""} className="w-16" /></div>
                      <input type="text" name="justification" placeholder="justification (required)" className="w-full" required />
                      <button className="btn small secondary">Correct</button>
                    </form>
                  ) : null}
                  <form action={commentReviewAction} className="flex gap-1"><input type="hidden" name="reviewId" value={r.id} /><input type="text" name="body" placeholder="comment" className="w-full" required /><button className="btn small secondary">Comment</button></form>
                </div>
              ) : null}
            </div>
          </section>
        );
      })}
      <Panel title={`Regression cases from answer corrections (${regressions.length})`}>
        {regressions.length === 0 ? <Empty>No regression cases yet. Use "Report incorrect answer" on any answer to create one.</Empty> : (
          <table className="data"><thead><tr><th>Case</th><th>Agent</th><th>Question</th><th>Root cause</th><th>Corrected answer</th><th>Review</th><th>Created</th></tr></thead>
            <tbody>{regressions.map((r) => <tr key={r.id}><td className="mono">{r.evaluationCaseId}</td><td>{r.agent}</td><td className="max-w-xs">{r.question}</td><td className="max-w-xs text-slate-600">{r.rootCause}</td><td><details><summary>json</summary><pre className="max-w-md overflow-auto text-[11px]">{JSON.stringify(r.correctedAnswer, null, 1)}</pre></details></td><td><Badge tone={statusTone(r.reviewStatus)}>{r.reviewStatus ?? "—"}</Badge></td><td className="whitespace-nowrap text-slate-500">{fmtDate(r.createdAt)}</td></tr>)}</tbody></table>
        )}
      </Panel>
    </div>
  );
}
