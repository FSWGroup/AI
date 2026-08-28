/**
 * Candidate fit analysis: assessment results + job profile + (optional)
 * résumé → an interviewer's preparation brief.
 *
 * Output is strictly advisory. It contains no hire/reject recommendation,
 * no ranking, no score changes, and no protected-characteristic inference
 * (see SHARED_GUARDRAILS). Its purpose is to tell a hiring manager what to
 * ASK and VERIFY in the next conversation.
 */

import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  AI_MODEL,
  PROMPT_VERSIONS,
  SHARED_GUARDRAILS,
  getAiClient,
} from "./client";
import type { ReportPayload } from "@/lib/report/generate";

export const CandidateFitSchema = z.object({
  roleContext: z
    .string()
    .describe(
      "2-3 sentences on what this role appears to demand and how the assessment dimensions relate to it. No verdict about the candidate.",
    ),
  assessmentHighlights: z
    .array(
      z.object({
        dimension: z.string(),
        observation: z
          .string()
          .describe("What the score suggests for THIS role, factually stated."),
        relevance: z.enum(["strength_for_role", "watch_area", "context_only"]),
      }),
    )
    .min(3)
    .max(8),
  resumeCorroboration: z
    .array(
      z.object({
        topic: z.string().describe("The theme being checked, e.g. 'Organization'."),
        assessmentSignal: z.string(),
        resumeSignal: z
          .string()
          .describe(
            "What the résumé shows about this, quoting or citing specifics. If the résumé is silent, say so explicitly.",
          ),
        relationship: z.enum(["corroborates", "tension", "resume_silent"]),
        whatToVerify: z
          .string()
          .describe("The concrete thing an interviewer should establish."),
      }),
    )
    .max(8)
    .describe("Empty array when no résumé was provided."),
  experienceGaps: z
    .array(z.string())
    .max(6)
    .describe(
      "Job requirements the résumé does not evidence, phrased neutrally as things to explore. Empty when no résumé was provided.",
    ),
  interviewQuestions: z
    .array(
      z.object({
        theme: z.string(),
        question: z
          .string()
          .describe(
            "A behavioral question asking for a specific past example, tailored to this candidate and role.",
          ),
        whyThisQuestion: z
          .string()
          .describe("The assessment or résumé signal that motivates asking it."),
        listenFor: z
          .string()
          .describe(
            "What a substantive answer contains — specific behavior, ownership, results, learning. Not a scripted correct answer.",
          ),
        followUp: z.string().describe("One probing follow-up if the answer is thin."),
      }),
    )
    .min(5)
    .max(10),
  referenceCheckPrompts: z
    .array(z.string())
    .max(5)
    .describe("Questions worth putting to a former manager or reference."),
  onboardingConsiderations: z
    .array(z.string())
    .max(5)
    .describe(
      "If this person were hired, what support or structure would help them succeed in this role. Conditional framing only.",
    ),
  cautions: z
    .array(z.string())
    .max(5)
    .describe(
      "Interpretation cautions: response-quality flags, thin evidence, anything the interviewer should not over-read.",
    ),
});

export type CandidateFitAnalysis = z.infer<typeof CandidateFitSchema>;

/** Compact, PII-light view of the assessment for the model. */
function summarizeReport(payload: ReportPayload): string {
  const lines: string[] = [];
  lines.push(`Position: ${payload.meta.position}`);
  lines.push(`Assessment version: ${payload.meta.assessmentVersionName}`);
  lines.push(`Score type: ${payload.meta.bandTypeNote}`);
  lines.push("");
  lines.push("DIMENSION SCORES (1-9 scale; desired range is the role benchmark):");
  for (const d of payload.dimensions) {
    const bm = d.benchmark
      ? `desired ${d.benchmark.min}-${d.benchmark.max}, ${d.position ?? "n/a"}`
      : "no benchmark set for this role";
    lines.push(
      `- ${d.name} (${d.category === "APTITUDE" ? "aptitude" : "behavioral"}): score ${d.band} (${d.bandLabel}); ${bm}`,
    );
    lines.push(`    what it measures: ${d.shortDefinition}`);
    if (d.narrative) lines.push(`    interpretation: ${d.narrative}`);
  }
  lines.push("");
  lines.push("RESPONSE-QUALITY INDICATORS (not job-fit dimensions):");
  for (const v of payload.validity) {
    lines.push(`- ${v.name}: level ${v.level}. ${v.narrative}`);
  }
  if (payload.concerns.length > 0) {
    lines.push("");
    lines.push("FLAGGED FOR ADDITIONAL INTERVIEW ATTENTION (never a disqualifier):");
    for (const c of payload.concerns) lines.push(`- ${c.name} scored ${c.band}`);
  }
  if (payload.salesTraits) {
    lines.push("");
    lines.push("SALES TRAIT COMPOSITES (derived from the dimensions above):");
    for (const c of payload.salesTraits.composites) {
      lines.push(`- ${c.name}: ${c.band} (${c.classificationLabel})`);
    }
  }
  if (payload.interviewGuide.length > 0) {
    lines.push("");
    lines.push(
      "The platform already generated standard interview questions for these dimensions — produce DIFFERENT, more specific questions that use the résumé and role context:",
    );
    for (const g of payload.interviewGuide) lines.push(`- ${g.name} (${g.focus})`);
  }
  return lines.join("\n");
}

export interface CandidateFitInput {
  report: ReportPayload;
  jobTitle: string;
  jobProfileName: string;
  jobDescription: string | null;
  resumeText: string | null;
}

export async function analyzeCandidateFit(input: CandidateFitInput): Promise<{
  analysis: CandidateFitAnalysis;
  inputTokens: number;
  outputTokens: number;
}> {
  const client = getAiClient();

  const sections: string[] = [
    `<role>\nJob title: ${input.jobTitle}\nProfile: ${input.jobProfileName}\n${
      input.jobDescription
        ? `\nJob description:\n${input.jobDescription.slice(0, 12_000)}`
        : "\n(No job description on file — rely on the job title and the benchmark ranges.)"
    }\n</role>`,
    `<assessment_results>\n${summarizeReport(input.report)}\n</assessment_results>`,
  ];
  sections.push(
    input.resumeText
      ? `<resume>\n${input.resumeText.slice(0, 40_000)}\n</resume>`
      : `<resume>\n(No résumé was provided. Return an empty array for resumeCorroboration and experienceGaps, and base the interview questions on the assessment and role alone.)\n</resume>`,
  );

  const task = `
Produce an interview preparation brief for the hiring manager.

How to work:
1. Read the role first and decide which assessment dimensions genuinely matter for it.
2. Where a résumé is present, look for places where it CORROBORATES or sits in TENSION with the assessment pattern, and cite the specific résumé detail. A tension is not a problem to be resolved by you — it is a question for the interview.
3. Write interview questions that only make sense for THIS candidate and THIS role: reference their actual background and the specific score pattern. Generic questions are a failure.
4. Keep every claim traceable to the material. Where the material is silent, say so.

Remember: no verdicts, no ranking, no scoring, no protected characteristics.
`.trim();

  const response = await client.messages.parse({
    model: AI_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SHARED_GUARDRAILS,
    messages: [{ role: "user", content: `${sections.join("\n\n")}\n\n${task}` }],
    output_config: { format: zodOutputFormat(CandidateFitSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      "The analysis could not be generated for this input. Review the source material and try again.",
    );
  }
  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("The analysis returned an unreadable result. Please try again.");
  }

  return {
    analysis: parsed,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

export const CANDIDATE_FIT_PROMPT_VERSION = PROMPT_VERSIONS.candidateFit;
