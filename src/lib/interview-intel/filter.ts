/**
 * What survives between the model and the database.
 *
 * The schema already makes a rating impossible to return. These are the two
 * checks that cannot be expressed in a schema, applied to everything the
 * model produces before any of it is stored:
 *
 *   A quote that cannot be found in the transcript is DROPPED — not stored
 *   with a caveat under it. An unlocatable quote attributed to a candidate is
 *   a fabrication, and a caveat does not stop an interviewer reading the
 *   quote and believing it.
 *
 *   A relevance line containing evaluative wording has that line REPLACED.
 *   It is the sentence an interviewer reads fastest, and "a strong answer"
 *   there is the model rating the candidate by the back door.
 *
 * Pure, so the guarantee is tested rather than asserted.
 */

import { containsEvaluativeLanguage, INTERVIEW_EVIDENCE_PROMPT_VERSION } from "@/lib/ai/interview-evidence";
import { locateQuote, type Segment } from "./transcript";

export interface ModelEvidence {
  competencyName: string;
  quote: string;
  position: string;
  relevance: string;
}

export interface KeptEvidence {
  competencyId: string | null;
  competencyName: string;
  quote: string;
  startMs: number;
  endMs: number;
  relevance: string;
  promptVersion: string;
}

export interface FilterResult {
  kept: KeptEvidence[];
  droppedUnlocatable: number;
  droppedEvaluative: number;
  droppedUnknownCompetency: number;
}

export function filterEvidence(
  evidence: ModelEvidence[],
  segments: Segment[],
  competencyIds: Map<string, string>,
): FilterResult {
  const kept: KeptEvidence[] = [];
  let droppedUnlocatable = 0;
  let droppedEvaluative = 0;
  let droppedUnknownCompetency = 0;

  for (const item of evidence) {
    // A competency the kit does not contain is one the model invented, and
    // evidence against an invented competency is evidence for nothing.
    if (!competencyIds.has(item.competencyName)) {
      droppedUnknownCompetency++;
      continue;
    }

    const at = locateQuote(segments, item.quote);
    if (!at) {
      droppedUnlocatable++;
      continue;
    }

    let relevance = item.relevance;
    if (containsEvaluativeLanguage(relevance).length > 0) {
      droppedEvaluative++;
      relevance = `Bears on ${item.competencyName}. (The original note read as an evaluation and was removed — read the quote and judge it yourself.)`;
    }

    kept.push({
      competencyId: competencyIds.get(item.competencyName) ?? null,
      competencyName: item.competencyName,
      quote: item.quote,
      startMs: at.startMs,
      endMs: at.endMs,
      relevance,
      promptVersion: INTERVIEW_EVIDENCE_PROMPT_VERSION,
    });
  }

  return { kept, droppedUnlocatable, droppedEvaluative, droppedUnknownCompetency };
}
