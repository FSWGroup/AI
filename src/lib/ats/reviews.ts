/**
 * Independent candidate review.
 *
 * A review round asks named people to assess a candidate from the record.
 * The rule that makes it worth doing: in a blind round, a reviewer cannot see
 * anyone else's review until theirs is filed.
 *
 * Without that, the first review posted becomes the anchor and the rest
 * converge on it — four names on one opinion. With it, the hiring manager
 * gets four opinions, and where they disagree, that disagreement is real
 * information rather than an artefact of who typed first.
 *
 * The one exception is a reader with permission to see all reviews. That is
 * deliberately a *reading* permission, not a writing one: someone overseeing
 * the process needs the whole picture, and if they are also reviewing they
 * must file their own before the others unlock.
 */

import type { ScorecardRecommendation } from "@prisma/client";
import { RECOMMENDATION_SCORE } from "./scorecards";

export interface ReviewLike {
  id: string;
  reviewerId: string;
  reviewerName: string;
  status: string;
  recommendation: ScorecardRecommendation | null;
  summary: string | null;
  submittedAt: Date | string | null;
  ratings: { criterionName: string; rating: number | null; note: string | null }[];
}

export interface VisibilityDecision {
  /** Reviews this viewer may read right now. */
  visible: ReviewLike[];
  /** Reviews withheld, and why. */
  hiddenCount: number;
  reason: string | null;
}

/**
 * Which reviews a viewer may see.
 *
 * @param canSeeAll Oversight permission. It opens every filed review to
 *   someone who is *not* reviewing this candidate themselves.
 *
 * Oversight does not exempt you from the blind. If you were asked to review,
 * you file first, whatever your title — a hiring manager who reads the panel
 * before writing their own is exactly the anchoring the round exists to
 * prevent, and their seniority makes it worse rather than better. Once filed,
 * they see everything as before.
 */
export function visibleReviews(params: {
  reviews: ReviewLike[];
  viewerId: string;
  blind: boolean;
  canSeeAll: boolean;
  roundClosed: boolean;
}): VisibilityDecision {
  const { reviews, viewerId, blind, canSeeAll, roundClosed } = params;
  const submitted = reviews.filter((r) => r.status === "SUBMITTED");
  const own = reviews.filter((r) => r.reviewerId === viewerId);
  const isReviewer = own.length > 0;

  if (!blind || roundClosed || (canSeeAll && !isReviewer)) {
    return { visible: submitted, hiddenCount: 0, reason: null };
  }

  const viewerSubmitted = own.some((r) => r.status === "SUBMITTED");
  if (viewerSubmitted) {
    return { visible: submitted, hiddenCount: 0, reason: null };
  }

  const hidden = submitted.filter((r) => r.reviewerId !== viewerId);
  return {
    visible: submitted.filter((r) => r.reviewerId === viewerId),
    hiddenCount: hidden.length,
    reason:
      hidden.length > 0
        ? `${hidden.length} other review${hidden.length === 1 ? "" : "s"} ${hidden.length === 1 ? "is" : "are"} in. You will see ${hidden.length === 1 ? "it" : "them"} once you file your own — reading first would anchor your judgement to someone else's.`
        : "Reviews unlock once you file your own.",
  };
}

export interface ReviewProgress {
  invited: number;
  submitted: number;
  outstanding: { reviewerId: string; reviewerName: string }[];
  complete: boolean;
}

export function reviewProgress(reviews: ReviewLike[]): ReviewProgress {
  const outstanding = reviews
    .filter((r) => r.status !== "SUBMITTED")
    .map((r) => ({ reviewerId: r.reviewerId, reviewerName: r.reviewerName }));
  return {
    invited: reviews.length,
    submitted: reviews.length - outstanding.length,
    outstanding,
    complete: reviews.length > 0 && outstanding.length === 0,
  };
}

export interface ConsensusView {
  submittedCount: number;
  recommendations: Record<ScorecardRecommendation, number>;
  averageScore: number | null;
  /** At least one yes and one no. */
  split: boolean;
  /** The widest disagreement, when the panel is split. */
  spread: number | null;
  criteria: {
    criterionName: string;
    ratings: { reviewerName: string; rating: number | null; note: string | null }[];
    average: number | null;
    split: boolean;
  }[];
}

/**
 * The consolidated view: every rating and every written note, attributed.
 *
 * Averages are shown alongside the individual reviews, never instead of them.
 * A mean of 2.5 describes a unanimous lukewarm panel and a violently split one
 * identically, and those call for opposite next steps.
 */
export function buildConsensus(reviews: ReviewLike[]): ConsensusView {
  const submitted = reviews.filter(
    (r) => r.status === "SUBMITTED" && r.recommendation != null,
  );
  const recommendations: Record<ScorecardRecommendation, number> = {
    STRONG_NO: 0,
    NO: 0,
    YES: 0,
    STRONG_YES: 0,
  };
  for (const r of submitted) {
    if (r.recommendation) recommendations[r.recommendation] += 1;
  }
  const scores = submitted
    .map((r) => (r.recommendation ? RECOMMENDATION_SCORE[r.recommendation] : null))
    .filter((n): n is number => n != null);

  const positives = recommendations.YES + recommendations.STRONG_YES;
  const negatives = recommendations.NO + recommendations.STRONG_NO;

  const byCriterion = new Map<
    string,
    { reviewerName: string; rating: number | null; note: string | null }[]
  >();
  for (const r of submitted) {
    for (const rating of r.ratings) {
      const list = byCriterion.get(rating.criterionName) ?? [];
      list.push({
        reviewerName: r.reviewerName,
        rating: rating.rating,
        note: rating.note,
      });
      byCriterion.set(rating.criterionName, list);
    }
  }

  const criteria = [...byCriterion.entries()]
    .map(([criterionName, ratings]) => {
      const values = ratings
        .map((x) => x.rating)
        .filter((n): n is number => n != null);
      return {
        criterionName,
        ratings,
        average:
          values.length > 0
            ? values.reduce((a, b) => a + b, 0) / values.length
            : null,
        split: values.length > 1 && Math.max(...values) - Math.min(...values) >= 2,
      };
    })
    .sort((a, b) => a.criterionName.localeCompare(b.criterionName));

  return {
    submittedCount: submitted.length,
    recommendations,
    averageScore:
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    split: positives > 0 && negatives > 0,
    spread: scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : null,
    criteria,
  };
}
