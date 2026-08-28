/**
 * Job description → proposed benchmark and assessment emphasis.
 *
 * An admin pastes a job description; the model proposes, for every measured
 * dimension, whether it is job-relevant, the desired 1-9 range, its weight,
 * and a rationale tied to specific duties in the description. It also
 * proposes how the assessment itself should be emphasized for the role
 * (section question counts and timing).
 *
 * NOTHING is applied automatically. The proposal lands in the benchmark
 * editor for a human to review, adjust, and save — which is both better
 * practice and what makes the resulting benchmark defensible: a person
 * decided it, informed by the job analysis.
 */

import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  AI_MODEL,
  PROMPT_VERSIONS,
  SHARED_GUARDRAILS,
  getAiClient,
} from "./client";
import { dimensionMeta } from "@/content/narratives/dimension-meta";

const SCOREABLE = dimensionMeta.filter((d) => d.category !== "VALIDITY");
const CONSTRUCT_VALUES = SCOREABLE.map((d) => d.construct as string) as [
  string,
  ...string[],
];

const SECTION_KEYS = [
  "BEHAVIORAL",
  "MECHANICAL_INTEREST",
  "MENTAL_ACUITY",
  "BUSINESS_TERMS",
  "AWARENESS_MEMORY",
  "VOCABULARY",
  "NUMERICAL_PERCEPTION",
] as const;

export const JobDescriptionProposalSchema = z.object({
  roleSummary: z
    .string()
    .describe("2-3 sentences summarizing what this role actually does day to day."),
  keyResponsibilities: z
    .array(z.string())
    .min(3)
    .max(8)
    .describe("The duties drawn directly from the description."),
  isSalesRole: z
    .boolean()
    .describe("True when selling, quoting, or customer acquisition is a core duty."),
  leadershipModuleEnabled: z
    .boolean()
    .describe("True when the role supervises people or owns a function."),
  dimensions: z
    .array(
      z.object({
        construct: z.enum(CONSTRUCT_VALUES),
        enabled: z
          .boolean()
          .describe(
            "False when the description gives no job-related reason to measure this dimension. Be willing to disable — measuring irrelevant dimensions is a compliance risk.",
          ),
        required: z
          .boolean()
          .describe("True only for dimensions central to performing the job."),
        minScore: z.number().int().min(1).max(9),
        maxScore: z.number().int().min(1).max(9),
        weight: z
          .number()
          .min(0.5)
          .max(3)
          .describe("1 is normal; 1.5+ marks a role-critical dimension."),
        rationale: z
          .string()
          .describe(
            "Why this range, tied to a specific duty in the description. This is the job-relevance record — be concrete.",
          ),
      }),
    )
    .length(16),
  sectionEmphasis: z
    .array(
      z.object({
        sectionKey: z.enum(SECTION_KEYS),
        include: z.boolean(),
        questionCount: z
          .number()
          .int()
          .min(0)
          .max(100)
          .describe("How many items to serve for this role."),
        rationale: z.string(),
      }),
    )
    .length(7)
    .describe(
      "How the assessment should be weighted for this role. Keep the behavioral inventory substantial; adjust aptitude sections to job demands.",
    ),
  interviewThemes: z
    .array(z.string())
    .min(3)
    .max(8)
    .describe("Themes any interview for this role should cover."),
  cautions: z
    .array(z.string())
    .max(5)
    .describe(
      "Anything about this role that makes benchmarking uncertain, or duties the assessment does not measure at all and must be evaluated another way.",
    ),
});

export type JobDescriptionProposal = z.infer<typeof JobDescriptionProposalSchema>;

function dimensionCatalog(): string {
  return SCOREABLE.map(
    (d) =>
      `- ${d.construct} — ${d.name} (${d.category === "APTITUDE" ? "aptitude" : "behavioral"}): ${d.shortDefinition} Low end: "${d.lowDescriptor}". High end: "${d.highDescriptor}".`,
  ).join("\n");
}

const SECTION_CATALOG = `
- BEHAVIORAL: the work-style inventory covering all ten behavioral dimensions. Untimed. Default 96 statements. Do not drop below 60 — every behavioral dimension needs enough items to score reliably.
- MECHANICAL_INTEREST: interest (not ability) in equipment, machinery, technical products. Default 18. Set to 0 for roles with no technical product context.
- MENTAL_ACUITY: reasoning and problem solving. Timed. Default 24.
- BUSINESS_TERMS: practical business literacy. Timed. Default 19.
- AWARENESS_MEMORY: retention of briefed information plus business awareness. Timed. Default 17.
- VOCABULARY: verbal comprehension and communication. Timed. Default 19.
- NUMERICAL_PERCEPTION: speed and accuracy checking numbers, part numbers, codes. Timed. Default 40. Central to order-entry, quoting, and distribution roles.
`.trim();

export async function analyzeJobDescription(params: {
  jobTitle: string;
  jobDescription: string;
}): Promise<{
  proposal: JobDescriptionProposal;
  inputTokens: number;
  outputTokens: number;
}> {
  const client = getAiClient();

  const prompt = `
<job_title>${params.jobTitle}</job_title>

<job_description>
${params.jobDescription.slice(0, 20_000)}
</job_description>

<available_dimensions>
${dimensionCatalog()}
</available_dimensions>

<assessment_sections>
${SECTION_CATALOG}
</assessment_sections>

Perform a lightweight job analysis and propose an assessment configuration.

How to work:
1. Identify what the role actually requires from the description — the duties, not the boilerplate.
2. For EVERY one of the 16 dimensions, decide whether measuring it is job-related. Disable the ones that aren't; a benchmark that measures everything measures nothing and is harder to defend.
3. For enabled dimensions, set a desired 1-9 range. Guidance:
   - A range of 3-4 bands is usual; narrower only when the job truly demands it.
   - 5 is the middle of the scale. Ranges centered at 5-7 mean "solidly above typical".
   - Set the range to what the JOB needs, not the best imaginable person. Requiring 8-9 everywhere screens out capable people for no job-related reason.
   - Remember the scale is bidirectional for some dimensions: very high Mental Acuity in a highly routine role can mean disengagement; high Competitiveness suits individual quota work while low suits collaborative service work. Neither pole is inherently better.
4. Propose section emphasis matching the role's real demands.
5. Note any duty the assessment does NOT measure (e.g. specific software, certifications, physical requirements) in cautions — those must be evaluated separately.

Rationales are the record of WHY this configuration is job-related. Tie each one to a specific duty.
`.trim();

  const response = await client.messages.parse({
    model: AI_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SHARED_GUARDRAILS,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: zodOutputFormat(JobDescriptionProposalSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      "A proposal could not be generated for this job description. Review the text and try again.",
    );
  }
  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("The proposal returned an unreadable result. Please try again.");
  }

  // Defensive: never let an inverted range reach the editor.
  for (const d of parsed.dimensions) {
    if (d.minScore > d.maxScore) {
      const min = d.maxScore;
      d.maxScore = d.minScore;
      d.minScore = min;
    }
  }

  return {
    proposal: parsed,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

export const JOB_DESCRIPTION_PROMPT_VERSION = PROMPT_VERSIONS.jobDescription;
