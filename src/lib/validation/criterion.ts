/**
 * Assembling the criterion.
 *
 * A validity study is only as good as its outcome measure, and the outcome
 * measure is the part everyone rushes. These functions turn the rows a
 * manager actually filled in — several raters, several cycles, some of them
 * missing — into one number per hire, and keep the per-rater values so the
 * criterion's own reliability can be estimated rather than assumed.
 *
 * Pure functions over plain shapes. The database layer hands them rows; they
 * know nothing about Prisma.
 */

import type { PerformanceCycleKind } from "@prisma/client";

export interface ReviewRow {
  hireId: string;
  cycleId: string;
  cycleKind: PerformanceCycleKind;
  raterId: string;
  overallRating: number | null;
  wouldRehire: boolean | null;
  submittedAt: Date;
  ratings: { criterionKey: string; value: number }[];
}

export interface MetricRow {
  hireId: string;
  key: string;
  value: number;
  higherIsBetter: boolean;
  periodEnd: Date;
}

export interface HireRow {
  hireId: string;
  hiredAt: Date;
  status: "ACTIVE" | "ON_LEAVE" | "DEPARTED_VOLUNTARY" | "DEPARTED_INVOLUNTARY";
  endedAt: Date | null;
}

export type CriterionKind =
  | "OVERALL_RATING"
  | "COMPETENCY_RATING"
  | "COMPOSITE_RATING"
  | "METRIC"
  | "RETENTION";

export interface CriterionSpec {
  kind: CriterionKind;
  /** Criterion keys for COMPETENCY_RATING / COMPOSITE_RATING, or the metric key. */
  keys: string[];
  /** Cycle kinds to include. Empty means every cycle. */
  cycleKinds: PerformanceCycleKind[];
  /** Horizon in days for RETENTION. */
  retentionDays?: number;
}

export interface CriterionSeries {
  /** One value per hire that has a usable criterion. */
  values: Map<string, number>;
  /**
   * Per-hire rater values, for estimating criterion reliability. Empty for
   * criteria that have no raters (retention, objective metrics) — those
   * carry no rater error, so no correction is offered for them either.
   */
  raterValues: Map<string, number[]>;
  /** Hires excluded, and why. Shown in the study, never quietly dropped. */
  excluded: { hireId: string; reason: string }[];
  /** Plain-English description of what was measured. */
  description: string;
  /** True when the criterion is 0/1 and the coefficient is point-biserial. */
  dichotomous: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The most recent submitted review per (hire, rater) within the allowed
 * cycles. One rater who reviewed the same person at 90 days and again at a
 * year gets one vote, not two: repeated measurement of the same rater is
 * not independent evidence, and counting it twice would inflate both the
 * sample size and the apparent reliability.
 */
function latestPerRater(
  reviews: ReviewRow[],
  cycleKinds: PerformanceCycleKind[],
): ReviewRow[] {
  const allowed = new Set(cycleKinds);
  const latest = new Map<string, ReviewRow>();
  for (const r of reviews) {
    if (allowed.size > 0 && !allowed.has(r.cycleKind)) continue;
    const key = `${r.hireId}::${r.raterId}`;
    const existing = latest.get(key);
    if (!existing || r.submittedAt > existing.submittedAt) latest.set(key, r);
  }
  return [...latest.values()];
}

function meanOf(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function ratingValue(review: ReviewRow, spec: CriterionSpec): number | null {
  if (spec.kind === "OVERALL_RATING") {
    return review.overallRating ?? null;
  }
  const wanted = new Set(spec.keys);
  const present = review.ratings.filter((r) => wanted.has(r.criterionKey));
  if (present.length === 0) return null;
  if (spec.kind === "COMPETENCY_RATING") {
    // A single named criterion; if several were somehow named, average them.
    return meanOf(present.map((r) => r.value));
  }
  // COMPOSITE_RATING: require most of the composite to be present, otherwise
  // a review that rated one of five criteria would sit on the same scale as
  // one that rated all five.
  if (present.length < Math.ceil(spec.keys.length / 2)) return null;
  return meanOf(present.map((r) => r.value));
}

export function buildCriterion(
  spec: CriterionSpec,
  data: { hires: HireRow[]; reviews: ReviewRow[]; metrics: MetricRow[] },
  now: Date = new Date(),
): CriterionSeries {
  const values = new Map<string, number>();
  const raterValues = new Map<string, number[]>();
  const excluded: { hireId: string; reason: string }[] = [];

  if (spec.kind === "RETENTION") {
    const days = spec.retentionDays ?? 365;
    for (const hire of data.hires) {
      const tenureEnd = hire.endedAt ?? now;
      const tenureDays = (tenureEnd.getTime() - hire.hiredAt.getTime()) / DAY_MS;
      if (hire.endedAt) {
        values.set(hire.hireId, tenureDays >= days ? 1 : 0);
      } else if (tenureDays >= days) {
        values.set(hire.hireId, 1);
      } else {
        // Still employed but not yet at the horizon. Counting this person as
        // a 0 would score every recent hire as a failure; counting them as a
        // 1 would score them as a success they have not reached yet.
        excluded.push({
          hireId: hire.hireId,
          reason: `Still employed at ${Math.floor(tenureDays)} days; the ${days}-day horizon has not been reached.`,
        });
      }
    }
    return {
      values,
      raterValues,
      excluded,
      description: `Still employed ${days} days after the hire date (1 = yes, 0 = no).`,
      dichotomous: true,
    };
  }

  if (spec.kind === "METRIC") {
    const key = spec.keys[0];
    const byHire = new Map<string, MetricRow>();
    for (const m of data.metrics) {
      if (m.key !== key) continue;
      const existing = byHire.get(m.hireId);
      if (!existing || m.periodEnd > existing.periodEnd) byHire.set(m.hireId, m);
    }
    let flipped = false;
    for (const hire of data.hires) {
      const m = byHire.get(hire.hireId);
      if (!m) {
        excluded.push({ hireId: hire.hireId, reason: `No "${key}" metric recorded.` });
        continue;
      }
      if (!m.higherIsBetter) flipped = true;
      // Sign is flipped for lower-is-better metrics so that across every
      // study, a positive coefficient always means the assessment predicted
      // the outcome the business wants.
      values.set(hire.hireId, m.higherIsBetter ? m.value : -m.value);
    }
    return {
      values,
      raterValues,
      excluded,
      description: flipped
        ? `Most recent "${key}" metric, sign reversed because lower is better.`
        : `Most recent "${key}" metric.`,
      dichotomous: false,
    };
  }

  const reviews = latestPerRater(data.reviews, spec.cycleKinds);
  const byHire = new Map<string, number[]>();
  for (const review of reviews) {
    const v = ratingValue(review, spec);
    if (v === null) continue;
    const list = byHire.get(review.hireId) ?? [];
    list.push(v);
    byHire.set(review.hireId, list);
  }

  for (const hire of data.hires) {
    const ratings = byHire.get(hire.hireId);
    if (!ratings || ratings.length === 0) {
      excluded.push({ hireId: hire.hireId, reason: "No submitted review covering this criterion." });
      continue;
    }
    values.set(hire.hireId, meanOf(ratings));
    raterValues.set(hire.hireId, ratings);
  }

  const description =
    spec.kind === "OVERALL_RATING"
      ? "Mean of raters' overall effectiveness ratings (1-5)."
      : spec.kind === "COMPETENCY_RATING"
        ? `Mean rating on "${spec.keys[0]}" (1-5).`
        : `Mean rating across ${spec.keys.length} criteria (1-5).`;

  return { values, raterValues, excluded, description, dichotomous: false };
}

/** Cycles a hire is due for, given their tenure. Drives the review queue. */
export function cyclesDueFor(
  hire: { hiredAt: Date; status: string },
  cycles: {
    id: string;
    dueAfterDays: number | null;
    opensAt: Date | null;
    closesAt: Date | null;
    status: string;
  }[],
  now: Date = new Date(),
): string[] {
  if (hire.status !== "ACTIVE" && hire.status !== "ON_LEAVE") return [];
  const tenureDays = (now.getTime() - hire.hiredAt.getTime()) / DAY_MS;
  return cycles
    .filter((c) => {
      if (c.status !== "OPEN") return false;
      if (c.opensAt && c.opensAt > now) return false;
      if (c.closesAt && c.closesAt < now) return false;
      if (c.dueAfterDays === null) return true;
      return tenureDays >= c.dueAfterDays;
    })
    .map((c) => c.id);
}
