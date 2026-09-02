/**
 * Sample-size gates.
 *
 * These thresholds decide what the platform is willing to SAY, and they are
 * deliberately conservative. A local validation study with twenty hires
 * produces a number; it does not produce evidence. The difference matters
 * because the output of this engine ends up in front of people making
 * employment decisions, and in front of anyone who later asks how those
 * decisions were justified.
 *
 * Every threshold is a judgement call, so every one is named, exported and
 * documented here rather than buried at its point of use. Argue with them
 * in one place.
 */

/** Below this, no coefficient is computed or shown at all. */
export const MIN_N_COEFFICIENT = 20;

/**
 * Below this, a coefficient is labelled preliminary whatever its p value.
 * At n = 100 the 95% interval around r = .30 still spans roughly .11 to .47,
 * which is the point: even a "supported" local coefficient is imprecise.
 */
export const MIN_N_SUPPORTED = 100;

/** Below this, no norm table can be generated, not even a draft. */
export const MIN_N_NORM_DRAFT = 100;

/**
 * Below this, a generated norm table stays a draft and cannot be activated.
 * Bands 1 and 9 cover the outer 4% of the distribution; at 200 cases that is
 * eight people defining each end, which is thin but arguable. Under it the
 * band boundaries are noise.
 */
export const MIN_N_NORM_ACTIVE = 200;

/** Applicant scores needed before a range-restriction correction is offered. */
export const MIN_N_UNRESTRICTED = 50;

/** Targets with two or more raters needed before criterion reliability is estimated. */
export const MIN_TARGETS_FOR_ICC = 10;

/** Criterion reliability below this makes the attenuation correction unstable. */
export const MIN_RELIABILITY_FOR_CORRECTION = 0.4;

export type CoefficientVerdict =
  | "INSUFFICIENT"
  | "PRELIMINARY"
  | "SUPPORTED"
  | "NOT_SUPPORTED";

export const VERDICT_LABEL: Record<CoefficientVerdict, string> = {
  INSUFFICIENT: "Not enough data",
  PRELIMINARY: "Preliminary",
  SUPPORTED: "Supported",
  NOT_SUPPORTED: "No relationship",
};

export const VERDICT_MEANING: Record<CoefficientVerdict, string> = {
  INSUFFICIENT:
    "Too few hires with both a score and a performance rating to say anything. Not evidence of absence.",
  PRELIMINARY:
    "A relationship in the expected direction, from a sample too small to rely on. Treat as a hypothesis for the next cycle, not a finding.",
  SUPPORTED:
    "A relationship this sample supports after adjusting for the number of dimensions tested. The confidence interval still shows how precisely.",
  NOT_SUPPORTED:
    "A sample large enough to have detected a relationship of practical size did not find one. This dimension is not earning its place for this criterion.",
};

/**
 * The verdict for one predictor.
 *
 * `qValue` is the Benjamini-Hochberg adjusted p, not the raw one: with
 * eighteen dimensions tested, the raw p is the wrong yardstick and using it
 * would manufacture a finding roughly once per study.
 */
export function coefficientVerdict(args: {
  n: number;
  qValue: number;
  ciLow: number;
  ciHigh: number;
}): CoefficientVerdict {
  if (args.n < MIN_N_COEFFICIENT) return "INSUFFICIENT";
  if (args.n < MIN_N_SUPPORTED) return "PRELIMINARY";
  const excludesZero = args.ciLow > 0 || args.ciHigh < 0;
  if (args.qValue < 0.05 && excludesZero) return "SUPPORTED";
  return "NOT_SUPPORTED";
}

export type NormGate = "BLOCKED" | "DRAFT_ONLY" | "ACTIVATABLE";

export function normGate(n: number): NormGate {
  if (n < MIN_N_NORM_DRAFT) return "BLOCKED";
  if (n < MIN_N_NORM_ACTIVE) return "DRAFT_ONLY";
  return "ACTIVATABLE";
}

export function normGateExplanation(n: number): string {
  switch (normGate(n)) {
    case "BLOCKED":
      return `${n} cases. A norm table needs at least ${MIN_N_NORM_DRAFT} before the band boundaries mean anything; scores stay on provisional bands.`;
    case "DRAFT_ONLY":
      return `${n} cases. Enough to see the distribution forming, not enough to band people by it. The table can be saved as a draft and reviewed, but it will not be used for scoring until it reaches ${MIN_N_NORM_ACTIVE}.`;
    case "ACTIVATABLE":
      return `${n} cases. Enough to activate: about ${Math.round(n * 0.04)} cases define each of the outer bands. Report the sample size alongside any stanine derived from it.`;
  }
}
