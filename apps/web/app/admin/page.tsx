import { db } from "@/lib/db";
import { requireInternal } from "@/lib/guard";
import { Badge, statusTone, confidenceTone } from "@/components/Badge";
import { Panel, Empty } from "@/components/DataTable";
import { fmtDate, short } from "@/lib/format";

export default async function AdminPage() {
  await requireInternal();
  const sql = db();
  const [users, roles, orgs, rules, audit, runs, escalations] = await Promise.all([
    sql`SELECT u.id, u.email, u.display_name, u.role_id, u.created_at, o.slug AS org, c.name AS customer FROM users u LEFT JOIN organizations o ON o.id = u.organization_id LEFT JOIN customers c ON c.id = u.customer_id ORDER BY o.slug, u.role_id, u.email`,
    sql`SELECT * FROM roles ORDER BY id`,
    sql`SELECT o.*, (SELECT count(*) FROM users u WHERE u.organization_id = o.id) AS users, (SELECT string_agg(sc.id, ', ') FROM sales_channels sc WHERE sc.organization_id = o.id) AS channels FROM organizations o ORDER BY o.slug`,
    sql`SELECT r.*, t.name AS territory_name, t.state,
          CASE r.scope_type WHEN 'manufacturer' THEN (SELECT name FROM manufacturers WHERE id = r.scope_id) WHEN 'series' THEN (SELECT code || ' ' || name FROM product_series WHERE id = r.scope_id) WHEN 'family' THEN (SELECT name FROM product_families WHERE id = r.scope_id) WHEN 'variant' THEN (SELECT canonical_sku FROM product_variants WHERE id = r.scope_id) END AS scope_name
        FROM channel_rules r LEFT JOIN territories t ON t.code = r.territory_code ORDER BY r.channel_id, r.priority, r.scope_type`,
    sql`SELECT a.*, u.display_name FROM audit_events a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 50`,
    sql`SELECT r.id, r.agent, r.channel_id, r.role_id, r.mode, r.question, r.outcome, r.confidence, r.llm_used, r.llm_model, r.latency_ms, r.created_at, u.display_name FROM agent_runs r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.created_at DESC LIMIT 50`,
    sql`SELECT e.*, u.display_name AS answered_by_name FROM human_escalations e LEFT JOIN users u ON u.id = e.answered_by ORDER BY e.status = 'open' DESC, e.created_at DESC LIMIT 50`,
  ]);
  return (
    <div className="space-y-4">
      <h1>Administration</h1>
      <p className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900"><b>Development authentication:</b> identity comes from the <span className="mono">wpi_user</span> cookie set by the top-bar switcher. Permissions are still enforced at the data/agent layer from the role table below, never by the UI alone.</p>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title={`Users (${users.length})`}>
          <table className="data"><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Organization</th><th>Customer</th><th>Created</th></tr></thead>
            <tbody>{users.map((u) => <tr key={u.id}><td className="mono">{u.email}</td><td>{u.displayName}</td><td><Badge tone="blue">{u.roleId}</Badge></td><td>{u.org ?? "—"}</td><td>{u.customer ?? "—"}</td><td className="whitespace-nowrap text-slate-500">{fmtDate(u.createdAt)}</td></tr>)}</tbody></table>
        </Panel>
        <Panel title={`Roles (${roles.length})`}>
          <table className="data"><thead><tr><th>Role</th><th>Description</th><th>Permissions</th></tr></thead>
            <tbody>{roles.map((r) => <tr key={r.id}><td className="mono font-medium">{r.id}</td><td>{r.description}</td><td className="flex flex-wrap gap-1">{(r.permissions as string[]).map((p) => <Badge key={p} tone={p === "view_cost" || p === "review_knowledge" ? "amber" : "neutral"}>{p}</Badge>)}</td></tr>)}</tbody></table>
          <h3 className="mt-3">Organizations</h3>
          <table className="data mt-1"><thead><tr><th>Slug</th><th>Name</th><th>Channels</th><th className="num">Users</th></tr></thead>
            <tbody>{orgs.map((o) => <tr key={o.id}><td className="mono">{o.slug}</td><td>{o.name}</td><td className="mono">{o.channels ?? "—"}</td><td className="num">{o.users}</td></tr>)}</tbody></table>
        </Panel>
      </div>
      <Panel title={`Channel / territory rules (${rules.length})`} right={<span className="text-slate-500">lower priority number wins on conflict · NULL territory = everywhere the channel operates</span>}>
        <table className="data"><thead><tr><th>Channel</th><th>Rule</th><th>Scope</th><th>Scope target</th><th>Territory</th><th>Customer class</th><th className="num">Priority</th><th>Effective</th><th>Expires</th><th>Notes</th><th>Evidence</th></tr></thead>
          <tbody>{rules.map((r) => <tr key={r.id}><td><Badge tone={r.channelId === "welsford" ? "blue" : "green"}>{r.channelId}</Badge></td><td className="mono">{r.ruleType}</td><td>{r.scopeType}</td><td className="mono">{r.scopeName ?? short(r.scopeId)}</td><td>{r.territoryCode ? <span className="mono">{r.territoryCode}</span> : <span className="text-slate-400">any</span>}{r.territoryName ? <span className="text-slate-500"> {r.territoryName}</span> : null}</td><td>{r.customerClass ?? <span className="text-slate-400">all</span>}</td><td className="num">{r.priority}</td><td className="text-slate-500">{r.effectiveDate ? String(r.effectiveDate).slice(0, 10) : "—"}</td><td className="text-slate-500">{r.expiresAt ? fmtDate(r.expiresAt) : "—"}</td><td className="max-w-md text-slate-600">{r.notes ?? ""}</td><td>{r.sourceRecordId ? <a href={`/sources/record/${r.sourceRecordId}`}>record</a> : "—"}</td></tr>)}</tbody></table>
      </Panel>
      <Panel title={`Human escalations (${escalations.length})`}>
        {escalations.length === 0 ? <Empty>No escalations.</Empty> : (
          <table className="data"><thead><tr><th>Status</th><th>Created</th><th className="num">Crit.</th><th>Question</th><th>Reason</th><th>Known</th><th>Unknowns</th><th>Answer</th></tr></thead>
            <tbody>{escalations.map((e) => <tr key={e.id}><td><Badge tone={statusTone(e.status)}>{e.status}</Badge></td><td className="whitespace-nowrap text-slate-500">{fmtDate(e.createdAt)}</td><td className="num">{e.criticality}</td><td className="max-w-xs">{e.question}</td><td className="text-slate-600">{e.reason}</td><td className="max-w-xs text-[11.5px]">{((e.knownFacts ?? []) as string[]).join("; ")}</td><td className="max-w-xs text-[11.5px]">{((e.unknowns ?? []) as string[]).join("; ")}</td><td>{e.answer ? <>{e.answer} <span className="text-slate-500">({e.answeredByName})</span></> : "—"}</td></tr>)}</tbody></table>
        )}
      </Panel>
      <Panel title={`Agent runs (last ${runs.length})`}>
        <table className="data"><thead><tr><th>When</th><th>Agent</th><th>User / role</th><th>Channel</th><th>Mode</th><th>Question</th><th>Outcome</th><th>Confidence</th><th>LLM</th><th className="num">ms</th><th>Run</th></tr></thead>
          <tbody>{runs.map((r) => <tr key={r.id}><td className="whitespace-nowrap text-slate-500">{fmtDate(r.createdAt)}</td><td>{r.agent}</td><td>{r.displayName ?? "anonymous"} <span className="text-slate-500">/ {r.roleId}</span></td><td>{r.channelId}</td><td>{r.mode}</td><td className="max-w-sm truncate" title={r.question}>{r.question}</td><td><Badge tone={statusTone(r.outcome)}>{r.outcome}</Badge></td><td><Badge tone={confidenceTone(r.confidence)}>{r.confidence}</Badge></td><td>{r.llmUsed ? <Badge tone="blue">{r.llmModel ?? "yes"}</Badge> : <span className="text-slate-400">no</span>}</td><td className="num mono">{r.latencyMs}</td><td className="mono text-slate-500">{short(r.id)}</td></tr>)}</tbody></table>
      </Panel>
      <Panel title={`Audit events (last ${audit.length})`}>
        {audit.length === 0 ? <Empty>No audit events.</Empty> : (
          <table className="data"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
            <tbody>{audit.map((a) => <tr key={a.id}><td className="whitespace-nowrap text-slate-500">{fmtDate(a.createdAt)}</td><td>{a.displayName ?? "—"}</td><td className="mono">{a.action}</td><td className="mono">{a.targetType} {short(a.targetId)}</td><td><code className="text-[11px]">{JSON.stringify(a.details)}</code></td></tr>)}</tbody></table>
        )}
      </Panel>
    </div>
  );
}
