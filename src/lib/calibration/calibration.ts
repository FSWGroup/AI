/**
 * Interviewer calibration.
 *
 * Two interviewers watching the same interview routinely reach different
 * conclusions, and the difference is often more about the interviewer than
 * the candidate. This measures that difference so it can be corrected —
 * which is the only honest way to use a structured interview at all.
 *
 * Four things get measured, and one design decision runs through all of them:
 *
 *   Never compare raw averages between interviewers. An interviewer who only
 *   ever meets final-round candidates will look lenient beside one who takes
 *   every first screen, and the difference is the pipeline, not their
 *   judgement. Every comparison here is PAIRED: an interviewer is measured
 *   only against the other people who assessed the SAME candidate.
 *
 * What this is for, and what it is not for:
 *
 *   This is data about employees' judgement, generated as a by-product of
 *   their work. It is a coaching instrument. An interviewer sees their own
 *   card, in their own words, with what to do about it. It is deliberately
 *   not a leaderboard, has no composite "interviewer score", and ranks
 *   nobody — because the moment it does, interviewers start scoring to the
 *   metric and the ratings stop being about candidates.
 */

import type { ScorecardRecommendation } from "@prisma/client";
import { mean, pearson, sd } from "@/lib/validation/stats";

export const RECOMMENDATION_VALUE: Record<ScorecardRecommendation, number> = {
  STRONG_NO: 1,
  NO: 2,
  YES: 3,
  STRONG_YES: 4,
};

/** One person's assessment of one candidate, from a scorecard or a review. */
export interface AssessmentRow {
  raterId: string;
  raterName: string;
  /** Whatever identifies the candidate assessed — an application id. */
  subjectId: string;
  /** 1-4 on the recommendation scale. */
  value: number;
  submittedAt: Date;
  /** When the interview happened, where there was one. Drives the delay stat. */
  eventAt: Date | null;
  source: "SCORECARD" | "REVIEW";
}

/** A hired candidate's later performance, for the predictive-value section. */
export interface OutcomeRow {
  subjectId: string;
  /** Criterion value, on whatever scale the performance cycle used. */
  criterion: number;
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

/** Below this many assessments, nothing is reported about a rater at all. */
export const MIN_ASSESSMENTS = 5;

/** Below this many shared candidates, no comparison with peers is reported. */
export const MIN_SHARED = 4;

/** Below this many hired-and-rated candidates, no predictive value. */
export const MIN_OUTCOMES = 10;

/**
 * How far a rater's mean can sit from their peers' before it is worth
 * raising. On a four-point scale, half a point is the difference between a
 * panel that agrees and a panel that does not.
 */
export const NOTABLE_LENIENCY = 0.5;

/**
 * Below this spread, a rater is not distinguishing between candidates. An SD
 * of 0.4 on a 1-4 scale means almost every candidate got the same answer.
 */
export const MIN_USEFUL_SPREAD = 0.4;

/** A scorecard written this long after the interview is written from memory. */
export const STALE_SCORECARD_HOURS = 48;

/**
 * Agreement below this is worth raising. Correlating at .4 with the rest of
 * the panel across dozens of shared candidates still means large, unexplained
 * disagreements on individual people.
 */
export const MIN_USEFUL_AGREEMENT = 0.4;

/**
 * Share of ratings in the two extreme buckets above which a rater is treating
 * a four-point scale as a two-point one. A high spread hides this: someone who
 * says only "strong no" or "strong yes" has more variance than anyone, and
 * less information, because they have stopped distinguishing a good candidate
 * from an outstanding one.
 */
export const MAX_EXTREME_SHARE = 0.8;

// ---------------------------------------------------------------------------
// Per-rater calibration
// ---------------------------------------------------------------------------

export type Tendency = "LENIENT" | "SEVERE" | "ALIGNED" | "UNKNOWN";

export interface RaterCalibration {
  raterId: string;
  raterName: string;
  assessments: number;
  /** This rater's own mean, for reference. Never compared across raters. */
  ownMean: number;
  /** Spread of their own ratings. Low means they are not discriminating. */
  ownSpread: number;
  distribution: Record<1 | 2 | 3 | 4, number>;

  /** Candidates this rater assessed alongside at least one other person. */
  sharedSubjects: number;
  /**
   * Mean difference between this rater and the mean of the others on the
   * same candidates. Positive is more generous than the panel.
   */
  leniency: number | null;
  /** Mean absolute gap from the panel on shared candidates. */
  meanAbsoluteGap: number | null;
  /** Correlation with the panel's mean across shared candidates. */
  agreement: number | null;
  tendency: Tendency;

  /** Hired candidates this rater assessed who now have a performance rating. */
  outcomeCount: number;
  /** Correlation between this rater's calls and later performance. */
  predictiveR: number | null;

  /** Scorecards filed more than STALE_SCORECARD_HOURS after the interview. */
  lateCount: number;
  medianHoursToSubmit: number | null;

  /** Plain-language coaching. Never a score, never a rank. */
  observations: CalibrationObservation[];
  /**
   * The single most significant finding, for the badge. Deliberately not a
   * composite of everything — a summary number is the thing people would
   * start optimizing.
   */
  headline: CalibrationObservation["kind"];
}

export interface CalibrationObservation {
  kind:
    | "LENIENT"
    | "SEVERE"
    | "NARROW_RANGE"
    | "POLARIZED"
    | "DISAGREES"
    | "PREDICTIVE"
    | "NOT_PREDICTIVE"
    | "LATE"
    | "TOO_FEW"
    | "WELL_CALIBRATED";
  /** What was measured. */
  finding: string;
  /** What to do about it. Absent when there is nothing to do. */
  suggestion?: string;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * One row per (rater, candidate).
 *
 * The source rows are a union of two tables — scorecards keyed on the
 * application, and independent-review rows keyed on the review round's
 * application — so one person can produce two rows about the same candidate:
 * a scorecard and a review, or scorecards from two rounds they both ran.
 * Nothing collapsed them, and four separate things went wrong as a result.
 *
 * `sharedSubjects` counted assessments and was rendered as "candidates
 * assessed alongside someone else". A doubly-rated candidate was weighted
 * twice in leniency, mean gap and agreement. `panelDisagreement` paired a
 * rater against HERSELF — her own scorecard-versus-review inconsistency was
 * published as disagreement between people. And a candidate seen by one
 * person who filed twice counted as shared rather than solo, weakening the
 * warning that exists to say nobody checked that rating.
 *
 * Collapsed by taking the MEAN of the duplicates. Their disagreement is a
 * real signal, but it is a signal about one person's own consistency, and
 * this module measures how people compare with each other; averaging keeps
 * the candidate's weight at one, which is what every statistic here assumes.
 * The latest submission carries the timestamps.
 */
export function collapseDuplicateAssessments(
  rows: AssessmentRow[],
): AssessmentRow[] {
  const byPair = new Map<string, AssessmentRow[]>();
  for (const row of rows) {
    const key = `${row.raterId}\u0000${row.subjectId}`;
    const list = byPair.get(key);
    if (list) list.push(row);
    else byPair.set(key, [row]);
  }

  const collapsed: AssessmentRow[] = [];
  for (const group of byPair.values()) {
    if (group.length === 1) {
      collapsed.push(group[0]);
      continue;
    }
    const latest = group.reduce((a, b) =>
      b.submittedAt.getTime() > a.submittedAt.getTime() ? b : a,
    );
    collapsed.push({
      ...latest,
      value: mean(group.map((g) => g.value)),
    });
  }
  return collapsed;
}

export function calibrateRater(
  raterId: string,
  raterName: string,
  rows: AssessmentRow[],
  outcomes: OutcomeRow[] = [],
): RaterCalibration | null {
  const all = collapseDuplicateAssessments(rows);
  const mine = all.filter((a) => a.raterId === raterId);
  if (mine.length === 0) return null;

  const values = mine.map((a) => a.value);
  const distribution: Record<1 | 2 | 3 | 4, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const v of values) {
    const key = Math.min(4, Math.max(1, Math.round(v))) as 1 | 2 | 3 | 4;
    distribution[key]++;
  }

  // ---- Paired comparison with peers ----------------------------------------
  const bySubject = new Map<string, AssessmentRow[]>();
  for (const a of all) {
    const list = bySubject.get(a.subjectId) ?? [];
    list.push(a);
    bySubject.set(a.subjectId, list);
  }

  const gaps: number[] = [];
  const pairs: { x: number; y: number }[] = [];
  for (const a of mine) {
    const others = (bySubject.get(a.subjectId) ?? []).filter(
      (o) => o.raterId !== raterId,
    );
    if (others.length === 0) continue;
    const peerMean = mean(others.map((o) => o.value));
    gaps.push(a.value - peerMean);
    pairs.push({ x: a.value, y: peerMean });
  }

  const sharedSubjects = gaps.length;
  const enoughShared = sharedSubjects >= MIN_SHARED;
  const leniency = enoughShared ? mean(gaps) : null;
  const meanAbsoluteGap = enoughShared ? mean(gaps.map(Math.abs)) : null;
  const agreement = enoughShared ? pearson(pairs) : null;

  // ---- Predictive value ------------------------------------------------------
  const outcomeBySubject = new Map(outcomes.map((o) => [o.subjectId, o.criterion]));
  const outcomePairs: { x: number; y: number }[] = [];
  for (const a of mine) {
    const criterion = outcomeBySubject.get(a.subjectId);
    if (criterion !== undefined) outcomePairs.push({ x: a.value, y: criterion });
  }
  const outcomeCount = outcomePairs.length;
  const predictiveR = outcomeCount >= MIN_OUTCOMES ? pearson(outcomePairs) : null;

  // ---- Timeliness -------------------------------------------------------------
  const delays = mine
    .filter((a) => a.eventAt !== null)
    .map((a) => (a.submittedAt.getTime() - (a.eventAt as Date).getTime()) / HOUR_MS)
    .filter((h) => h >= 0);
  const lateCount = delays.filter((h) => h > STALE_SCORECARD_HOURS).length;

  const ownSpread = values.length >= 2 ? sd(values) : 0;

  const tendency: Tendency =
    leniency === null
      ? "UNKNOWN"
      : leniency >= NOTABLE_LENIENCY
        ? "LENIENT"
        : leniency <= -NOTABLE_LENIENCY
          ? "SEVERE"
          : "ALIGNED";

  const calibration: RaterCalibration = {
    raterId,
    raterName,
    assessments: mine.length,
    ownMean: mean(values),
    ownSpread,
    distribution,
    sharedSubjects,
    leniency,
    meanAbsoluteGap,
    agreement,
    tendency,
    outcomeCount,
    predictiveR,
    lateCount,
    medianHoursToSubmit: median(delays),
    observations: [],
    headline: "WELL_CALIBRATED",
  };
  calibration.observations = observationsFor(calibration);
  calibration.headline = headlineOf(calibration.observations);
  return calibration;
}

/**
 * Which finding goes on the badge, most consequential first.
 *
 * Inconsistency outranks leniency: a consistent bias can be adjusted for in a
 * debrief, while disagreement that varies candidate by candidate cannot.
 */
const HEADLINE_PRIORITY: CalibrationObservation["kind"][] = [
  "TOO_FEW",
  "DISAGREES",
  "POLARIZED",
  "NARROW_RANGE",
  "LENIENT",
  "SEVERE",
  "NOT_PREDICTIVE",
  "LATE",
  "PREDICTIVE",
  "WELL_CALIBRATED",
];

function headlineOf(
  observations: CalibrationObservation[],
): CalibrationObservation["kind"] {
  for (const kind of HEADLINE_PRIORITY) {
    if (observations.some((o) => o.kind === kind)) return kind;
  }
  return "WELL_CALIBRATED";
}

function observationsFor(c: RaterCalibration): CalibrationObservation[] {
  const out: CalibrationObservation[] = [];
  const round = (v: number) => Math.abs(v).toFixed(2);

  if (c.assessments < MIN_ASSESSMENTS) {
    out.push({
      kind: "TOO_FEW",
      finding: `${c.assessments} assessment${c.assessments === 1 ? "" : "s"} so far. Too few to say anything about how this person rates.`,
    });
    return out;
  }

  if (c.tendency === "LENIENT" && c.leniency !== null) {
    out.push({
      kind: "LENIENT",
      finding: `Rates ${round(c.leniency)} points higher than the rest of the panel on the same candidates, across ${c.sharedSubjects} of them.`,
      suggestion:
        "Before submitting, write down the specific evidence for the rating first and pick the rating second. Leniency usually comes from rating the conversation rather than the evidence.",
    });
  }
  if (c.tendency === "SEVERE" && c.leniency !== null) {
    out.push({
      kind: "SEVERE",
      finding: `Rates ${round(c.leniency)} points lower than the rest of the panel on the same candidates, across ${c.sharedSubjects} of them.`,
      suggestion:
        "Check what you are rating against. A rating of 'meets the bar' means the bar for this role, not the strongest person you have ever interviewed.",
    });
  }

  if (c.ownSpread < MIN_USEFUL_SPREAD) {
    const dominant = (Object.entries(c.distribution) as [string, number][]).sort(
      (a, b) => b[1] - a[1],
    )[0];
    out.push({
      kind: "NARROW_RANGE",
      finding: `Almost every candidate gets the same answer — ${dominant[1]} of ${c.assessments} scored ${dominant[0]}. Ratings this uniform carry very little information about who is different from whom.`,
      suggestion:
        "Use the whole scale. If nobody is ever above the bar, the panel cannot tell your strong candidates from your acceptable ones, and the interview is not adding anything to the decision.",
    });
  }

  const extremeShare =
    c.assessments > 0
      ? (c.distribution[1] + c.distribution[4]) / c.assessments
      : 0;
  if (c.ownSpread >= MIN_USEFUL_SPREAD && extremeShare >= MAX_EXTREME_SHARE) {
    out.push({
      kind: "POLARIZED",
      finding: `${Math.round(extremeShare * 100)}% of ratings are "strong no" or "strong yes" — the middle of the scale is barely used. This shows up as a wide spread, but it is the opposite of discrimination: it cannot tell a solid candidate from an outstanding one.`,
      suggestion:
        "The middle two points are where most real candidates belong. Reserve the extremes for the cases you would argue for or against in a debrief, and use 'no' and 'yes' for everyone else.",
    });
  }

  if (
    c.agreement !== null &&
    c.agreement < MIN_USEFUL_AGREEMENT &&
    c.sharedSubjects >= MIN_SHARED
  ) {
    out.push({
      kind: "DISAGREES",
      finding: `Ratings track the rest of the panel weakly (r = ${c.agreement.toFixed(2)} across ${c.sharedSubjects} shared candidates). The disagreement is not a consistent leniency that could be adjusted for — it varies candidate by candidate.`,
      suggestion:
        "Sit in on a debrief before filing your next few scorecards, and compare the evidence you noted against what others noted. Disagreement is not automatically wrong, but it should be traceable to something specific.",
    });
  }

  if (c.predictiveR !== null) {
    if (c.predictiveR >= 0.3) {
      out.push({
        kind: "PREDICTIVE",
        finding: `Of the ${c.outcomeCount} people rated who were hired and have since been rated on the job, the calls made here line up with how they actually did (r = ${c.predictiveR.toFixed(2)}).`,
      });
    } else if (c.predictiveR <= 0.05) {
      out.push({
        kind: "NOT_PREDICTIVE",
        finding: `Across the ${c.outcomeCount} people rated who were hired and have since been rated on the job, these calls show no relationship with how they did (r = ${c.predictiveR.toFixed(2)}).`,
        suggestion:
          "This is the most useful and least comfortable number here, and it is also the smallest sample. Treat it as a prompt to look at the interviews themselves — which questions were asked, and whether the evidence collected was about the job — rather than as a verdict.",
      });
    }
  }

  if (c.lateCount > 0 && c.medianHoursToSubmit !== null) {
    out.push({
      kind: "LATE",
      finding: `${c.lateCount} scorecard${c.lateCount === 1 ? "" : "s"} filed more than ${STALE_SCORECARD_HOURS} hours after the interview; the typical gap is ${Math.round(c.medianHoursToSubmit)} hours.`,
      suggestion:
        "File within the hour. A scorecard written two days later is written from memory of an impression, and impressions drift toward whatever the rest of the panel said in the meantime.",
    });
  }

  if (out.length === 0) {
    out.push({
      kind: "WELL_CALIBRATED",
      finding:
        "Nothing stands out. Ratings sit close to the rest of the panel, use the range of the scale, and arrive promptly.",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Across the interviewing team
// ---------------------------------------------------------------------------

export interface TeamCalibration {
  raters: RaterCalibration[];
  totalAssessments: number;
  /**
   * Agreement across the whole panel: the mean absolute gap between any two
   * people who assessed the same candidate. Zero would be perfect agreement;
   * on a four-point scale, above about 0.8 means the panel is not measuring
   * the same thing.
   */
  panelDisagreement: number | null;
  /** Candidates assessed by two or more people — the calibratable ones. */
  sharedSubjects: number;
  /** Candidates assessed by one person only, whose rating nothing checks. */
  soloSubjects: number;
  warnings: string[];
}

export function calibrateTeam(
  rows: AssessmentRow[],
  outcomes: OutcomeRow[] = [],
): TeamCalibration {
  const all = collapseDuplicateAssessments(rows);
  const raterNames = new Map<string, string>();
  for (const a of all) raterNames.set(a.raterId, a.raterName);

  const raters = [...raterNames.entries()]
    .map(([id, name]) => calibrateRater(id, name, all, outcomes))
    .filter((r): r is RaterCalibration => r !== null)
    // Alphabetical, deliberately. Sorting by leniency would make this a
    // ranking, and a ranking is what turns coaching into a scoreboard.
    .sort((a, b) => a.raterName.localeCompare(b.raterName));

  const bySubject = new Map<string, AssessmentRow[]>();
  for (const a of all) {
    const list = bySubject.get(a.subjectId) ?? [];
    list.push(a);
    bySubject.set(a.subjectId, list);
  }

  const pairwiseGaps: number[] = [];
  let shared = 0;
  let solo = 0;
  for (const rows of bySubject.values()) {
    if (rows.length < 2) {
      solo++;
      continue;
    }
    shared++;
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        pairwiseGaps.push(Math.abs(rows[i].value - rows[j].value));
      }
    }
  }

  const warnings: string[] = [];
  if (solo > shared) {
    warnings.push(
      `${solo} candidates were assessed by only one person, against ${shared} assessed by two or more. A rating nobody else saw the same candidate for cannot be calibrated against anything — the figures below cover only the shared ones.`,
    );
  }
  if (raters.some((r) => r.assessments < MIN_ASSESSMENTS)) {
    warnings.push(
      `Some interviewers have fewer than ${MIN_ASSESSMENTS} assessments. Nothing is reported for them beyond the count.`,
    );
  }
  // `raters.length > 0` because [].every() is true: with no raters at all
  // this announced that "no interviewer yet has 10 people they assessed…",
  // which describes a shortfall in data that does not exist.
  if (
    raters.length > 0 &&
    outcomes.length > 0 &&
    raters.every((r) => r.predictiveR === null)
  ) {
    warnings.push(
      `No interviewer yet has ${MIN_OUTCOMES} people they assessed who were hired and have since been rated on the job, so predictive value is not reported for anyone. It becomes available as performance reviews accumulate.`,
    );
  }

  return {
    raters,
    totalAssessments: all.length,
    panelDisagreement: pairwiseGaps.length > 0 ? mean(pairwiseGaps) : null,
    sharedSubjects: shared,
    soloSubjects: solo,
    warnings,
  };
}

/** Badge wording for the headline finding. */
export const HEADLINE_LABEL: Record<CalibrationObservation["kind"], string> = {
  TOO_FEW: "Too few to say",
  DISAGREES: "Disagrees with the panel",
  POLARIZED: "Only uses the extremes",
  NARROW_RANGE: "Rates everyone the same",
  LENIENT: "More generous than the panel",
  SEVERE: "Tougher than the panel",
  NOT_PREDICTIVE: "Calls have not predicted performance",
  LATE: "Scorecards filed late",
  PREDICTIVE: "Calls have predicted performance",
  WELL_CALIBRATED: "Nothing stands out",
};

export const HEADLINE_TONE: Record<
  CalibrationObservation["kind"],
  "green" | "amber" | "neutral"
> = {
  TOO_FEW: "neutral",
  DISAGREES: "amber",
  POLARIZED: "amber",
  NARROW_RANGE: "amber",
  LENIENT: "amber",
  SEVERE: "amber",
  NOT_PREDICTIVE: "amber",
  LATE: "amber",
  PREDICTIVE: "green",
  WELL_CALIBRATED: "green",
};
