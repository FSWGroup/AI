import 'server-only';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { aiClient, aiModel, AiUnavailableError } from '@/lib/ai/client';
import type { CopilotContext } from '@/lib/ai/copilot-context';

/**
 * The HR copilot's answering step.
 *
 * Retrieval (copilot-context.ts) has already decided what this user may see.
 * This module only turns that into an answer, under two rules:
 *
 *   1. **Answer only from what was provided.** No general knowledge about
 *      employment law, no "typically companies…". If the supplied policies do
 *      not cover it, say so and offer to raise an HR case. A confidently
 *      wrong answer about leave or pay is worse than no answer.
 *   2. **Cite.** Every substantive claim names the policy it came from, with
 *      its version, so the reader can check it. The UI links the citation.
 *
 * The model is never given the ability to act. It returns text and citations.
 */

const AnswerSchema = z.object({
  answer: z
    .string()
    .describe('The answer in plain English, two to five sentences. Address the person directly.'),
  citedPolicyIds: z
    .array(z.string())
    .describe('The policyId values of policies actually used. Empty if the answer came from the personal facts alone.'),
  answered: z
    .boolean()
    .describe('True if the provided material genuinely answers the question. False if it does not.'),
  suggestHrCase: z
    .boolean()
    .describe('True if the person should raise this with HR — because it is not covered, or needs a human decision.'),
});

export type CopilotAnswer = z.infer<typeof AnswerSchema>;

const SYSTEM_PROMPT = `You answer employees' HR questions at FSW Group, an industrial distributor with staff in the United States and the Philippines.

You are given: the asker's own situation (their leave balance, manager, job title), and the text of company policies that this specific person is entitled to read. Nothing else.

Rules:
- Answer ONLY from the material provided. You have no other source. If the material does not answer the question, set answered to false, say plainly that it is not covered by the policies you can see, and set suggestHrCase to true.
- Never state employment law, statutory entitlements, tax treatment or anything about another country's rules from your own knowledge, even if you are confident. If a policy says it, quote the policy. If no policy says it, you do not know it.
- Cite the policies you used by their policyId. Do not cite a policy you did not actually rely on.
- Never answer a question about another named person. The material describes only the asker; if they ask about a colleague, say that you can only answer about their own record and point them to the directory.
- For anything involving a decision — an exception, a dispute, a termination, an accommodation, a complaint, anything about pay owed — set suggestHrCase to true. You inform; a person decides.
- Be brief and direct. Two to five sentences. No preamble, no "great question", no hedging padding.
- Say "your handbook" and "your manager", not "the employee's".`;

export interface CopilotResult {
  answer: CopilotAnswer;
  model: string;
  citations: { policyId: string; title: string; version: number; effectiveAt: Date }[];
}

export async function askCopilot(context: CopilotContext, question: string): Promise<CopilotResult> {
  if (context.policies.length === 0 && context.personalFacts.length === 0) {
    throw new AiUnavailableError(
      'There are no published policies you can see, and nothing on your record to answer from yet.',
    );
  }

  const parts = [
    `The person asking is ${context.askerFirstName}.`,
    '',
    context.personalFacts.length > 0
      ? `Their own situation:\n${context.personalFacts.map((f) => `- ${f}`).join('\n')}`
      : 'No personal details are available for this person.',
    '',
    context.policies.length > 0
      ? `Policies this person is entitled to read:\n\n${context.policies
          .map(
            (p) =>
              `--- policyId: ${p.policyId} | ${p.title} (version ${p.version}, effective ${p.effectiveAt
                .toISOString()
                .slice(0, 10)}) ---\n${p.text}`,
          )
          .join('\n\n')}`
      : 'No policies matched this question.',
    '',
    `Their question: ${question}`,
  ];

  const response = await aiClient().messages.parse({
    model: aiModel(),
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    thinking: { type: 'adaptive' },
    output_config: { format: zodOutputFormat(AnswerSchema) },
    messages: [{ role: 'user', content: parts.join('\n') }],
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new AiUnavailableError('The assistant did not return a usable answer. Nothing was saved.');
  }

  // Only cite policies that were actually supplied. A hallucinated citation
  // would be worse than none, because it looks checkable.
  const byId = new Map(context.policies.map((p) => [p.policyId, p]));
  const citations = parsed.citedPolicyIds
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({ policyId: p.policyId, title: p.title, version: p.version, effectiveAt: p.effectiveAt }));

  return { answer: parsed, model: response.model, citations };
}
