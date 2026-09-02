/**
 * The validity study.
 *
 * Given predictor scores for a set of hires, the same predictor's scores
 * across the whole applicant pool, and one criterion value per hire, this
 * computes what the assessment actually predicted — with intervals,
 * multiple-comparison adjustment, and corrections that are offered only when
 * the data supports making them.
 *
 * A deliberate omission: nothing here computes a recommendation. The study
 * reports coefficients and verdicts. Deciding that a dimension should be
 * weighted differently, or dropped from a benchmark, is a human judgement
 * made with the study in front of you, and the platform does not make it for
 * you or apply it automatically.
 */

import type { Construct } from "@prisma/client";
import {
  benjaminiHochberg,
  correctForCriterionUnreliability,
  correlationInference,
  mean,
  oneWayIcc,
  pearson,
  sd,
  spearman,
  thorndikeCaseII,
  type IccResult,
} from "./stats";
import {
  MIN_N_COEFFICIENT,
  MIN_N_SUPPORTED,
  MIN_N_UNRESTRICTED,
  MIN_RELIABILITY_FOR_CORRECTION,
  MIN_TARGETS_FOR_ICC,
  coefficientVerdict,
  type CoefficientVerdict,
} from "./gates";
import type { CriterionSeries } from "./criterion";

export interface PredictorSeries {
  /** Stable identifier: a Construct name or a composite key. */
  key: string;
  label: string;
  construct?: Construct;
  compositeKey?: string;
  /** Score per hire. */
  hireValues: Map<string, number>;
  /**
   * The same predictor across every applicant who completed the assessment,
   * hired or not. This is what makes the range-restriction correction a
   * measurement instead of an assumption.
   */
  applicantValues: number[];
}

export interface StudyOptions {
  correctRangeRestriction: boolean;
  correctAttenuation: boolean;
  confidence: number;
}

export const DEFAULT_STUDY_OPTIONS: StudyOptions = {
  correctRangeRestriction: true,
  correctAttenuation: true,
  confidence: 0.95,
};

export interface CoefficientResult {
  key: string;
  label: string;
  construct?: Construct;
  compositeKey?: string;
  n: number;
  r: number;
  rSpearman: number | null;
  ciLow: number;
  ciHigh: number;
  pValue: number;
  qValue: number;
  rRangeCorrected: number | null;
  rFullyCorrected: number | null;
  sdRestricted: number | null;
  sdUnrestricted: number | null;
  predictorMean: number | null;
  verdict: CoefficientVerdict;
  /** Per-coefficient caveats: skipped corrections, monotonicity mismatches. */
  notes: string[];
}

export interface StudyResult {
  /** Hires with both a criterion value and at least one predictor score. */
  n: number;
  criterionDescription: string;
  criterionDichotomous: boolean;
  criterionReliability: IccResult | null;
  /** The reliability figure actually used for the attenuation correction. */
  reliabilityUsed: number | null;
  coefficients: CoefficientResult[];
  /** Hires the criterion could not be built for. */
  excluded: { hireId: string; reason: string }[];
  warnings: string[];
  /** True when at least one coefficient reached SUPPORTED. */
  anySupported: boolean;
  computedAt: Date;
}

export function computeStudy(
  criterion: CriterionSeries,
  predictors: PredictorSeries[],
  options: StudyOptions = DEFAULT_STUDY_OPTIONS,
  extraWarnings: string[] = [],
): StudyResult {
  const warnings = [...extraWarnings];

  // ---- Criterion reliability ------------------------------------------------
  const raterGroups = [...criterion.raterValues.values()].filter((g) => g.length >= 2);
  const icc = raterGroups.length >= MIN_TARGETS_FOR_ICC ? oneWayIcc(raterGroups) : null;

  let reliabilityUsed: number | null = null;
  if (options.correctAttenuation) {
    if (!icc) {
      warnings.push(
        raterGroups.length === 0
          ? "No hire in this study has two independent raters, so the criterion's reliability cannot be estimated and no correction for criterion unreliability was applied. The observed coefficients therefore understate the relationship by an unknown amount."
          : `Only ${raterGroups.length} hires have two or more raters — fewer than the ${MIN_TARGETS_FOR_ICC} needed for a usable reliability estimate. No attenuation correction was applied.`,
      );
    } else if (icc.iccK < MIN_RELIABILITY_FOR_CORRECTION) {
      warnings.push(
        `Criterion reliability is estimated at ${icc.iccK.toFixed(2)}, below the ${MIN_RELIABILITY_FOR_CORRECTION} floor for a stable correction. Correcting for a criterion this noisy multiplies the coefficient by a large and untrustworthy factor, so no correction was applied. The finding here is about the rating form and the raters, not the assessment: ratings that disagree this much are not yet measuring performance.`,
      );
    } else {
      reliabilityUsed = icc.iccK;
    }
    if (icc?.clampedToZero) {
      warnings.push(
        "The reliability analysis produced a negative variance estimate, which means raters disagreed more within a hire than hires differed from each other. It has been reported as zero.",
      );
    }
  }

  // ---- Per-predictor coefficients -------------------------------------------
  interface Working extends Omit<CoefficientResult, "qValue" | "verdict"> {
    qValue?: number;
  }
  const working: Working[] = [];

  for (const predictor of predictors) {
    const pairs: { x: number; y: number }[] = [];
    const hireScores: number[] = [];
    for (const [hireId, criterionValue] of criterion.values) {
      const score = predictor.hireValues.get(hireId);
      if (score === undefined || !Number.isFinite(score)) continue;
      pairs.push({ x: score, y: criterionValue });
      hireScores.push(score);
    }
    const n = pairs.length;
    const notes: string[] = [];

    const r = pearson(pairs);
    if (r === null) {
      working.push({
        key: predictor.key,
        label: predictor.label,
        construct: predictor.construct,
        compositeKey: predictor.compositeKey,
        n,
        r: Number.NaN,
        rSpearman: null,
        ciLow: Number.NaN,
        ciHigh: Number.NaN,
        pValue: Number.NaN,
        rRangeCorrected: null,
        rFullyCorrected: null,
        sdRestricted: n >= 2 ? sd(hireScores) : null,
        sdUnrestricted: null,
        predictorMean: n >= 1 ? mean(hireScores) : null,
        notes: [
          n < 3
            ? `Only ${n} hires have both a score and a criterion value.`
            : "Every hire in this sample scored identically on this dimension, so no relationship can be computed.",
        ],
      });
      continue;
    }

    const inference = correlationInference(r, n, options.confidence);
    const rho = spearman(pairs);
    if (rho !== null && Math.abs(rho - r) > 0.15) {
      notes.push(
        `The rank correlation (${rho.toFixed(2)}) differs noticeably from the linear one (${r.toFixed(2)}), which usually means the relationship is not a straight line or a few extreme cases are pulling it. Look at the scatter before quoting either figure.`,
      );
    }

    const sdRestricted = sd(hireScores);
    const sdUnrestricted =
      predictor.applicantValues.length >= MIN_N_UNRESTRICTED
        ? sd(predictor.applicantValues)
        : null;

    let rRangeCorrected: number | null = null;
    if (options.correctRangeRestriction) {
      if (sdUnrestricted === null) {
        notes.push(
          `Fewer than ${MIN_N_UNRESTRICTED} applicant scores are available for this dimension, so the applicant-pool spread could not be measured and no range-restriction correction was applied.`,
        );
      } else if (Number.isFinite(sdRestricted) && sdUnrestricted > 0) {
        const u = sdRestricted / sdUnrestricted;
        rRangeCorrected = thorndikeCaseII(r, u);
        if (rRangeCorrected === null) {
          notes.push(
            `Hires vary as much as applicants on this dimension (spread ratio ${u.toFixed(2)}), so there is no range restriction to correct for. Selection was not using this dimension.`,
          );
        }
      }
    }

    let rFullyCorrected: number | null = null;
    if (reliabilityUsed !== null) {
      rFullyCorrected = correctForCriterionUnreliability(
        rRangeCorrected ?? r,
        reliabilityUsed,
      );
    }

    working.push({
      key: predictor.key,
      label: predictor.label,
      construct: predictor.construct,
      compositeKey: predictor.compositeKey,
      n,
      r,
      rSpearman: rho,
      ciLow: inference.ciLow,
      ciHigh: inference.ciHigh,
      pValue: inference.pValue,
      rRangeCorrected,
      rFullyCorrected,
      sdRestricted: Number.isFinite(sdRestricted) ? sdRestricted : null,
      sdUnrestricted,
      predictorMean: mean(hireScores),
      notes,
    });
  }

  // ---- Multiple comparisons --------------------------------------------------
  // Only predictors that produced a p value enter the adjustment; including
  // the ones that failed would dilute the correction and make the survivors
  // look better than they are.
  const testable = working.filter((w) => Number.isFinite(w.pValue));
  const adjusted = benjaminiHochberg(testable.map((w) => w.pValue));
  testable.forEach((w, i) => {
    w.qValue = adjusted[i];
  });

  const coefficients: CoefficientResult[] = working.map((w) => {
    const qValue = w.qValue ?? Number.NaN;
    const verdict = Number.isFinite(w.r)
      ? coefficientVerdict({
          n: w.n,
          qValue,
          ciLow: w.ciLow,
          ciHigh: w.ciHigh,
        })
      : "INSUFFICIENT";
    return { ...w, qValue, verdict } as CoefficientResult;
  });

  coefficients.sort((a, b) => {
    const aa = Number.isFinite(a.r) ? Math.abs(a.r) : -1;
    const bb = Number.isFinite(b.r) ? Math.abs(b.r) : -1;
    return bb - aa;
  });

  const n = criterion.values.size;
  if (n < MIN_N_COEFFICIENT) {
    warnings.push(
      `This study covers ${n} hires. Below ${MIN_N_COEFFICIENT} no coefficient is reported at all, because the interval around one would be wider than the range of values it could take. Keep collecting ratings; the study recomputes.`,
    );
  } else if (n < MIN_N_SUPPORTED) {
    warnings.push(
      `This study covers ${n} hires. Every result is labelled preliminary until ${MIN_N_SUPPORTED}. Do not change a benchmark, a cut score, or a hiring practice on the strength of it.`,
    );
  }

  if (criterion.dichotomous) {
    warnings.push(
      "The criterion is a yes/no outcome, so these are point-biserial correlations. Their size depends partly on how lopsided the split is: with 90% of hires retained, the ceiling on the coefficient is well below 1 no matter how well the assessment predicts.",
    );
  }

  return {
    n,
    criterionDescription: criterion.description,
    criterionDichotomous: criterion.dichotomous,
    criterionReliability: icc,
    reliabilityUsed,
    coefficients,
    excluded: criterion.excluded,
    warnings,
    anySupported: coefficients.some((c) => c.verdict === "SUPPORTED"),
    computedAt: new Date(),
  };
}
