/**
 * Statistics for criterion validity work.
 *
 * Everything here is a pure function over arrays of numbers, implemented
 * from the published mathematics rather than lifted from any library or
 * commercial instrument. Each function documents the formula it uses so a
 * reviewing psychometrician can check the arithmetic rather than trust it.
 *
 * Two rules run through this file:
 *
 *  1. Nothing silently discards a caveat. Corrections return the observed
 *     value alongside the corrected one; small samples are flagged, not
 *     rounded away.
 *  2. Nothing here knows what a "good" coefficient is. Verdicts live in
 *     gates.ts, where the thresholds are visible and arguable.
 */

// ---------------------------------------------------------------------------
// Descriptives
// ---------------------------------------------------------------------------

export function mean(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation (n-1). */
export function sd(values: number[]): number {
  if (values.length < 2) return Number.NaN;
  const m = mean(values);
  const ss = values.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return Math.sqrt(ss / (values.length - 1));
}

/**
 * Percentile of a value within a sorted reference distribution, using the
 * midpoint ("mean rank") definition: values equal to the target count half.
 * Returns 0-100.
 */
export function percentileOf(sortedAscending: number[], value: number): number {
  const n = sortedAscending.length;
  if (n === 0) return Number.NaN;
  let below = 0;
  let equal = 0;
  for (const v of sortedAscending) {
    if (v < value) below++;
    else if (v === value) equal++;
    else break;
  }
  return ((below + equal / 2) / n) * 100;
}

/**
 * Value at a given percentile of a sample, by linear interpolation between
 * order statistics (the definition R calls type 7).
 */
export function quantile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const h = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

export interface Pair {
  x: number;
  y: number;
}

/**
 * Pearson product-moment correlation.
 *
 * Returns null when it is undefined: fewer than three usable pairs, or no
 * variance in either variable. A predictor everyone scored identically has
 * no relationship to report, and returning 0 would misrepresent that as
 * evidence of no relationship.
 */
export function pearson(pairs: Pair[]): number | null {
  const usable = pairs.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = usable.length;
  if (n < 3) return null;
  const mx = mean(usable.map((p) => p.x));
  const my = mean(usable.map((p) => p.y));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of usable) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  const r = sxy / Math.sqrt(sxx * syy);
  // Guard against floating-point drift past the theoretical bounds.
  return Math.max(-1, Math.min(1, r));
}

/** Fractional ranks with ties averaged. */
export function rank(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const averaged = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = averaged;
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman rank correlation. Worth reporting next to Pearson when the
 * criterion is a 1-5 rating: if the two disagree sharply, the relationship
 * is not linear and the Pearson value is overstating or understating it.
 */
export function spearman(pairs: Pair[]): number | null {
  const usable = pairs.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (usable.length < 3) return null;
  const rx = rank(usable.map((p) => p.x));
  const ry = rank(usable.map((p) => p.y));
  return pearson(rx.map((x, i) => ({ x, y: ry[i] })));
}

// ---------------------------------------------------------------------------
// Distributions
// ---------------------------------------------------------------------------

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** Log gamma by the Lanczos approximation (g = 7, nine terms). */
export function logGamma(z: number): number {
  if (z < 0.5) {
    // Reflection formula, for arguments the series does not cover.
    return (
      Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z)
    );
  }
  const x = z - 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < LANCZOS.length; i++) a += LANCZOS[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta function (Lentz's method). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const MAX_ITERATIONS = 300;
  const EPS = 1e-15;
  const TINY = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITERATIONS; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) -
      logGamma(a) -
      logGamma(b) +
      a * Math.log(x) +
      b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Two-tailed p for a t statistic: p = I_{df/(df+t^2)}(df/2, 1/2). */
export function studentTTwoTailedP(t: number, df: number): number {
  if (!Number.isFinite(t) || df <= 0) return Number.NaN;
  return incompleteBeta(df / 2, 0.5, df / (df + t * t));
}

/**
 * Inverse standard normal CDF (Acklam's rational approximation, refined by
 * one Halley step against the error function). Accurate to about 1e-15,
 * which is far more than a confidence interval needs.
 */
export function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) return Number.NaN;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  let x: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    q = p - 0.5;
    const r = q * q;
    x =
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  return x;
}

/** Standard normal CDF, via an Abramowitz & Stegun 7.1.26 error function. */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

// ---------------------------------------------------------------------------
// Inference about a correlation
// ---------------------------------------------------------------------------

export const fisherZ = (r: number): number => Math.atanh(Math.max(-0.999999, Math.min(0.999999, r)));
export const inverseFisherZ = (z: number): number => Math.tanh(z);

export interface CorrelationInference {
  r: number;
  n: number;
  ciLow: number;
  ciHigh: number;
  pValue: number;
  /** Half-width of the confidence interval — the honest measure of precision. */
  ciWidth: number;
}

/**
 * Confidence interval via Fisher's z transformation, and a two-tailed p from
 * the exact t test on r with n-2 degrees of freedom.
 *
 * The interval is the number that matters. A coefficient of .31 from 34
 * hires and a coefficient of .31 from 340 are the same number and different
 * evidence, and only the interval says so.
 */
export function correlationInference(
  r: number,
  n: number,
  confidence = 0.95,
): CorrelationInference {
  const z = fisherZ(r);
  const se = n > 3 ? 1 / Math.sqrt(n - 3) : Number.NaN;
  const zCrit = normalQuantile(1 - (1 - confidence) / 2);
  const ciLow = Number.isFinite(se) ? inverseFisherZ(z - zCrit * se) : Number.NaN;
  const ciHigh = Number.isFinite(se) ? inverseFisherZ(z + zCrit * se) : Number.NaN;
  const df = n - 2;
  const denom = 1 - r * r;
  const t = denom > 0 ? r * Math.sqrt(df / denom) : Infinity;
  const pValue = df > 0 ? studentTTwoTailedP(t, df) : Number.NaN;
  return {
    r,
    n,
    ciLow,
    ciHigh,
    pValue,
    ciWidth: (ciHigh - ciLow) / 2,
  };
}

/**
 * Benjamini-Hochberg false discovery rate adjustment.
 *
 * Eighteen dimensions tested against one criterion will hand you one
 * "significant" result at p < .05 by chance alone. Reporting that as a
 * finding is how validity claims get built on noise, so every study here
 * adjusts. Returns adjusted values in the input order.
 */
export function benjaminiHochberg(pValues: number[]): number[] {
  const m = pValues.length;
  if (m === 0) return [];
  const order = pValues
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p - b.p);
  const adjusted = new Array<number>(m);
  let previous = 1;
  for (let k = m - 1; k >= 0; k--) {
    // The adjusted value can never fall below the raw one — the multiplier
    // m/(k+1) is at least 1 — so clamp to it. Without this, the largest p
    // comes back a couple of floating-point units short of itself, and a
    // caller comparing q against p sees an adjustment that went the wrong way.
    const value = Math.max(
      order[k].p,
      Math.min(previous, (order[k].p * m) / (k + 1)),
    );
    adjusted[order[k].i] = Math.min(1, value);
    previous = value;
  }
  return adjusted;
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

/**
 * Thorndike Case II correction for direct range restriction.
 *
 *   R = (r / u) / sqrt(1 - r^2 + r^2 / u^2),  u = SD_restricted / SD_unrestricted
 *
 * The hired sample is not the applicant pool: we hired the people who did
 * well, so the scores among hires vary less than the scores among
 * applicants, and the observed correlation understates the relationship in
 * the population the test is actually used on.
 *
 * This platform is unusual in being able to compute `u` honestly — it holds
 * every applicant's scores, so the unrestricted SD is measured, not assumed.
 * Returns null when u is not usable (>= 1 means no restriction to correct,
 * and correcting anyway would inflate the coefficient for nothing).
 */
export function thorndikeCaseII(r: number, u: number): number | null {
  if (!Number.isFinite(r) || !Number.isFinite(u)) return null;
  if (u <= 0 || u >= 1) return null;
  const numerator = r / u;
  const denominator = Math.sqrt(1 - r * r + (r * r) / (u * u));
  if (denominator === 0) return null;
  const corrected = numerator / denominator;
  return Math.max(-1, Math.min(1, corrected));
}

/**
 * Correct for unreliability in the CRITERION only.
 *
 *   r_corrected = r / sqrt(reliability)
 *
 * Deliberately one-sided. Correcting the predictor too would estimate the
 * validity of a perfectly reliable test that nobody can administer; the test
 * this platform administers is the real one, with its real reliability.
 * Returns null when reliability is not a usable estimate.
 */
export function correctForCriterionUnreliability(
  r: number,
  reliability: number,
): number | null {
  if (!Number.isFinite(r) || !Number.isFinite(reliability)) return null;
  if (reliability <= 0 || reliability > 1) return null;
  const corrected = r / Math.sqrt(reliability);
  return Math.max(-1, Math.min(1, corrected));
}

// ---------------------------------------------------------------------------
// Criterion reliability
// ---------------------------------------------------------------------------

export interface IccResult {
  /** Reliability of a single rater. */
  icc1: number;
  /** Reliability of the mean of `meanRaters` raters (Spearman-Brown stepped up). */
  iccK: number;
  /** Targets that had two or more raters and so contributed. */
  targets: number;
  meanRaters: number;
  /** True when the ANOVA produced a negative estimate, clamped to zero. */
  clampedToZero: boolean;
}

/**
 * One-way random-effects intraclass correlation, ICC(1,1) and ICC(1,k).
 *
 * Each target (one hire) is rated by whichever raters happened to rate it —
 * different raters for different hires, which is exactly the one-way model.
 * Only targets with two or more ratings can contribute; anything less has no
 * within-target variance to estimate.
 *
 * This is the number that makes the attenuation correction honest. Without
 * it, a study either skips the correction or invents a reliability figure,
 * and the second is how corrected coefficients become fiction.
 */
export function oneWayIcc(groups: number[][]): IccResult | null {
  const usable = groups.filter((g) => g.length >= 2);
  const k = usable.length;
  if (k < 2) return null;
  const all = usable.flat();
  const total = all.length;
  const grand = mean(all);

  let ssBetween = 0;
  let ssWithin = 0;
  let sumSquaredSizes = 0;
  for (const g of usable) {
    const gm = mean(g);
    ssBetween += g.length * (gm - grand) ** 2;
    for (const v of g) ssWithin += (v - gm) ** 2;
    sumSquaredSizes += g.length ** 2;
  }
  const dfBetween = k - 1;
  const dfWithin = total - k;
  if (dfWithin <= 0) return null;
  const msBetween = ssBetween / dfBetween;
  const msWithin = ssWithin / dfWithin;

  // Average group size for unbalanced designs (Shrout & Fleiss n-bar).
  const n0 = (total - sumSquaredSizes / total) / dfBetween;

  const rawIcc1 =
    (msBetween - msWithin) / (msBetween + (n0 - 1) * msWithin);
  const clampedToZero = !Number.isFinite(rawIcc1) || rawIcc1 < 0;
  const icc1 = clampedToZero ? 0 : Math.min(1, rawIcc1);
  // Spearman-Brown step-up to the mean of n0 raters.
  const iccK =
    icc1 === 0 ? 0 : Math.min(1, (n0 * icc1) / (1 + (n0 - 1) * icc1));

  return {
    icc1,
    iccK,
    targets: k,
    meanRaters: n0,
    clampedToZero,
  };
}
