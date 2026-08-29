/**
 * Candidate-facing feedback report.
 *
 * Built from the same stored scores and versioned narratives as the employer
 * report, but written for the person who took the assessment.
 *
 * What it deliberately does NOT contain:
 *  - any benchmark comparison, in-range/below/above indicator, or pass/fail
 *  - response-validity indicators (distortion / equivocation)
 *  - integrity events, recording data, or anything from the employer appendix
 *  - the numeric 1-9 band, which invites over-reading a single number
 *
 * Why: research on applicant reactions finds explanations of the process
 * improve fairness perceptions, while raw performance feedback to rejected
 * candidates can harm well-being. So this is developmental and
 * strengths-first — useful whatever the hiring outcome turns out to be.
 */

import { candidateDimensionCopy } from "@/content/narratives/candidate-dimension-copy";
import type { Construct } from "@/content/types";
import type { ReportPayload } from "./generate";

export interface FeedbackSection {
  name: string;
  /** What this dimension is about, in the candidate's own terms. */
  about: string;
  /** Plain-language descriptive statement — never a score or judgment. */
  statement: string;
}

export interface CandidateFeedback {
  candidateFirstName: string;
  position: string;
  company: string;
  completedAt: string | null;
  strengths: FeedbackSection[];
  workStyle: FeedbackSection[];
  development: { name: string; suggestions: string[] }[];
  aboutTheAssessment: string[];
  closing: string;
}

/** Descriptive language for a band, written for the person themselves. */
function strengthPhrase(band: number): string {
  if (band >= 8) return "a particular strength of yours";
  if (band >= 7) return "an area you scored well in";
  return "an area of solid performance for you";
}

/**
 * The mid-range wording repeats across up to ten behavioral dimensions, so it
 * rotates through equivalent phrasings by position. The rotation is by index,
 * not random, so re-rendering the same report produces the same text.
 */
const MIDDLE_PHRASINGS = [
  "which suggests you adapt your approach to the situation.",
  "which suggests you draw on both depending on what the work asks for.",
  "which suggests neither pole is a fixed habit for you.",
];

function stylePhrase(
  band: number,
  low: string,
  high: string,
  index: number,
): string {
  if (band >= 7) {
    return `Your responses lean toward ${high}. In practice that often shows up as a natural preference for that way of working.`;
  }
  if (band <= 3) {
    return `Your responses lean toward ${low}. That is a genuine working style, not a shortfall — different roles call for different approaches.`;
  }
  return `Your responses sit between ${low} and ${high}, ${
    MIDDLE_PHRASINGS[index % MIDDLE_PHRASINGS.length]
  }`;
}

const APTITUDES = [
  "MENTAL_ACUITY",
  "BUSINESS_TERMS",
  "AWARENESS_MEMORY",
  "VOCABULARY",
  "NUMERICAL_PERCEPTION",
];

/**
 * Build the candidate's report.
 *
 * @param developmentTemplates Seeded development suggestions, keyed by
 *   construct — reused so candidates and employers see consistent advice.
 */
export function buildCandidateFeedback(
  payload: ReportPayload,
  candidateFirstName: string,
  developmentTemplates: Map<string, string[]>,
): CandidateFeedback {
  /** Candidate-facing wording, never the employer-facing definition. */
  const copy = (construct: string) =>
    candidateDimensionCopy[construct as Construct];
  const about = (construct: string) => copy(construct)?.about ?? "";

  // Strengths: the highest-scoring aptitudes, described without numbers.
  const strengths: FeedbackSection[] = payload.dimensions
    .filter((d) => APTITUDES.includes(d.construct) && d.band >= 6)
    .sort((a, b) => b.band - a.band)
    .slice(0, 4)
    .map((d) => ({
      name: d.name,
      about: about(d.construct),
      statement: `Your answers pointed toward ${
        copy(d.construct)?.high ?? "this"
      }. Compared with the other areas measured, it came through as ${strengthPhrase(d.band)}.`,
    }));

  // If nothing cleared the threshold, lead with their relative best rather
  // than showing an empty strengths section.
  if (strengths.length === 0) {
    const best = payload.dimensions
      .filter((d) => APTITUDES.includes(d.construct))
      .sort((a, b) => b.band - a.band)
      .slice(0, 2);
    for (const d of best) {
      strengths.push({
        name: d.name,
        about: about(d.construct),
        statement:
          "Relative to the other areas measured, this was among your stronger results.",
      });
    }
  }

  // Work style: behavioral dimensions, described as preferences.
  const workStyle: FeedbackSection[] = payload.dimensions
    .filter((d) => d.category === "BEHAVIORAL")
    .slice(0, 10)
    .map((d, i) => {
      const c = copy(d.construct);
      return {
        name: d.name,
        about: c?.about ?? "",
        statement: stylePhrase(
          d.band,
          c?.low ?? "one approach",
          c?.high ?? "another approach",
          i,
        ),
      };
    });

  // Development: the lowest-scoring developable areas, capped at three so
  // the report reads as encouragement rather than a list of faults.
  const development = payload.dimensions
    .filter((d) => d.band <= 4 && developmentTemplates.has(d.construct))
    .sort((a, b) => a.band - b.band)
    .slice(0, 3)
    .map((d) => ({
      name: d.name,
      suggestions: (developmentTemplates.get(d.construct) ?? []).slice(0, 4),
    }));

  return {
    candidateFirstName,
    position: payload.meta.position,
    company: payload.meta.company,
    completedAt: payload.meta.completedAt,
    strengths,
    workStyle,
    development,
    aboutTheAssessment: [
      "This assessment measured reasoning, business knowledge, vocabulary, attention to detail, and how you prefer to work.",
      "There are no pass or fail results. Different roles suit different patterns of strengths and working styles.",
      "Your results are one input among several in the hiring process, alongside your experience, your interview, and your references.",
      "The scores are provisional internal measures, not a definitive statement about your abilities.",
    ],
    closing:
      "Whatever the outcome of this particular process, we hope the summary above is useful to you. Thank you for the time you put into it.",
  };
}
