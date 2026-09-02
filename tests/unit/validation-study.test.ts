import { describe, expect, it } from "vitest";
import {
  buildCriterion,
  cyclesDueFor,
  type HireRow,
  type MetricRow,
  type ReviewRow,
} from "@/lib/validation/criterion";
import { computeStudy, type PredictorSeries } from "@/lib/validation/study";
import {
  coefficientVerdict,
  MIN_N_COEFFICIENT,
  MIN_N_SUPPORTED,
  normGate,
} from "@/lib/validation/gates";
import { buildNormTable, bandShiftPreview, previewBand } from "@/lib/validation/norms";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-01T00:00:00Z");

function hire(id: string, daysAgo: number, over: Partial<HireRow> = {}): HireRow {
  return {
    hireId: id,
    hiredAt: new Date(NOW.getTime() - daysAgo * DAY),
    status: "ACTIVE",
    endedAt: null,
    ...over,
  };
}

function review(
  hireId: string,
  raterId: string,
  over: Partial<ReviewRow> = {},
): ReviewRow {
  return {
    hireId,
    cycleId: "c1",
    cycleKind: "DAY_90",
    raterId,
    overallRating: 3,
    wouldRehire: true,
    submittedAt: new Date("2026-06-01T00:00:00Z"),
    ratings: [],
    ...over,
  };
}

describe("buildCriterion — rating criteria", () => {
  it("averages across raters and keeps the per-rater values", () => {
    const hires = [hire("h1", 200), hire("h2", 200)];
    const reviews = [
      review("h1", "r1", { overallRating: 4 }),
      review("h1", "r2", { overallRating: 2 }),
      review("h2", "r1", { overallRating: 5 }),
    ];
    const out = buildCriterion(
      { kind: "OVERALL_RATING", keys: [], cycleKinds: [] },
      { hires, reviews, metrics: [] },
      NOW,
    );
    expect(out.values.get("h1")).toBe(3);
    expect(out.raterValues.get("h1")).toEqual([4, 2]);
    expect(out.values.get("h2")).toBe(5);
  });

  it("counts one rater once even when they reviewed the same person twice", () => {
    // Otherwise a rater who filled in the 90-day and the annual form votes
    // twice, inflating both the sample size and the apparent agreement.
    const hires = [hire("h1", 400)];
    const reviews = [
      review("h1", "r1", {
        overallRating: 2,
        cycleKind: "DAY_90",
        submittedAt: new Date("2026-01-01T00:00:00Z"),
      }),
      review("h1", "r1", {
        overallRating: 5,
        cycleId: "c2",
        cycleKind: "ANNUAL",
        submittedAt: new Date("2026-08-01T00:00:00Z"),
      }),
    ];
    const out = buildCriterion(
      { kind: "OVERALL_RATING", keys: [], cycleKinds: [] },
      { hires, reviews, metrics: [] },
      NOW,
    );
    expect(out.values.get("h1")).toBe(5);
    expect(out.raterValues.get("h1")).toEqual([5]);
  });

  it("restricts to the requested cycle kinds", () => {
    const hires = [hire("h1", 400)];
    const reviews = [
      review("h1", "r1", { overallRating: 2, cycleKind: "DAY_90" }),
      review("h1", "r2", { overallRating: 5, cycleId: "c2", cycleKind: "ANNUAL" }),
    ];
    const out = buildCriterion(
      { kind: "OVERALL_RATING", keys: [], cycleKinds: ["ANNUAL"] },
      { hires, reviews, metrics: [] },
      NOW,
    );
    expect(out.values.get("h1")).toBe(5);
  });

  it("excludes a hire with no review and says why", () => {
    const out = buildCriterion(
      { kind: "OVERALL_RATING", keys: [], cycleKinds: [] },
      { hires: [hire("h1", 100), hire("h2", 100)], reviews: [review("h1", "r1")], metrics: [] },
      NOW,
    );
    expect(out.values.has("h2")).toBe(false);
    expect(out.excluded).toEqual([
      { hireId: "h2", reason: "No submitted review covering this criterion." },
    ]);
  });

  it("skips a half-filled composite rather than scoring it on a different scale", () => {
    const spec = {
      kind: "COMPOSITE_RATING" as const,
      keys: ["WORK_QUALITY", "RELIABILITY", "TEAMWORK", "INITIATIVE"],
      cycleKinds: [],
    };
    const reviews = [
      review("h1", "r1", {
        ratings: [{ criterionKey: "WORK_QUALITY", value: 5 }],
      }),
      review("h2", "r1", {
        ratings: [
          { criterionKey: "WORK_QUALITY", value: 5 },
          { criterionKey: "RELIABILITY", value: 3 },
        ],
      }),
    ];
    const out = buildCriterion(
      spec,
      { hires: [hire("h1", 100), hire("h2", 100)], reviews, metrics: [] },
      NOW,
    );
    expect(out.values.has("h1")).toBe(false);
    expect(out.values.get("h2")).toBe(4);
  });
});

describe("buildCriterion — retention", () => {
  it("excludes hires who have not reached the horizon yet", () => {
    const hires = [
      hire("stayed", 500),
      hire("left-early", 500, {
        status: "DEPARTED_VOLUNTARY",
        endedAt: new Date(NOW.getTime() - 400 * DAY),
      }),
      hire("too-recent", 100),
    ];
    const out = buildCriterion(
      { kind: "RETENTION", keys: [], cycleKinds: [], retentionDays: 365 },
      { hires, reviews: [], metrics: [] },
      NOW,
    );
    expect(out.values.get("stayed")).toBe(1);
    expect(out.values.get("left-early")).toBe(0);
    expect(out.values.has("too-recent")).toBe(false);
    expect(out.excluded[0].reason).toContain("365-day horizon");
    expect(out.dichotomous).toBe(true);
  });
});

describe("buildCriterion — metrics", () => {
  const metric = (over: Partial<MetricRow>): MetricRow => ({
    hireId: "h1",
    key: "quota_attainment",
    value: 1.1,
    higherIsBetter: true,
    periodEnd: new Date("2026-06-30T00:00:00Z"),
    ...over,
  });

  it("takes the most recent period", () => {
    const out = buildCriterion(
      { kind: "METRIC", keys: ["quota_attainment"], cycleKinds: [] },
      {
        hires: [hire("h1", 400)],
        reviews: [],
        metrics: [
          metric({ value: 0.7, periodEnd: new Date("2026-03-31T00:00:00Z") }),
          metric({ value: 1.2, periodEnd: new Date("2026-06-30T00:00:00Z") }),
        ],
      },
      NOW,
    );
    expect(out.values.get("h1")).toBe(1.2);
  });

  it("reverses the sign for a lower-is-better metric so positive always means good", () => {
    const out = buildCriterion(
      { kind: "METRIC", keys: ["error_rate"], cycleKinds: [] },
      {
        hires: [hire("h1", 400)],
        reviews: [],
        metrics: [metric({ key: "error_rate", value: 0.08, higherIsBetter: false })],
      },
      NOW,
    );
    expect(out.values.get("h1")).toBeCloseTo(-0.08, 10);
    expect(out.description).toContain("sign reversed");
  });
});

describe("cyclesDueFor", () => {
  const cycles = [
    { id: "d90", dueAfterDays: 90, opensAt: null, closesAt: null, status: "OPEN" },
    { id: "annual", dueAfterDays: 365, opensAt: null, closesAt: null, status: "OPEN" },
    { id: "draft", dueAfterDays: 30, opensAt: null, closesAt: null, status: "DRAFT" },
  ];

  it("returns only cycles the hire has reached", () => {
    expect(cyclesDueFor({ hiredAt: new Date(NOW.getTime() - 100 * DAY), status: "ACTIVE" }, cycles, NOW)).toEqual(["d90"]);
    expect(cyclesDueFor({ hiredAt: new Date(NOW.getTime() - 400 * DAY), status: "ACTIVE" }, cycles, NOW)).toEqual(["d90", "annual"]);
  });

  it("never asks for a review of someone who has left", () => {
    expect(
      cyclesDueFor(
        { hiredAt: new Date(NOW.getTime() - 400 * DAY), status: "DEPARTED_VOLUNTARY" },
        cycles,
        NOW,
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

function series(
  key: string,
  values: Record<string, number>,
  applicantValues: number[],
): PredictorSeries {
  return {
    key,
    label: key,
    hireValues: new Map(Object.entries(values)),
    applicantValues,
  };
}

/** A sample of `n` hires with a predictor that genuinely predicts. */
function realisticSample(n: number, noise: number) {
  const hires: HireRow[] = [];
  const reviews: ReviewRow[] = [];
  const scores: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const id = `h${i}`;
    hires.push(hire(id, 300));
    // Deterministic pseudo-noise: same input, same study, every time.
    const wobble = ((i * 7919) % 100) / 100;
    const score = 20 + (i % 40);
    scores[id] = score;
    const rating = Math.min(5, Math.max(1, 1 + (score - 20) / 12 + (wobble - 0.5) * noise));
    reviews.push(review(id, "r1", { overallRating: rating }));
    reviews.push(review(id, "r2", { overallRating: Math.min(5, Math.max(1, rating + (wobble - 0.5))) }));
  }
  return { hires, reviews, scores };
}

describe("computeStudy", () => {
  it("finds a real relationship and reports an interval that excludes zero", () => {
    const { hires, reviews, scores } = realisticSample(150, 1);
    const criterion = buildCriterion(
      { kind: "OVERALL_RATING", keys: [], cycleKinds: [] },
      { hires, reviews, metrics: [] },
      NOW,
    );
    const applicants = Array.from({ length: 400 }, (_, i) => 5 + (i % 60));
    const result = computeStudy(criterion, [series("MENTAL_ACUITY", scores, applicants)]);

    expect(result.n).toBe(150);
    const c = result.coefficients[0];
    expect(c.r).toBeGreaterThan(0.7);
    expect(c.ciLow).toBeGreaterThan(0);
    expect(c.verdict).toBe("SUPPORTED");
    expect(result.anySupported).toBe(true);
  });

  it("corrects upward for range restriction using the applicant pool's own spread", () => {
    const { hires, reviews, scores } = realisticSample(150, 6);
    const criterion = buildCriterion(
      { kind: "OVERALL_RATING", keys: [], cycleKinds: [] },
      { hires, reviews, metrics: [] },
      NOW,
    );
    // Applicants vary far more widely than the people we hired.
    const applicants = Array.from({ length: 400 }, (_, i) => (i % 100) * 1.5);
    const result = computeStudy(criterion, [series("MENTAL_ACUITY", scores, applicants)]);
    const c = result.coefficients[0];
    expect(c.sdUnrestricted!).toBeGreaterThan(c.sdRestricted!);
    expect(c.rRangeCorrected!).toBeGreaterThan(c.r);
  });

  it("declines the range correction when there are too few applicant scores", () => {
    const { hires, reviews, scores } = realisticSample(120, 2);
    const criterion = buildCriterion(
      { kind: "OVERALL_RATING", keys: [], cycleKinds: [] },
      { hires, reviews, metrics: [] },
      NOW,
    );
    const result = computeStudy(criterion, [series("MENTAL_ACUITY", scores, [1, 2, 3])]);
    expect(result.coefficients[0].rRangeCorrected).toBeNull();
    expect(result.coefficients[0].notes.join(" ")).toContain("applicant-pool spread");
  });

  it("refuses to correct for attenuation when no hire has two raters", () => {
    const { hires, scores } = realisticSample(120, 2);
    const singleRater = hires.map((h, i) =>
      review(h.hireId, "r1", { overallRating: 1 + (i % 5) }),
    );
    const criterion = buildCriterion(
      { kind: "OVERALL_RATING", keys: [], cycleKinds: [] },
      { hires, reviews: singleRater, metrics: [] },
      NOW,
    );
    const result = computeStudy(criterion, [series("MENTAL_ACUITY", scores, [])]);
    expect(result.reliabilityUsed).toBeNull();
    expect(result.coefficients[0].rFullyCorrected).toBeNull();
    expect(result.warnings.join(" ")).toContain("two independent raters");
  });

  it("labels everything preliminary below the supported-sample threshold", () => {
    const { hires, reviews, scores } = realisticSample(40, 1);
    const criterion = buildCriterion(
      { kind: "OVERALL_RATING", keys: [], cycleKinds: [] },
      { hires, reviews, metrics: [] },
      NOW,
    );
    const result = computeStudy(criterion, [series("MENTAL_ACUITY", scores, [])]);
    expect(result.coefficients[0].verdict).toBe("PRELIMINARY");
    expect(result.warnings.join(" ")).toContain("preliminary");
    expect(result.anySupported).toBe(false);
  });

  it("adjusts across the dimensions tested so one chance hit is not a finding", () => {
    const { hires, reviews } = realisticSample(120, 1);
    const criterion = buildCriterion(
      { kind: "OVERALL_RATING", keys: [], cycleKinds: [] },
      { hires, reviews, metrics: [] },
      NOW,
    );
    // Eighteen dimensions of pure noise, deterministic per dimension.
    const predictors = Array.from({ length: 18 }, (_, d) =>
      series(
        `D${d}`,
        Object.fromEntries(hires.map((h, i) => [h.hireId, ((i * (d + 13) * 37) % 101) / 10])),
        [],
      ),
    );
    const result = computeStudy(criterion, predictors);
    for (const c of result.coefficients) {
      expect(c.qValue).toBeGreaterThanOrEqual(c.pValue);
    }
    expect(result.coefficients.every((c) => c.verdict !== "SUPPORTED")).toBe(true);
  });

  it("reports a dimension nobody varied on as uncomputable, not as zero", () => {
    const { hires, reviews } = realisticSample(120, 1);
    const criterion = buildCriterion(
      { kind: "OVERALL_RATING", keys: [], cycleKinds: [] },
      { hires, reviews, metrics: [] },
      NOW,
    );
    const flat = Object.fromEntries(hires.map((h) => [h.hireId, 7]));
    const result = computeStudy(criterion, [series("FLAT", flat, [])]);
    expect(result.coefficients[0].r).toBeNaN();
    expect(result.coefficients[0].verdict).toBe("INSUFFICIENT");
    expect(result.coefficients[0].notes[0]).toContain("scored identically");
  });

  it("warns that a yes/no criterion caps the coefficient", () => {
    const hires = Array.from({ length: 60 }, (_, i) =>
      i % 5 === 0
        ? hire(`h${i}`, 500, {
            status: "DEPARTED_VOLUNTARY",
            endedAt: new Date(NOW.getTime() - 450 * DAY),
          })
        : hire(`h${i}`, 500),
    );
    const criterion = buildCriterion(
      { kind: "RETENTION", keys: [], cycleKinds: [], retentionDays: 365 },
      { hires, reviews: [], metrics: [] },
      NOW,
    );
    const scores = Object.fromEntries(hires.map((h, i) => [h.hireId, 30 + (i % 20)]));
    const result = computeStudy(criterion, [series("MENTAL_ACUITY", scores, [])]);
    expect(result.criterionDichotomous).toBe(true);
    expect(result.warnings.join(" ")).toContain("point-biserial");
  });
});

describe("gates", () => {
  it("names the three sample-size regimes", () => {
    expect(coefficientVerdict({ n: MIN_N_COEFFICIENT - 1, qValue: 0.001, ciLow: 0.2, ciHigh: 0.5 })).toBe("INSUFFICIENT");
    expect(coefficientVerdict({ n: MIN_N_SUPPORTED - 1, qValue: 0.001, ciLow: 0.2, ciHigh: 0.5 })).toBe("PRELIMINARY");
    expect(coefficientVerdict({ n: 300, qValue: 0.001, ciLow: 0.2, ciHigh: 0.5 })).toBe("SUPPORTED");
  });

  it("calls a big clean null what it is", () => {
    expect(coefficientVerdict({ n: 400, qValue: 0.6, ciLow: -0.08, ciHigh: 0.11 })).toBe("NOT_SUPPORTED");
  });

  it("will not call a result supported on a raw p that the adjustment killed", () => {
    expect(coefficientVerdict({ n: 300, qValue: 0.31, ciLow: 0.01, ciHigh: 0.24 })).toBe("NOT_SUPPORTED");
  });

  it("gates norm tables in three steps", () => {
    expect(normGate(80)).toBe("BLOCKED");
    expect(normGate(150)).toBe("DRAFT_ONLY");
    expect(normGate(400)).toBe("ACTIVATABLE");
  });
});

describe("buildNormTable", () => {
  const spread = Array.from({ length: 500 }, (_, i) => (i % 50) + 1);

  it("refuses to build below the minimum sample", () => {
    expect(buildNormTable([1, 2, 3])).toBeNull();
  });

  it("places eight cut points and reports the sample it used", () => {
    const table = buildNormTable(spread)!;
    expect(table.thresholds.map((t) => t.band)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(table.sampleSize).toBe(500);
    expect(table.gate).toBe("ACTIVATABLE");
    for (let i = 1; i < table.thresholds.length; i++) {
      expect(table.thresholds[i].maxRaw).toBeGreaterThanOrEqual(table.thresholds[i - 1].maxRaw);
    }
  });

  it("produces roughly the classic stanine proportions", () => {
    const table = buildNormTable(spread)!;
    const counts = new Array(9).fill(0);
    for (const v of spread) counts[previewBand(table, v).band - 1]++;
    expect(counts[4] / spread.length).toBeGreaterThan(0.15);
    expect(counts[0] / spread.length).toBeLessThan(0.1);
    expect(counts[8] / spread.length).toBeLessThan(0.1);
  });

  it("says so when the raw scale is too coarse for nine bands", () => {
    const coarse = Array.from({ length: 300 }, (_, i) => i % 4);
    const table = buildNormTable(coarse)!;
    expect(table.hasCollapsedBands).toBe(true);
    expect(table.warnings.join(" ")).toContain("unreachable");
  });

  it("keeps a small sample as a draft", () => {
    const table = buildNormTable(spread.slice(0, 120))!;
    expect(table.gate).toBe("DRAFT_ONLY");
    expect(table.warnings.join(" ")).toContain("not to use it");
  });

  it("reads a percentile off the curve rather than the band midpoint", () => {
    const table = buildNormTable(spread)!;
    const low = previewBand(table, 5);
    const mid = previewBand(table, 25);
    const high = previewBand(table, 48);
    expect(low.percentile).toBeLessThan(mid.percentile);
    expect(mid.percentile).toBeLessThan(high.percentile);
    // Two people in the same band do not get the same percentile.
    expect(previewBand(table, 24).percentile).not.toBe(previewBand(table, 26).percentile);
  });

  it("counts how many people would change band before the table is activated", () => {
    const table = buildNormTable(spread)!;
    const current = spread.slice(0, 100).map((v) => ({ rawScore: v, band: 5 }));
    const shift = bandShiftPreview(table, current);
    expect(shift.unchanged + shift.moved).toBe(100);
    expect(shift.moved).toBeGreaterThan(0);
    expect(shift.distribution.reduce((a, b) => a + b, 0)).toBe(100);
  });
});
