/**
 * Scorecard aggregation.
 *
 * The scale has four points and no midpoint. That is deliberate: a neutral
 * option lets an interviewer avoid committing, and a panel of "maybes" is
 * indistinguishable from no interview at all.
 *
 * Aggregation here summarizes; it never decides. There is no threshold above
 * which someone is hired and none below which they are rejected, and the
 * numbers are presented alongside the individual recommendations rather than
 * replacing them — an average of 2.5 hides a panel that was split, which is
 * exactly the situation a hiring manager most needs to see.
 */

import type { ScorecardRecommendation } from "@prisma/client";

export const RECOMMENDATION_SCORE: Record<ScorecardRecommendation, number> = {
  STRONG_NO: 1,
  NO: 2,
  YES: 3,
  STRONG_YES: 4,
};

export const RECOMMENDATION_LABEL: Record<ScorecardRecommendation, string> = {
  STRONG_NO: "Strong no",
  NO: "No",
  YES: "Yes",
  STRONG_YES: "Strong yes",
};

export const RATING_LABEL: Record<number, string> = {
  1: "Well below the bar",
  2: "Below the bar",
  3: "Meets the bar",
  4: "Above the bar",
};

export interface ScorecardLike {
  id: string;
  authorName: string;
  status: string;
  recommendation: ScorecardRecommendation | null;
  summary: string | null;
  submittedAt: Date | string | null;
  ratings: { competencyName: string; rating: number | null; note: string | null }[];
}

export interface CompetencyRollup {
  competencyName: string;
  ratings: number[];
  average: number | null;
  /** True when interviewers disagreed by two or more points. */
  split: boolean;
}

export interface ScorecardSummary {
  submittedCount: number;
  pendingCount: number;
  recommendations: Record<ScorecardRecommendation, number>;
  averageRecommendation: number | null;
  /** True when at least one yes and one no were submitted. */
  panelSplit: boolean;
  competencies: CompetencyRollup[];
}

export function summarizeScorecards(
  scorecards: ScorecardLike[],
): ScorecardSummary {
  const submitted = scorecards.filter(
    (s) => s.status === "SUBMITTED" && s.recommendation != null,
  );
  const recommendations: Record<ScorecardRecommendation, number> = {
    STRONG_NO: 0,
    NO: 0,
    YES: 0,
    STRONG_YES: 0,
  };
  for (const s of submitted) {
    if (s.recommendation) recommendations[s.recommendation] += 1;
  }

  const scores = submitted
    .map((s) => (s.recommendation ? RECOMMENDATION_SCORE[s.recommendation] : null))
    .filter((n): n is number => n != null);
  const averageRecommendation =
    scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  const positives = recommendations.YES + recommendations.STRONG_YES;
  const negatives = recommendations.NO + recommendations.STRONG_NO;

  const byCompetency = new Map<string, number[]>();
  for (const s of submitted) {
    for (const r of s.ratings) {
      if (r.rating == null) continue;
      const list = byCompetency.get(r.competencyName) ?? [];
      list.push(r.rating);
      byCompetency.set(r.competencyName, list);
    }
  }

  const competencies: CompetencyRollup[] = [...byCompetency.entries()].map(
    ([competencyName, ratings]) => ({
      competencyName,
      ratings,
      average: ratings.reduce((a, b) => a + b, 0) / ratings.length,
      split: Math.max(...ratings) - Math.min(...ratings) >= 2,
    }),
  );
  competencies.sort((a, b) => a.competencyName.localeCompare(b.competencyName));

  return {
    submittedCount: submitted.length,
    pendingCount: scorecards.length - submitted.length,
    recommendations,
    averageRecommendation,
    panelSplit: positives > 0 && negatives > 0,
    competencies,
  };
}

export interface SubmitValidation {
  ok: boolean;
  errors: string[];
}

/**
 * A scorecard cannot be submitted without a recommendation and written
 * evidence for it. "Strong yes" with no reasoning is the thing structured
 * interviewing exists to prevent.
 */
export function validateSubmission(params: {
  recommendation: ScorecardRecommendation | null;
  summary: string | null;
  ratings: { competencyName: string; rating: number | null }[];
  requiredCompetencies: string[];
}): SubmitValidation {
  const errors: string[] = [];
  if (!params.recommendation) errors.push("Choose an overall recommendation.");
  if ((params.summary ?? "").trim().length < 20) {
    errors.push(
      "Add a short written rationale — at least a sentence on what you saw.",
    );
  }
  const rated = new Set(
    params.ratings.filter((r) => r.rating != null).map((r) => r.competencyName),
  );
  const missing = params.requiredCompetencies.filter((c) => !rated.has(c));
  if (missing.length > 0) {
    errors.push(
      `Rate every competency, or mark it not assessed: ${missing.join(", ")}.`,
    );
  }
  for (const r of params.ratings) {
    if (r.rating != null && (r.rating < 1 || r.rating > 4)) {
      errors.push(`Rating for ${r.competencyName} must be between 1 and 4.`);
    }
  }
  return { ok: errors.length === 0, errors };
}
