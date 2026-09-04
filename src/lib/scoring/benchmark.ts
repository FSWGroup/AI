/** Benchmark comparison: classify a band against a job's desired range. */

import type { BenchmarkRange, RangePosition } from "./types";

export function classifyAgainstRange(
  band: number,
  range: Pick<BenchmarkRange, "minScore" | "maxScore">,
): RangePosition {
  if (band < range.minScore) return "BELOW";
  if (band > range.maxScore) return "ABOVE";
  return "WITHIN";
}

/**
 * How a band compares with the desired range, in the wording every surface
 * uses.
 *
 * The score sheet, the on-screen report and the exported PDF each used to
 * write their own, and the score sheet had already drifted to "Below" and
 * "Above" — so the same candidate read one way on screen and another on
 * paper, which is exactly the disagreement a report is supposed to settle.
 */
export const POSITION_LABEL: Record<RangePosition, string> = {
  WITHIN: "In range",
  BELOW: "Below range",
  ABOVE: "Above range",
};

/** Badge tone for each position, wherever one is shown on screen. */
export const POSITION_TONE: Record<RangePosition, "green" | "amber" | "blue"> = {
  WITHIN: "green",
  BELOW: "amber",
  ABOVE: "blue",
};

/** Distance in bands from the desired range (0 when within). */
export function rangeDeviation(
  band: number,
  range: Pick<BenchmarkRange, "minScore" | "maxScore">,
): number {
  if (band < range.minScore) return range.minScore - band;
  if (band > range.maxScore) return band - range.maxScore;
  return 0;
}
