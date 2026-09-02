/**
 * Loading calibration data.
 *
 * Two things a rater does count as an assessment of a candidate: a scorecard
 * filed after an interview, and a review filed in an independent review
 * round. Both put a person's name against a four-point recommendation on one
 * application, so both belong in the same calibration.
 *
 * Outcomes come from the validation engine: an application that led to a hire
 * who has since been rated on the job. That join is what turns "you rate more
 * generously than your colleagues" into "and the people you were generous
 * about did not do better" — the only question about an interviewer's
 * judgement that actually matters.
 */

import "server-only";
import { prisma } from "@/lib/db";
import { buildCriterion, type ReviewRow } from "@/lib/validation/criterion";
import {
  RECOMMENDATION_VALUE,
  calibrateRater,
  calibrateTeam,
  type AssessmentRow,
  type OutcomeRow,
  type RaterCalibration,
  type TeamCalibration,
} from "./calibration";

export interface CalibrationScope {
  /** Restrict to one requisition. Null covers everything. */
  requisitionId?: string | null;
  /** Only assessments filed on or after this date. */
  since?: Date | null;
}

async function loadAssessments(scope: CalibrationScope): Promise<AssessmentRow[]> {
  const submittedSince = scope.since ? { gte: scope.since } : undefined;

  const [scorecards, reviews] = await Promise.all([
    prisma.scorecard.findMany({
      where: {
        status: "SUBMITTED",
        recommendation: { not: null },
        ...(submittedSince ? { submittedAt: submittedSince } : {}),
        ...(scope.requisitionId
          ? { application: { requisitionId: scope.requisitionId } }
          : {}),
      },
      select: {
        applicationId: true,
        authorId: true,
        recommendation: true,
        submittedAt: true,
        author: { select: { name: true } },
        interview: { select: { scheduledAt: true } },
      },
    }),
    prisma.candidateReview.findMany({
      where: {
        status: "SUBMITTED",
        recommendation: { not: null },
        ...(submittedSince ? { submittedAt: submittedSince } : {}),
        ...(scope.requisitionId
          ? { round: { requisitionId: scope.requisitionId } }
          : {}),
      },
      select: {
        reviewerId: true,
        recommendation: true,
        submittedAt: true,
        reviewer: { select: { name: true } },
        round: { select: { applicationId: true } },
      },
    }),
  ]);

  const rows: AssessmentRow[] = [];
  for (const s of scorecards) {
    if (!s.recommendation || !s.submittedAt) continue;
    rows.push({
      raterId: s.authorId,
      raterName: s.author.name,
      subjectId: s.applicationId,
      value: RECOMMENDATION_VALUE[s.recommendation],
      submittedAt: s.submittedAt,
      eventAt: s.interview?.scheduledAt ?? null,
      source: "SCORECARD",
    });
  }
  for (const r of reviews) {
    if (!r.recommendation || !r.submittedAt) continue;
    rows.push({
      raterId: r.reviewerId,
      raterName: r.reviewer.name,
      subjectId: r.round.applicationId,
      value: RECOMMENDATION_VALUE[r.recommendation],
      submittedAt: r.submittedAt,
      // A review round has no scheduled event to be late relative to.
      eventAt: null,
      source: "REVIEW",
    });
  }
  return rows;
}

/**
 * Performance outcomes keyed by application, so an interviewer's calls can be
 * compared with what the person actually did once hired.
 *
 * The criterion is the same one the validation engine uses — mean of the
 * raters' overall effectiveness ratings — so an interviewer's predictive
 * value and a dimension's validity coefficient are answering the same
 * question against the same yardstick.
 */
async function loadOutcomes(): Promise<OutcomeRow[]> {
  const hires = await prisma.hire.findMany({
    where: { applicationId: { not: null } },
    select: {
      id: true,
      applicationId: true,
      hiredAt: true,
      status: true,
      endedAt: true,
      reviews: {
        where: { status: "SUBMITTED" },
        select: {
          cycleId: true,
          raterId: true,
          overallRating: true,
          wouldRehire: true,
          submittedAt: true,
          cycle: { select: { kind: true } },
        },
      },
    },
  });
  if (hires.length === 0) return [];

  const reviewRows: ReviewRow[] = hires.flatMap((h) =>
    h.reviews
      .filter((r) => r.submittedAt !== null)
      .map((r) => ({
        hireId: h.id,
        cycleId: r.cycleId,
        cycleKind: r.cycle.kind,
        raterId: r.raterId,
        overallRating: r.overallRating,
        wouldRehire: r.wouldRehire,
        submittedAt: r.submittedAt as Date,
        ratings: [],
      })),
  );

  const series = buildCriterion(
    { kind: "OVERALL_RATING", keys: [], cycleKinds: [] },
    {
      hires: hires.map((h) => ({
        hireId: h.id,
        hiredAt: h.hiredAt,
        status: h.status,
        endedAt: h.endedAt,
      })),
      reviews: reviewRows,
      metrics: [],
    },
  );

  const applicationByHire = new Map(hires.map((h) => [h.id, h.applicationId]));
  const out: OutcomeRow[] = [];
  for (const [hireId, criterion] of series.values) {
    const applicationId = applicationByHire.get(hireId);
    if (applicationId) out.push({ subjectId: applicationId, criterion });
  }
  return out;
}

/** The whole interviewing team. Requires the oversight permission. */
export async function teamCalibration(
  scope: CalibrationScope = {},
): Promise<TeamCalibration> {
  const [assessments, outcomes] = await Promise.all([
    loadAssessments(scope),
    loadOutcomes(),
  ]);
  return calibrateTeam(assessments, outcomes);
}

/**
 * One person's own card.
 *
 * Loads every assessment, because a rater can only be measured against the
 * colleagues who saw the same candidates — but returns only this rater's
 * result. Nobody sees a colleague's card from here.
 */
export async function ownCalibration(
  raterId: string,
  raterName: string,
  scope: CalibrationScope = {},
): Promise<RaterCalibration | null> {
  const [assessments, outcomes] = await Promise.all([
    loadAssessments(scope),
    loadOutcomes(),
  ]);
  return calibrateRater(raterId, raterName, assessments, outcomes);
}
