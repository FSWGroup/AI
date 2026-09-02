/**
 * Local norm tables.
 *
 * Until this runs, every band the platform prints is provisional: a 1-9
 * number derived from a documented but arbitrary threshold table, labelled
 * as such on every report. A norm table replaces that with a stanine — a
 * band that means "this many standard deviations from the mean of a real
 * reference group" — and the reference group is named, dated and counted on
 * the table itself.
 *
 * Which reference group is the whole question. The default here is the
 * APPLICANT pool, not the hired one, because the band on a candidate's
 * report is used to compare them with the other people who applied. Norming
 * on hires would compare an applicant against the people who already got
 * through, which makes almost everyone look below average and is a different
 * claim than the report is making.
 */

import { percentileOf, quantile } from "./stats";
import { MIN_N_NORM_ACTIVE, MIN_N_NORM_DRAFT, normGate } from "./gates";

/**
 * Cumulative percentage at the top of each stanine, from the standard
 * normal: 4, 7, 12, 17, 20, 17, 12, 7, 4 percent per band.
 */
export const STANINE_CUMULATIVE = [4, 11, 23, 40, 60, 77, 89, 96];

export interface NormThreshold {
  band: number;
  maxRaw: number;
  /** Midpoint percentile of the band, for display only. */
  percentile: number;
}

export interface BuiltNormTable {
  thresholds: NormThreshold[];
  /**
   * Raw-to-percentile curve at each percentile point, so a person's actual
   * percentile can be read off rather than approximated by their band.
   */
  percentileCurve: { raw: number; percentile: number }[];
  sampleSize: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  /** True when adjacent bands share a boundary because the scores are coarse. */
  hasCollapsedBands: boolean;
  gate: ReturnType<typeof normGate>;
  warnings: string[];
}

function meanOf(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Build stanine cut points from an observed distribution.
 *
 * Cuts land at the sample's own percentiles rather than at z-score points
 * from an assumed normal curve. A raw score distribution that is skewed —
 * and short cognitive sections usually are — would be badly served by cuts
 * placed as if it were not.
 */
export function buildNormTable(values: number[]): BuiltNormTable | null {
  const usable = values.filter((v) => Number.isFinite(v));
  const n = usable.length;
  if (n < MIN_N_NORM_DRAFT) return null;

  const sorted = [...usable].sort((a, b) => a - b);
  const warnings: string[] = [];

  const thresholds: NormThreshold[] = STANINE_CUMULATIVE.map((cum, i) => {
    const band = i + 1;
    const lowerCum = i === 0 ? 0 : STANINE_CUMULATIVE[i - 1];
    return {
      band,
      maxRaw: quantile(sorted, cum / 100),
      percentile: (lowerCum + cum) / 2,
    };
  });

  // Coarse raw scales (a 12-item section scores 0-12) can put two cut points
  // on the same value. Bands then collapse: nobody can land in the band
  // between two identical boundaries. Saying so is better than pretending
  // there are nine bands when the data supports six.
  let hasCollapsedBands = false;
  for (let i = 1; i < thresholds.length; i++) {
    if (thresholds[i].maxRaw <= thresholds[i - 1].maxRaw) {
      hasCollapsedBands = true;
      break;
    }
  }
  if (hasCollapsedBands) {
    warnings.push(
      "Two or more band boundaries fall on the same raw score, so some bands are unreachable. The raw scale is too coarse for nine bands at this sample size — report the percentile alongside the band, and treat neighbouring bands as one.",
    );
  }

  const distinct = new Set(sorted).size;
  if (distinct < 9) {
    warnings.push(
      `The sample contains only ${distinct} distinct raw scores. Nine bands cannot be distinguished on a scale with fewer than nine values.`,
    );
  }

  // A percentile curve at every whole percentile: enough resolution to read a
  // person's standing off without storing the sample itself, which would put
  // other candidates' scores in the norm table.
  const percentileCurve: { raw: number; percentile: number }[] = [];
  for (let p = 1; p <= 99; p++) {
    percentileCurve.push({ raw: quantile(sorted, p / 100), percentile: p });
  }

  const gate = normGate(n);
  if (gate === "DRAFT_ONLY") {
    warnings.push(
      `${n} cases is enough to draft this table but not to use it. It needs ${MIN_N_NORM_ACTIVE} before it can band anyone.`,
    );
  }

  return {
    thresholds,
    percentileCurve,
    sampleSize: n,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: meanOf(sorted),
    median: quantile(sorted, 0.5),
    hasCollapsedBands,
    gate,
    warnings,
  };
}

/** Where one raw score sits in a built table, for previewing the effect. */
export function previewBand(
  table: BuiltNormTable,
  rawScore: number,
): { band: number; percentile: number } {
  const sortedThresholds = [...table.thresholds].sort((a, b) => a.band - b.band);
  for (const t of sortedThresholds) {
    if (rawScore <= t.maxRaw) {
      return {
        band: t.band,
        percentile: percentileFromCurve(table.percentileCurve, rawScore),
      };
    }
  }
  return {
    band: 9,
    percentile: percentileFromCurve(table.percentileCurve, rawScore),
  };
}

/** Linear interpolation along a stored raw-to-percentile curve. */
export function percentileFromCurve(
  curve: { raw: number; percentile: number }[],
  rawScore: number,
): number {
  if (curve.length === 0) return Number.NaN;
  const sorted = [...curve].sort((a, b) => a.raw - b.raw);
  if (rawScore <= sorted[0].raw) return sorted[0].percentile;
  const last = sorted[sorted.length - 1];
  if (rawScore >= last.raw) return last.percentile;
  for (let i = 1; i < sorted.length; i++) {
    if (rawScore <= sorted[i].raw) {
      const lo = sorted[i - 1];
      const hi = sorted[i];
      if (hi.raw === lo.raw) return hi.percentile;
      const t = (rawScore - lo.raw) / (hi.raw - lo.raw);
      return lo.percentile + t * (hi.percentile - lo.percentile);
    }
  }
  return last.percentile;
}

/**
 * How many people would change band if this table were activated.
 *
 * Promotion is not a cosmetic relabelling: a candidate previously reported at
 * band 6 may become a band 4, and anyone holding the old report deserves to
 * know that happened. This is what the confirmation screen shows.
 */
export function bandShiftPreview(
  table: BuiltNormTable,
  current: { rawScore: number; band: number }[],
): { unchanged: number; moved: number; maxShift: number; distribution: number[] } {
  const distribution = new Array<number>(9).fill(0);
  let unchanged = 0;
  let moved = 0;
  let maxShift = 0;
  for (const row of current) {
    const next = previewBand(table, row.rawScore);
    distribution[next.band - 1]++;
    const shift = Math.abs(next.band - row.band);
    if (shift === 0) unchanged++;
    else {
      moved++;
      maxShift = Math.max(maxShift, shift);
    }
  }
  return { unchanged, moved, maxShift, distribution };
}

/** Percentile of a raw score in a raw sample. Used for study descriptives. */
export const rawPercentile = (sample: number[], value: number): number =>
  percentileOf([...sample].sort((a, b) => a - b), value);
