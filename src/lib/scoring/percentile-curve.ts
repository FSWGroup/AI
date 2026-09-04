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
 *
 * MIDPOINT CONVENTION on ties, matching `percentileOf` in the statistics
 * library ("percent below, plus half of the percent equal"). A coarse raw
 * scale puts several whole percentiles on one raw value, and the two
 * functions disagreeing would mean the same candidate got a different
 * percentile depending on which one the caller happened to reach for. The
 * previous code interpolated up to the FIRST point of a tie block, i.e. the
 * "percent strictly below" convention — 23 where this now returns 35 — and
 * carried a comment claiming it took the higher, which it also did not: that
 * branch was unreachable.
 */
export function percentileFromCurve(
  curve: PercentilePoint[],
  rawScore: number,
): number {
  if (curve.length === 0) return Number.NaN;
  if (!Number.isFinite(rawScore)) return Number.NaN;

  // Collapse ties to one point per raw value, at the middle of the block.
  const byRaw = new Map<number, number[]>();
  for (const point of curve) {
    const list = byRaw.get(point.raw);
    if (list) list.push(point.percentile);
    else byRaw.set(point.raw, [point.percentile]);
  }
  const sorted = [...byRaw.entries()]
    .map(([raw, percentiles]) => ({
      raw,
      percentile: percentiles.reduce((a, b) => a + b, 0) / percentiles.length,
    }))
    .sort((a, b) => a.raw - b.raw);

  if (rawScore <= sorted[0].raw) return sorted[0].percentile;
  const last = sorted[sorted.length - 1];
  if (rawScore >= last.raw) return last.percentile;
  for (let i = 1; i < sorted.length; i++) {
    if (rawScore <= sorted[i].raw) {
      const lo = sorted[i - 1];
      const hi = sorted[i];
      const t = (rawScore - lo.raw) / (hi.raw - lo.raw);
      return lo.percentile + t * (hi.percentile - lo.percentile);
    }
  }
  return last.percentile;
}
