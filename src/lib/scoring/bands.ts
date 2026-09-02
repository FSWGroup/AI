/**
 * 1-9 band conversion.
 *
 * Two distinct modes, deliberately kept apart:
 *
 *  PROVISIONAL — an internal 1-9 band derived from the 0-100 scaled score
 *  using the transparent threshold table below. Used until FSW installs a
 *  legitimate norm table built from actual calibration data. Reports label
 *  these "Provisional 1-9 band", never "stanine".
 *
 *  STANINE — allowed only when a NormTable row exists for the construct
 *  (population, sample size, methodology, effective date recorded). Raw
 *  scores are mapped through the table's thresholds.
 */

import type { BandResult, NormTableData } from "./types";
import { percentileFromCurve } from "@/lib/validation/norms";

/**
 * Provisional band thresholds over the 0-100 scaled score.
 * Band n applies when scaled < maxExclusive (last band catches 100).
 * Intentionally simple and documented — NOT a claim of normality.
 */
export const PROVISIONAL_BAND_THRESHOLDS: { band: number; maxExclusive: number }[] = [
  { band: 1, maxExclusive: 15 },
  { band: 2, maxExclusive: 27.5 },
  { band: 3, maxExclusive: 40 },
  { band: 4, maxExclusive: 50 },
  { band: 5, maxExclusive: 60 },
  { band: 6, maxExclusive: 70 },
  { band: 7, maxExclusive: 80 },
  { band: 8, maxExclusive: 90 },
  { band: 9, maxExclusive: Infinity },
];

export const BAND_LABELS: Record<number, string> = {
  1: "Very low",
  2: "Low",
  3: "Below average",
  4: "Low average",
  5: "Average",
  6: "High average",
  7: "Above average",
  8: "High",
  9: "Very high",
};

export function provisionalBand(scaledScore: number): BandResult {
  const clamped = Math.max(0, Math.min(100, scaledScore));
  for (const t of PROVISIONAL_BAND_THRESHOLDS) {
    if (clamped < t.maxExclusive) {
      return { band: t.band, bandType: "PROVISIONAL" };
    }
  }
  return { band: 9, bandType: "PROVISIONAL" };
}

/** Convert a raw score through a validated norm table into a stanine. */
export function stanineFromNormTable(
  rawScore: number,
  table: NormTableData,
): BandResult {
  // Prefer the norming sample's own raw-to-percentile curve. Without it the
  // only percentile available is the midpoint of the band, which would
  // report everyone in band 5 as exactly the 50th percentile.
  const curved = table.percentileCurve?.length
    ? percentileFromCurve(table.percentileCurve, rawScore)
    : undefined;
  const sorted = [...table.thresholds].sort((a, b) => a.band - b.band);
  for (const t of sorted) {
    if (rawScore <= t.maxRaw) {
      return {
        band: t.band,
        bandType: "STANINE",
        percentile: curved ?? t.percentile,
        normTableId: table.id,
      };
    }
  }
  return {
    band: 9,
    bandType: "STANINE",
    percentile: curved,
    normTableId: table.id,
  };
}

/**
 * Band a construct score: use the norm table when one exists (STANINE),
 * otherwise the provisional conversion. Raw and scaled scores are always
 * preserved by callers; banding never destroys them.
 */
export function bandScore(
  rawScore: number,
  scaledScore: number,
  normTable: NormTableData | null | undefined,
): BandResult {
  if (normTable) return stanineFromNormTable(rawScore, normTable);
  return provisionalBand(scaledScore);
}

export function clampBand(value: number): number {
  return Math.max(1, Math.min(9, Math.round(value)));
}
