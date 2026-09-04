import { describe, expect, it } from "vitest";
import {
  benjaminiHochberg,
  correctForCriterionUnreliability,
  correlationInference,
  incompleteBeta,
  logGamma,
  mean,
  normalQuantile,
  oneWayIcc,
  pearson,
  percentileOf,
  quantile,
  rank,
  sd,
  spearman,
  studentTTwoTailedP,
  thorndikeCaseII,
} from "@/lib/validation/stats";

describe("descriptives", () => {
  it("computes the sample standard deviation with n-1", () => {
    // Mean 5, deviations -3, -1, -1, 1, 4. SS = 28, divided by n-1 = 7.
    expect(sd([2, 4, 4, 6, 9])).toBeCloseTo(Math.sqrt(7), 10);
    expect(mean([2, 4, 4, 6, 9])).toBe(5);
  });

  it("returns NaN rather than zero for a single observation", () => {
    // One person has no spread; reporting 0 would let a range-restriction
    // ratio of 0 through and produce a nonsense correction.
    expect(sd([4])).toBeNaN();
  });

  it("counts ties at the midpoint when computing a percentile", () => {
    // One value below, three equal: (1 + 1.5) / 5.
    expect(percentileOf([1, 2, 2, 2, 5], 2)).toBe(50);
    expect(percentileOf([1, 2, 3, 4], 0)).toBe(0);
  });

  it("interpolates quantiles between order statistics", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([10, 20, 30, 40, 50], 0.25)).toBe(20);
  });
});

describe("pearson", () => {
  it("returns 1 for a perfect positive linear relationship", () => {
    const pairs = [1, 2, 3, 4, 5].map((x) => ({ x, y: 3 * x + 2 }));
    expect(pearson(pairs)).toBeCloseTo(1, 12);
  });

  it("matches a hand-computed value", () => {
    // x = 1..5, y = 2,4,5,4,5. Sxy = 6, Sxx = 10, Syy = 6.
    const pairs = [
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 5 },
      { x: 4, y: 4 },
      { x: 5, y: 5 },
    ];
    expect(pearson(pairs)).toBeCloseTo(6 / Math.sqrt(10 * 6), 10);
  });

  it("returns null when a variable has no variance", () => {
    // Everyone scored the same. There is no relationship to report, and
    // reporting 0 would read as evidence the dimension does not predict.
    const pairs = [1, 2, 3, 4].map((y) => ({ x: 7, y }));
    expect(pearson(pairs)).toBeNull();
  });

  it("returns null below three pairs", () => {
    expect(pearson([{ x: 1, y: 2 }, { x: 2, y: 3 }])).toBeNull();
  });

  it("ignores pairs with a missing value", () => {
    const pairs = [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
      { x: Number.NaN, y: 99 },
    ];
    expect(pearson(pairs)).toBeCloseTo(1, 10);
  });
});

describe("rank and spearman", () => {
  it("averages tied ranks", () => {
    expect(rank([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });

  it("is 1 for a monotone but curved relationship that pearson understates", () => {
    const xs = [1, 2, 3, 4, 5, 6];
    const pairs = xs.map((x) => ({ x, y: Math.exp(x) }));
    expect(spearman(pairs)).toBeCloseTo(1, 10);
    expect(pearson(pairs)!).toBeLessThan(0.95);
  });
});

describe("distribution functions", () => {
  it("computes log gamma against known factorials", () => {
    expect(Math.exp(logGamma(5))).toBeCloseTo(24, 8); // 4!
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 10);
  });

  it("computes the regularized incomplete beta symmetrically", () => {
    expect(incompleteBeta(2, 3, 0.5)).toBeCloseTo(0.6875, 10);
    expect(incompleteBeta(3, 2, 0.5)).toBeCloseTo(0.3125, 10);
    expect(incompleteBeta(1, 1, 0.37)).toBeCloseTo(0.37, 10);
  });

  it("gives two-tailed t probabilities matching published tables", () => {
    // t(.975, 20) = 2.085963; t(.975, 1) = 12.706205.
    expect(studentTTwoTailedP(2.085963, 20)).toBeCloseTo(0.05, 6);
    expect(studentTTwoTailedP(12.706205, 1)).toBeCloseTo(0.05, 6);
    expect(studentTTwoTailedP(0, 10)).toBeCloseTo(1, 10);
  });

  it("inverts the normal CDF at the usual critical values", () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 10);
    expect(normalQuantile(0.995)).toBeCloseTo(2.575829, 5);
  });
});

describe("correlationInference", () => {
  it("produces a Fisher interval matching the hand computation", () => {
    // r = .30, n = 100. z = .30952, se = 1/sqrt(97) = .101535.
    const out = correlationInference(0.3, 100);
    expect(out.ciLow).toBeCloseTo(Math.tanh(0.309520 - 1.959964 * 0.101535), 5);
    expect(out.ciHigh).toBeCloseTo(Math.tanh(0.309520 + 1.959964 * 0.101535), 5);
    expect(out.pValue).toBeLessThan(0.01);
  });

  it("widens the interval sharply as the sample shrinks", () => {
    const big = correlationInference(0.31, 340);
    const small = correlationInference(0.31, 34);
    expect(small.ciWidth).toBeGreaterThan(big.ciWidth * 2.5);
    // The same coefficient; only one of them is evidence.
    expect(small.ciLow).toBeLessThan(0);
    expect(big.ciLow).toBeGreaterThan(0);
  });

  it("returns NaN bounds when n is too small for the transform", () => {
    expect(correlationInference(0.5, 3).ciLow).toBeNaN();
  });
});

describe("benjaminiHochberg", () => {
  it("leaves a single p value alone", () => {
    expect(benjaminiHochberg([0.04])[0]).toBeCloseTo(0.04, 12);
  });

  it("adjusts a family the way the published procedure does", () => {
    const p = [0.01, 0.02, 0.03, 0.04, 0.05];
    const q = benjaminiHochberg(p);
    expect(q[0]).toBeCloseTo(0.05, 10);
    expect(q[1]).toBeCloseTo(0.05, 10);
    expect(q[4]).toBeCloseTo(0.05, 10);
  });

  it("keeps the adjusted values monotone and preserves input order", () => {
    const p = [0.9, 0.001, 0.5, 0.02];
    const q = benjaminiHochberg(p);
    expect(q[1]).toBeLessThan(q[3]);
    expect(q[3]).toBeLessThan(q[2]);
    expect(q[2]).toBeLessThanOrEqual(q[0]);
    expect(Math.max(...q)).toBeLessThanOrEqual(1);
  });

  it("stops a lone chance finding among eighteen dimensions", () => {
    // One p at .04 and seventeen nulls: exactly the pattern that manufactures
    // a validity claim if you read raw p values.
    const p = [0.04, ...Array.from({ length: 17 }, (_, i) => 0.3 + i * 0.03)];
    const q = benjaminiHochberg(p);
    expect(q[0]).toBeGreaterThan(0.05);
  });
});

describe("corrections", () => {
  it("applies the Thorndike Case II formula", () => {
    // r = .30, u = .80 -> .3659 by hand.
    expect(thorndikeCaseII(0.3, 0.8)).toBeCloseTo(0.36586, 4);
  });

  it("declines to correct when there is no restriction", () => {
    expect(thorndikeCaseII(0.3, 1)).toBeNull();
    expect(thorndikeCaseII(0.3, 1.2)).toBeNull();
    expect(thorndikeCaseII(0.3, 0)).toBeNull();
  });

  it("corrects more strongly the more severe the restriction", () => {
    const mild = thorndikeCaseII(0.25, 0.9)!;
    const severe = thorndikeCaseII(0.25, 0.5)!;
    expect(severe).toBeGreaterThan(mild);
    expect(severe).toBeLessThanOrEqual(1);
  });

  it("divides by the square root of criterion reliability", () => {
    expect(correctForCriterionUnreliability(0.4, 0.64)).toBeCloseTo(0.5, 10);
  });

  it("refuses an out-of-range reliability", () => {
    expect(correctForCriterionUnreliability(0.4, 0)).toBeNull();
    expect(correctForCriterionUnreliability(0.4, 1.4)).toBeNull();
  });
});

describe("oneWayIcc", () => {
  it("returns near 1 when raters agree exactly", () => {
    const groups = [
      [5, 5],
      [4, 4],
      [3, 3],
      [2, 2],
      [1, 1],
    ];
    const icc = oneWayIcc(groups)!;
    expect(icc.icc1).toBeCloseTo(1, 8);
    expect(icc.targets).toBe(5);
    expect(icc.meanRaters).toBeCloseTo(2, 8);
  });

  it("clamps to zero when raters disagree more than hires differ", () => {
    const groups = [
      [1, 5],
      [5, 1],
      [1, 5],
      [5, 1],
    ];
    const icc = oneWayIcc(groups)!;
    expect(icc.icc1).toBe(0);
    expect(icc.clampedToZero).toBe(true);
  });

  it("steps up to the reliability of the averaged rating", () => {
    const groups = [
      [5, 4],
      [4, 3],
      [3, 3],
      [2, 1],
      [1, 2],
      [5, 5],
    ];
    const icc = oneWayIcc(groups)!;
    expect(icc.iccK).toBeGreaterThan(icc.icc1);
    expect(icc.iccK).toBeLessThanOrEqual(1);
  });

  it("handles unbalanced rater counts", () => {
    const groups = [[5, 4, 5], [3, 3], [1, 2, 1, 1], [4, 4]];
    const icc = oneWayIcc(groups)!;
    expect(icc.meanRaters).toBeGreaterThan(2);
    expect(icc.meanRaters).toBeLessThan(3);
    expect(icc.icc1).toBeGreaterThan(0.5);
  });

  it("returns null when nothing has two raters", () => {
    expect(oneWayIcc([[5], [4], [3]])).toBeNull();
  });
});

describe("oneWayIcc edge cases", () => {
  it("drops a non-finite rating instead of reporting reliability zero", () => {
    const clean = oneWayIcc([[1, 2], [3, 4], [5, 6]])!;
    const dirty = oneWayIcc([[1, 2, NaN], [3, 4], [5, 6]])!;
    expect(dirty.icc1).toBeCloseTo(clean.icc1, 10);
    expect(dirty.clampedToZero).toBe(false);
  });
  it("tells perfect agreement apart from disagreement", () => {
    const flat = oneWayIcc([[3, 3], [3, 3], [3, 3]])!;
    expect(flat.undefinedVariance).toBe(true);
    expect(flat.clampedToZero).toBe(false);
  });
  it("still reports a genuinely negative estimate as clamped", () => {
    const noisy = oneWayIcc([[1, 5], [1, 5], [1, 5], [3, 3]])!;
    expect(noisy.clampedToZero).toBe(true);
    expect(noisy.undefinedVariance).toBe(false);
  });
});

describe("the boundary cases that used to come back as NaN", () => {
  it("gives a perfect correlation a p of 0, not NaN", () => {
    // NaN here made a perfect predictor read as NOT_SUPPORTED, and dropped it
    // from the Benjamini-Hochberg family so every other predictor was
    // under-corrected.
    expect(correlationInference(1, 120).pValue).toBe(0);
    expect(correlationInference(-1, 120).pValue).toBe(0);
    expect(studentTTwoTailedP(Infinity, 118)).toBe(0);
  });

  it("returns log|Gamma| where Gamma is negative", () => {
    expect(logGamma(-0.5)).toBeCloseTo(1.2655121234846454, 10);
    expect(logGamma(-1.5)).toBeCloseTo(0.86004701537648, 10);
  });

  it("refuses an r outside [-1, 1] rather than clamping it into a plausible interval", () => {
    expect(Number.isNaN(correlationInference(2, 30).ciLow)).toBe(true);
  });

  it("refuses a confidence level of 0 or 1", () => {
    expect(() => correlationInference(0.3, 50, 1)).toThrow(RangeError);
    expect(() => correlationInference(0.3, 50, 0)).toThrow(RangeError);
  });
});
