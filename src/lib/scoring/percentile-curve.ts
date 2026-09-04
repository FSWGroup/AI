/**
 * Reading a percentile off a norm table's stored curve.
 *
 * Lives in the scoring layer rather than with the code that BUILDS norm
 * tables, because banding an attempt is the lower layer and must not depend
 * on the validation module. It used to import this from there, which dragged
 * the whole statistics library — log-gamma, incomplete beta, the lot — into
 * the candidate assessment path, where none of it is used.
 */

export interface PercentilePoint {
  raw: number;
  percentile: number;
}

/**
 * Linear interpolation along a raw-to-percentile curve.
 *
 * Off either end the curve is clamped rather than extrapolated: a raw score
 * above anything in the norming sample is at the top of it, and inventing a
 * 104th percentile would be worse than saying 99.
 */
export function percentileFromCurve(
  curve: PercentilePoint[],
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
      // A flat step in the curve — several percentiles on one raw value,
      // which happens on any coarse scale. Take the higher.
      if (hi.raw === lo.raw) return hi.percentile;
      const t = (rawScore - lo.raw) / (hi.raw - lo.raw);
      return lo.percentile + t * (hi.percentile - lo.percentile);
    }
  }
  return last.percentile;
}
