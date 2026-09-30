import type { Sql } from "../db/client.ts";
import type { Principal } from "../auth/rbac.ts";
import { PUBLIC_PRINCIPAL, allowedChannels, restrictedPredicatesFor } from "../auth/rbac.ts";
import type { LlmProvider } from "../llm/provider.ts";
import { NullProvider } from "../llm/provider.ts";
import type { Answer, GatedClaim, ProposedClaim } from "../answer/types.ts";
import { runAnswerGate, buildAnswer, type GateResult } from "../gate/answerGate.ts";

export interface AgentContext {
  sql: Sql;
  principal: Principal;
  channelId: "welsford" | "valveman";
  state?: string | null;          // customer's US state for territory rules
  customerId?: string | null;     // customer context (P21 customer uuid)
  customerClass?: string | null;
  mode: "interactive" | "shadow" | "evaluation";
  llm: LlmProvider;
  now?: Date;
  retrievalTrace: { stage: string; query: unknown; resultCount: number; latencyMs: number }[];
}

export function makeContext(sql: Sql, overrides: Partial<AgentContext> = {}): AgentContext {
  return { sql, principal: PUBLIC_PRINCIPAL, channelId: "valveman", mode: "interactive", llm: new NullProvider(), retrievalTrace: [], ...overrides };
}

export function trace<T>(ctx: AgentContext, stage: string, query: unknown, fn: () => Promise<T>, count: (r: T) => number): Promise<T> {
  const t0 = Date.now();
  return fn().then((r) => { ctx.retrievalTrace.push({ stage, query, resultCount: count(r), latencyMs: Date.now() - t0 }); return r; });
}

export async function gate(ctx: AgentContext, claims: ProposedClaim[]): Promise<GateResult> {
  return runAnswerGate(claims, { sql: ctx.sql, channelId: ctx.channelId, now: ctx.now, restrictedPredicates: restrictedPredicatesFor(ctx.principal, { customerId: ctx.customerId }) });
}

export { buildAnswer };

/** Predicates the current principal may not receive (agents use this to avoid proposing claims that would only be stripped). */
export function restricted(ctx: AgentContext): Set<string> { return restrictedPredicatesFor(ctx.principal, { customerId: ctx.customerId }); }

/** Channel permission check. Returns an abstained Answer when the principal may not act in the channel, else null. */
export async function channelDenied(ctx: AgentContext, agent: string, question: string, channel: "welsford" | "valveman", criticality = 2): Promise<Answer | null> {
  if (allowedChannels(ctx.principal).includes(channel)) return null;
  const g = await runAnswerGate([], { sql: ctx.sql });
  g.outcome = "abstained"; g.confidence = "INSUFFICIENT_EVIDENCE";
  const answer = buildAnswer({ agent, question, criticality, gate: g, unknown: [`The ${channel} channel is not available to this user`], resolvingSources: ["Sign in with a Welsford account to query this channel"], humanReview: false });
  await recordRun(ctx, answer, 0);
  return answer;
}
export type { Answer, GatedClaim, ProposedClaim };

/** Persist a run with its claims, citations and retrieval trace so every answer is auditable/reproducible. */
export async function recordRun(ctx: AgentContext, answer: Answer, latencyMs: number): Promise<string> {
  const sql = ctx.sql;
  const [run] = await sql`INSERT INTO agent_runs (agent, channel_id, user_id, role_id, mode, question, criticality, outcome, confidence, answer, gate_report, llm_used, llm_model, latency_ms)
    VALUES (${answer.agent}, ${ctx.channelId}, ${ctx.principal.userId}, ${ctx.principal.roleId}, ${ctx.mode}, ${answer.question}, ${answer.criticality}, ${answer.outcome}, ${answer.confidence},
            ${sql.json({ input: answer.input ?? null, summary: answer.summary, known: answer.known, unknown: answer.unknown, data: answer.data ?? null } as never)}, ${sql.json(answer.gate as never)}, ${answer.llmUsed}, ${answer.llmUsed ? ctx.llm.model : null}, ${latencyMs}) RETURNING id`;
  for (const c of answer.claims) {
    const [claim] = await sql`INSERT INTO claims (run_id, subject_ref, predicate, value, criticality, status, assertion_id, reason) VALUES (${run.id}, ${c.subjectRef}, ${c.predicate}, ${c.value}, ${c.criticality}, ${c.status}, ${c.support.assertionId ?? null}, ${c.reason ?? null}) RETURNING id`;
    for (const cit of c.citations) await sql`INSERT INTO citations (claim_id, source_record_id, supporting_text, label) VALUES (${claim.id}, ${cit.sourceRecordId}, ${cit.supportingText}, ${cit.label})`;
  }
  for (const t of ctx.retrievalTrace) await sql`INSERT INTO retrieval_events (run_id, stage, query, result_count, latency_ms) VALUES (${run.id}, ${t.stage}, ${sql.json(t.query as never)}, ${t.resultCount}, ${t.latencyMs})`;
  if (answer.outcome === "abstained" && answer.criticality >= 4) {
    await sql`INSERT INTO human_escalations (agent_run_id, reason, criticality, question, known_facts, unknowns) VALUES (${run.id}, 'abstained on engineering-sensitive question', ${answer.criticality}, ${answer.question}, ${sql.json(answer.known as never)}, ${sql.json(answer.unknown as never)})`;
  }
  answer.runId = run.id;
  return run.id;
}
