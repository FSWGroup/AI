import 'server-only';
import { db } from '@/lib/db';
import type { Ctx } from '@/lib/authz';
import { workerFacts, audienceMatches, type Audience } from '@/lib/audience';
import { ptoBalance } from '@/lib/pto';

/**
 * What the HR copilot is allowed to see.
 *
 * This module is the whole security boundary for the assistant. The rule it
 * exists to enforce is simple and absolute: **the assistant sees exactly what
 * the asking user could already read, and nothing else.** It has no
 * credentials of its own, it does not query on behalf of anybody else, and
 * there is no "assistant role" with elevated access.
 *
 * Concretely:
 *   - Policies are filtered by the same audience rules that decide whether the
 *     policy appears on that person's own policy list.
 *   - Personal facts are the asker's own: their leave balance, their manager,
 *     their next holiday. Never a colleague's, at any permission level —
 *     a question about somebody else is answered by the directory, not here.
 *   - Nothing encrypted, nothing from a confidential case file, no pay
 *     figures, no document contents.
 *
 * Everything assembled here is quoted back to the user with a citation, so if
 * retrieval ever over-reached it would be visible rather than silent.
 */

export interface PolicyExcerpt {
  policyId: string;
  versionId: string;
  title: string;
  category: string | null;
  version: number;
  effectiveAt: Date;
  text: string;
}

export interface CopilotContext {
  askerFirstName: string;
  policies: PolicyExcerpt[];
  /** The asker's own facts, in plain language. Never anybody else's. */
  personalFacts: string[];
  /** Diagnostics recorded on the answer, so retrieval is auditable. */
  basis: {
    policiesConsidered: number;
    policiesVisible: number;
    policiesSent: number;
    includedPersonalFacts: boolean;
  };
}

const MAX_POLICIES = 8;
const MAX_POLICY_CHARS = 6_000;

/** Strip markup so a policy body can be quoted as text. */
export function policyToText(bodyHtml: string | null): string {
  if (!bodyHtml) return '';
  return bodyHtml
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h[1-6]|div)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Cheap lexical relevance. No embeddings, no vector store, no extra service. */
export function scoreRelevance(question: string, title: string, text: string): number {
  const stop = new Set([
    'the', 'a', 'an', 'is', 'are', 'do', 'does', 'i', 'my', 'me', 'we', 'our', 'to', 'of', 'for',
    'in', 'on', 'and', 'or', 'how', 'what', 'when', 'can', 'if', 'it', 'be', 'you', 'your',
  ]);
  const terms = [...new Set(question.toLowerCase().match(/[a-z]{3,}/g) ?? [])].filter((t) => !stop.has(t));
  if (terms.length === 0) return 0;
  const haystackTitle = title.toLowerCase();
  const haystackBody = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    // A title hit is worth far more than a body mention.
    if (haystackTitle.includes(term)) score += 10;
    const occurrences = haystackBody.split(term).length - 1;
    score += Math.min(occurrences, 5);
  }
  return score;
}

/**
 * Assemble the context for one question.
 *
 * `ctx` is the asking user's own authorization context — the same one every
 * page and server action uses. It is not widened here.
 */
export async function buildCopilotContext(ctx: Ctx, question: string): Promise<CopilotContext> {
  const worker = ctx.workerId
    ? await db.worker.findUnique({
        where: { id: ctx.workerId },
        select: { legalFirstName: true, preferredName: true, hireDate: true, country: true },
      })
    : null;

  // Published policy versions only — a draft is not the rule yet.
  const published = await db.policyVersion.findMany({
    where: { publishedAt: { not: null }, policy: { active: true } },
    include: { policy: { select: { id: true, title: true, category: true, active: true } } },
    orderBy: [{ policyId: 'asc' }, { version: 'desc' }],
  });

  // Only the newest published version of each policy.
  const newest = new Map<string, (typeof published)[number]>();
  for (const version of published) {
    if (!newest.has(version.policyId)) newest.set(version.policyId, version);
  }
  const candidates = [...newest.values()];

  // THE filter: the same audience rules that decide whether this policy shows
  // on this person's own policy list.
  const facts = ctx.workerId ? await workerFacts(ctx.workerId) : null;
  const visible = facts
    ? candidates.filter((v) => audienceMatches(v.audience as Audience, facts))
    : // A user with no worker record (a system admin account) sees only
      // policies published to everyone.
      candidates.filter((v) => Object.keys((v.audience as object) ?? {}).length === 0);

  const scored = visible
    .map((v) => {
      const text = policyToText(v.bodyHtml);
      return { version: v, text, score: scoreRelevance(question, v.policy.title, text) };
    })
    .filter((row) => row.text.length > 0 && row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_POLICIES);

  const policies: PolicyExcerpt[] = scored.map(({ version, text }) => ({
    policyId: version.policyId,
    versionId: version.id,
    title: version.policy.title,
    category: version.policy.category,
    version: version.version,
    effectiveAt: version.effectiveAt,
    text: text.length > MAX_POLICY_CHARS ? `${text.slice(0, MAX_POLICY_CHARS)}\n[truncated]` : text,
  }));

  const personalFacts = ctx.workerId ? await ownFacts(ctx.workerId, worker) : [];

  return {
    askerFirstName: worker?.preferredName || worker?.legalFirstName || 'there',
    policies,
    personalFacts,
    basis: {
      policiesConsidered: candidates.length,
      policiesVisible: visible.length,
      policiesSent: policies.length,
      includedPersonalFacts: personalFacts.length > 0,
    },
  };
}

/**
 * The asker's own situation, as short factual sentences.
 *
 * Scoped to `workerId` throughout, and `workerId` always comes from the
 * session — never from anything the user typed. That is what stops "what is
 * Dana's leave balance" from being answerable here.
 */
async function ownFacts(
  workerId: string,
  worker: { hireDate: Date | null; country: string } | null,
): Promise<string[]> {
  const facts: string[] = [];

  const [assignments, employment, nextHoliday] = await Promise.all([
    db.ptoPolicyAssignment.findMany({
      where: { workerId },
      include: { policy: { select: { id: true, name: true, leaveType: true } } },
    }),
    db.employmentRecord.findFirst({
      where: { workerId, effectiveTo: null },
      select: {
        title: true,
        workState: true,
        manager: { select: { legalFirstName: true, preferredName: true, lastName: true } },
        department: { select: { name: true } },
      },
    }),
    db.holiday.findFirst({
      where: {
        date: { gte: new Date() },
        calendar: { active: true, ...(worker ? { country: worker.country } : {}) },
      },
      orderBy: { date: 'asc' },
      select: { name: true, date: true },
    }),
  ]);

  for (const assignment of assignments) {
    const balance = await ptoBalance(workerId, assignment.policyId);
    facts.push(`Their current ${assignment.policy.name} balance is ${balance.toFixed(1)} hours.`);
  }
  if (employment?.title) {
    facts.push(
      `Their job title is ${employment.title}${employment.department ? ` in ${employment.department.name}` : ''}.`,
    );
  }
  if (employment?.manager) {
    const m = employment.manager;
    facts.push(`Their manager is ${m.preferredName || m.legalFirstName} ${m.lastName}.`);
  }
  if (employment?.workState) facts.push(`They work in ${employment.workState}.`);
  if (worker?.hireDate) facts.push(`Their hire date is ${worker.hireDate.toISOString().slice(0, 10)}.`);
  if (nextHoliday) {
    facts.push(`The next company holiday is ${nextHoliday.name} on ${nextHoliday.date.toISOString().slice(0, 10)}.`);
  }
  return facts;
}
