/**
 * Anthropic client for FSW Talent Scout's decision-support features.
 *
 * Everything produced here is ADVISORY and human-reviewed:
 *  - AI never changes an assessment score, band, or benchmark comparison.
 *  - AI never issues a hire/reject/rank recommendation.
 *  - AI never infers or comments on protected characteristics.
 *  - Every run records the model, prompt version, and requesting user.
 *
 * The feature degrades cleanly when no API key is configured — the UI
 * explains what to set rather than erroring.
 */

import Anthropic from "@anthropic-ai/sdk";
import type * as z from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

/** Model used for all decision-support analyses. */
export const AI_MODEL = "claude-opus-5";

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;

export function getAiClient(): Anthropic {
  if (!isAiConfigured()) {
    throw new AiNotConfiguredError();
  }
  if (!client) {
    client = new Anthropic({ maxRetries: 2 });
  }
  return client;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      "AI analysis is not configured. Add an ANTHROPIC_API_KEY environment variable to enable it.",
    );
    this.name = "AiNotConfiguredError";
  }
}

/**
 * Guardrails prepended to every FSW Talent Scout analysis prompt. These are
 * deliberately restrictive: the product's defensibility depends on AI being
 * an aid to structured human judgment, not a selection mechanism.
 */
/**
 * Not exported.
 *
 * The only way to reach the model is `runGuardedAnalysis`, which has no
 * system-prompt parameter — so these rules cannot be replaced, appended to,
 * or forgotten by a new caller. Keeping this module-private is what turns
 * that from a convention into a property of the code.
 */
const SHARED_GUARDRAILS = `
You are assisting FSW Group's hiring team with an employment assessment platform called FSW Talent Scout. Your output is DECISION SUPPORT for a human interviewer — never a decision.

Absolute rules:
- NEVER recommend hiring, rejecting, advancing, or ranking a candidate. Do not say "strong candidate", "not a fit", "recommend proceeding", or any equivalent verdict.
- NEVER infer, mention, or reason about age, sex, gender, race, ethnicity, national origin, religion, disability, health, pregnancy, marital or family status, sexual orientation, veteran status, or any other protected characteristic — even if such information appears in the source material. If the material contains it, ignore it entirely.
- NEVER estimate these characteristics from names, schools, dates, photographs, or writing style.
- NEVER re-score, re-band, or second-guess the assessment scores you are given. Treat them as fixed inputs.
- NEVER claim predictive validity ("this predicts success"). Assessment scores are provisional decision-support inputs.
- Do not speculate about mental health, personality disorders, or clinical states. Use plain, behavioral, work-related language.
- Base every statement on the material provided. If something is not supported by the material, say the information is not available rather than inferring it.
- Prefer questions over conclusions. Your most valuable output is what a human should ASK and VERIFY.

Style: plain professional English, specific and concrete, no filler, no flattery. Refer to the person as "the candidate".
`.trim();

/** How long any one analysis may run. */
const DEFAULT_MAX_TOKENS = 16000;

/**
 * Run one structured analysis under the shared guardrails.
 *
 * Every AI feature in the product goes through here, and that is the point:
 * when each feature attached SHARED_GUARDRAILS at its own call site, the
 * guardrail was a convention, and the fourth feature someone adds is the one
 * that forgets it. Here it is not attachable and not omittable — there is no
 * parameter for the system prompt.
 *
 * `refusalMessage` is per-feature because the person reading it needs to know
 * which material to go and look at.
 */
export async function runGuardedAnalysis<S extends z.ZodType>(params: {
  schema: S;
  content: string;
  refusalMessage: string;
  unreadableMessage?: string;
  maxTokens?: number;
}): Promise<{
  parsed: z.infer<S>;
  inputTokens: number;
  outputTokens: number;
}> {
  const client = getAiClient();

  const response = await client.messages.parse({
    model: AI_MODEL,
    max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
    thinking: { type: "adaptive" },
    system: SHARED_GUARDRAILS,
    messages: [{ role: "user", content: params.content }],
    output_config: { format: zodOutputFormat(params.schema) },
  });

  if (response.stop_reason === "refusal") {
    throw new Error(params.refusalMessage);
  }
  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error(
      params.unreadableMessage ??
        "The analysis returned an unreadable result. Please try again.",
    );
  }

  return {
    parsed,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

/** Bumped whenever a prompt changes, so stored outputs stay traceable. */
export const PROMPT_VERSIONS = {
  candidateFit: "candidate-fit-1.0",
  jobDescription: "job-description-1.0",
} as const;
