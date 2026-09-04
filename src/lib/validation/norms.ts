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

import { quantile } from "./stats";
import { percentileFromCurve } from "@/lib/scoring/percentile-curve";
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

  // Coarse raw scales (a 12-item section scores 0-12) can leave a band with
  // no attainable score in it. Saying so is better than pretending there are
  // nine bands when the data supports six.
  //
  // Tested by banding the norming sample and looking for a band nobody landed
  // in, rather than by comparing adjacent cut points for equality. Two
  // DISTINCT cuts can still enclose nothing on a discrete scale — boundaries
  // at 5 and 5.39 admit no integer, and neither did 10 and 10.04 in a
  // measured 250-case binomial sample, where two bands were unreachable and
  // the old test reported no warning at all. The old loop also ran over
  // `thresholds`, which covers bands 1 to 8, so a table where band 9 was
  // unreachable was never examined.
  const bandCounts = new Array<number>(10).fill(0);
  for (const value of sorted) {
    bandCounts[bandFromThresholds(thresholds, value)]++;
  }
  const emptyBands: number[] = [];
  for (let band = 1; band <= 9; band++) {
    if (bandCounts[band] === 0) emptyBands.push(band);
  }
  const hasCollapsedBands = emptyBands.length > 0;
  if (hasCollapsedBands) {
    warnings.push(
      `${emptyBands.length === 1 ? `Band ${emptyBands[0]} contains` : `Bands ${emptyBands.join(", ")} contain`} no attainable score, so ${emptyBands.length === 1 ? "it is" : "they are"} unreachable: this table promises nine bands and delivers ${9 - emptyBands.length}. The raw scale is too coarse for nine bands at this sample size — report the percentile alongside the band, and treat neighbouring bands as one.`,
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

/**
 * The band a raw score falls in, given the cut points.
 *
 * The one place this rule lives on the norm-building side; `bands.ts` runs the
 * identical rule against a stored table on the live scoring path, and the two
 * are checked against each other so a preview can never disagree with what a
 * candidate is actually told.
 *
 * A non-finite score is not banded at all. Falling through the loop returns
 * band 9, so NaN and Infinity used to come back as the TOP band with a
 * percentile of 99 — a fail-open in exactly the wrong direction for a report
 * that then reads "very high".
 */
export function bandFromThresholds(
  thresholds: NormThreshold[],
  rawScore: number,
): number {
  if (!Number.isFinite(rawScore)) return 0;
  const sorted = [...thresholds].sort((a, b) => a.band - b.band);
  for (const t of sorted) {
    if (rawScore <= t.maxRaw) return t.band;
  }
  return 9;
}

/** Where one raw score sits in a built table, for previewing the effect. */
export function previewBand(
  table: BuiltNormTable,
  rawScore: number,
): { band: number; percentile: number } | null {
  const band = bandFromThresholds(table.thresholds, rawScore);
  if (band === 0) return null;
  return {
    band,
    percentile: percentileFromCurve(table.percentileCurve, rawScore),
  };
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
    // A non-finite raw score is not banded and is not counted. It cannot be
    // shown as "unchanged" or as a move, because it has no band either way.
    if (!next) continue;
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

export { percentileFromCurve };
