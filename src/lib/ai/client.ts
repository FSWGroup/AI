/**
 * Anthropic client for FSW WorkFit's decision-support features.
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
 * Guardrails prepended to every FSW WorkFit analysis prompt. These are
 * deliberately restrictive: the product's defensibility depends on AI being
 * an aid to structured human judgment, not a selection mechanism.
 */
export const SHARED_GUARDRAILS = `
You are assisting FSW Group's hiring team with an employment assessment platform called FSW WorkFit. Your output is DECISION SUPPORT for a human interviewer — never a decision.

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

/** Bumped whenever a prompt changes, so stored outputs stay traceable. */
export const PROMPT_VERSIONS = {
  candidateFit: "candidate-fit-1.0",
  jobDescription: "job-description-1.0",
} as const;
