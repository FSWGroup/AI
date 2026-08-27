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

/** Distance in bands from the desired range (0 when within). */
export function rangeDeviation(
  band: number,
  range: Pick<BenchmarkRange, "minScore" | "maxScore">,
): number {
  if (band < range.minScore) return range.minScore - band;
  if (band > range.maxScore) return band - range.maxScore;
  return 0;
}
