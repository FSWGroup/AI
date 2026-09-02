/**
 * Pulling evidence out of an interview transcript.
 *
 * The model's entire job is to find passages where the candidate said
 * something bearing on a competency the kit asks about, quote them verbatim,
 * and say in one neutral sentence why the passage is relevant.
 *
 * It does not rate, score, rank, summarize the candidate, or reach any
 * conclusion — and the guarantee is structural rather than a matter of prompt
 * wording. The output schema has no field a rating could live in. A model
 * that decided to be helpful and offer one would have nowhere to put it, and
 * the parse would reject it.
 *
 * Two further rules, enforced after the model returns:
 *
 *   Every quote is located in the transcript before it is stored. A quote
 *   that cannot be found is dropped, because an unlocatable quote attributed
 *   to a candidate is a fabrication no matter how plausible it reads.
 *
 *   Only the candidate's own words become evidence. An interviewer's question
 *   is not something the candidate said.
 */

import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AI_MODEL, SHARED_GUARDRAILS, getAiClient } from "./client";

export const INTERVIEW_EVIDENCE_PROMPT_VERSION = "interview-evidence-1.0";

/**
 * Note the absence of any evaluative field. This is the point.
 */
export const InterviewEvidenceSchema = z.object({
  evidence: z
    .array(
      z.object({
        competencyName: z
          .string()
          .describe("Exactly one of the competency names supplied, copied verbatim."),
        quote: z
          .string()
          .describe(
            "The candidate's own words, copied exactly from the transcript. Never paraphrased, never tidied, never joined across separate answers.",
          ),
        position: z
          .string()
          .describe(
            "The [timestamp] or [#index] marker of the line the quote starts on, copied from the transcript.",
          ),
        relevance: z
          .string()
          .describe(
            "One sentence on why this passage bears on the competency. Neutral and descriptive: what it is about, not how good it was.",
          ),
      }),
    )
    .describe("Passages where the candidate spoke to one of the competencies."),
  competenciesWithNoEvidence: z
    .array(z.string())
    .describe(
      "Competency names the interview produced nothing usable for. Being honest about this matters more than filling the list — it tells the interviewer what to ask next time.",
    ),
  notes: z
    .array(z.string())
    .describe(
      "Problems with the material itself: unlabelled speakers, an inaudible passage, a topic the interviewer never raised. Not observations about the candidate.",
    ),
});

export type InterviewEvidenceOutput = z.infer<typeof InterviewEvidenceSchema>;

const TASK = `
Find where the candidate spoke to each competency, and quote them.

How to work:
1. Read the competency list first. It is the only thing you are looking for.
2. Go through the transcript and pick out passages where the CANDIDATE says something that bears on one of those competencies. An interviewer's question is not evidence; only what the candidate said is.
3. Quote verbatim. Copy the words exactly as they appear, including hesitations if they are in the transcript. Do not tidy the grammar, do not shorten, do not stitch two separate answers into one quote.
4. Prefer a passage where the candidate describes something they actually did over one where they describe what they believe or would do. Both can be evidence; the first is stronger and the interviewer will want to see it first.
5. Say plainly which competencies the interview produced nothing for. An empty hand is a useful finding: it tells the interviewer what to cover next time. Do not stretch a loosely related passage to fill a gap.

What you must not do:
- Do not rate, score, rank, or grade anything. There is no field for it and no version of it is wanted.
- Do not say whether an answer was good, strong, weak, convincing, impressive, or concerning. Describe what the passage is ABOUT and stop.
- Do not summarize the candidate as a person, and do not draw a conclusion about them.
- Do not comment on how they spoke: fluency, accent, hesitancy, tone, confidence, nerves, or manner. You are reading a transcript, and none of that is in it.
- Do not invent, reconstruct or approximate a quote. If you cannot find the words, that competency has no evidence.

The interviewer forms the judgement. You are handing them what was actually said so they do not have to rely on memory.
`.trim();

export interface EvidenceInput {
  competencies: { name: string; definition: string | null }[];
  transcript: string;
  roleTitle: string;
  hasTimestamps: boolean;
}

export async function extractInterviewEvidence(input: EvidenceInput): Promise<{
  output: InterviewEvidenceOutput;
  inputTokens: number;
  outputTokens: number;
}> {
  const client = getAiClient();

  const competencyBlock = input.competencies
    .map((c) => `- ${c.name}${c.definition ? `: ${c.definition}` : ""}`)
    .join("\n");

  const positionNote = input.hasTimestamps
    ? "Positions are timestamps in [h:mm:ss] form. Copy the one on the line the quote starts on."
    : "This transcript has no timestamps, so lines are marked [#0], [#1] and so on. Copy the marker of the line the quote starts on.";

  const content = [
    `<role>\n${input.roleTitle}\n</role>`,
    `<competencies>\n${competencyBlock}\n</competencies>`,
    `<transcript>\n${input.transcript}\n</transcript>`,
    positionNote,
    TASK,
  ].join("\n\n");

  const response = await client.messages.parse({
    model: AI_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SHARED_GUARDRAILS,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(InterviewEvidenceSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      "The transcript could not be analyzed. Check the material and try again.",
    );
  }
  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("The analysis returned an unreadable result. Please try again.");
  }

  return {
    output: parsed,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

/**
 * Wording that reads as an evaluation.
 *
 * The schema stops a rating from being stored, and the prompt asks for none.
 * This is the third layer: a `relevance` sentence that slipped into judgement
 * is rewritten to name the topic instead. Three cheap layers beat one clever
 * one, because the failure this guards against is not the model misbehaving —
 * it is an interviewer reading "a strong answer" and rating the sentence
 * rather than the evidence.
 */
const EVALUATIVE = [
  "strong",
  "weak",
  "excellent",
  "poor",
  "impressive",
  "concerning",
  "convincing",
  "unconvincing",
  "compelling",
  "solid",
  "shallow",
  "thorough",
  "vague",
  "confident",
  "hesitant",
  "articulate",
  "well-prepared",
  "good answer",
  "great answer",
  "red flag",
  "green flag",
];

export function containsEvaluativeLanguage(text: string): string[] {
  const lower = text.toLowerCase();
  return EVALUATIVE.filter((word) =>
    new RegExp(`\\b${word.replace(/[-\s]/g, "[-\\s]")}\\b`).test(lower),
  );
}
