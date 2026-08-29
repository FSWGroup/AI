import { describe, expect, it } from "vitest";
import {
  analyzeCategory,
  meetsBenchmark,
  outcomesByCategory,
  previewPool,
  selectionRate,
  type BenchmarkRule,
  type CandidateBands,
} from "@/lib/analytics/impact";

const RULES: BenchmarkRule[] = [
  { construct: "MENTAL_ACUITY", minScore: 5, maxScore: 7, enabled: true, required: true },
  { construct: "ORGANIZATION", minScore: 5, maxScore: 9, enabled: true, required: true },
  { construct: "COMPETITIVENESS", minScore: 3, maxScore: 7, enabled: true, required: false },
  { construct: "VOCABULARY", minScore: 6, maxScore: 8, enabled: false, required: true },
];

function candidate(
  id: string,
  bands: Record<string, number>,
  demographics?: Record<string, string>,
): CandidateBands {
  return { attemptId: id, bands, demographics };
}

describe("benchmark matching", () => {
  it("passes when every required dimension is in range", () => {
    expect(
      meetsBenchmark(candidate("a", { MENTAL_ACUITY: 6, ORGANIZATION: 7 }), RULES),
    ).toBe(true);
  });

  it("fails when a required dimension is below range", () => {
    expect(
      meetsBenchmark(candidate("b", { MENTAL_ACUITY: 3, ORGANIZATION: 7 }), RULES),
    ).toBe(false);
  });

  it("fails when a required dimension is ABOVE range (above is not better)", () => {
    expect(
      meetsBenchmark(candidate("c", { MENTAL_ACUITY: 9, ORGANIZATION: 7 }), RULES),
    ).toBe(false);
  });

  it("ignores optional and disabled dimensions", () => {
    // Competitiveness far outside its optional range; Vocabulary disabled.
    expect(
      meetsBenchmark(
        candidate("d", { MENTAL_ACUITY: 6, ORGANIZATION: 7, COMPETITIVENESS: 9, VOCABULARY: 1 }),
        RULES,
      ),
    ).toBe(true);
  });

  it("fails when a required dimension has no score at all", () => {
    expect(meetsBenchmark(candidate("e", { MENTAL_ACUITY: 6 }), RULES)).toBe(false);
  });

  it("passes everyone when nothing is required", () => {
    expect(meetsBenchmark(candidate("f", {}), [])).toBe(true);
  });
});

describe("pool preview", () => {
  const pool = [
    candidate("1", { MENTAL_ACUITY: 6, ORGANIZATION: 7 }), // pass
    candidate("2", { MENTAL_ACUITY: 6, ORGANIZATION: 6 }), // pass
    candidate("3", { MENTAL_ACUITY: 9, ORGANIZATION: 7 }), // fails acuity (above)
    candidate("4", { MENTAL_ACUITY: 6, ORGANIZATION: 3 }), // fails organization
    candidate("5", { MENTAL_ACUITY: 2, ORGANIZATION: 2 }), // fails both
  ];

  it("counts who would qualify", () => {
    const p = previewPool(pool, RULES);
    expect(p.total).toBe(5);
    expect(p.passing).toBe(2);
    expect(p.passRate).toBeCloseTo(0.4);
  });

  it("names the dimensions doing the screening", () => {
    const p = previewPool(pool, RULES);
    const byConstruct = Object.fromEntries(
      p.limitingFactors.map((f) => [f.construct, f.excluded]),
    );
    expect(byConstruct.ORGANIZATION).toBe(2);
    expect(byConstruct.MENTAL_ACUITY).toBe(2);
  });

  it("handles an empty pool without dividing by zero", () => {
    expect(previewPool([], RULES).passRate).toBeNull();
  });
});

describe("four-fifths analysis", () => {
  it("computes selection rates", () => {
    expect(selectionRate({ group: "x", applicants: 20, selected: 10 })).toBe(0.5);
    expect(selectionRate({ group: "x", applicants: 0, selected: 0 })).toBeNull();
  });

  it("flags a group below four-fifths of the reference rate", () => {
    const r = analyzeCategory("sex", [
      { group: "Male", applicants: 50, selected: 25 }, // 50% — reference
      { group: "Female", applicants: 50, selected: 15 }, // 30% → ratio 0.6
    ]);
    expect(r.flagged).toBe(true);
    const female = r.groups.find((g) => g.group === "Female")!;
    expect(female.impactRatio).toBeCloseTo(0.6);
    expect(female.status).toBe("BELOW_FOUR_FIFTHS");
    expect(r.groups.find((g) => g.group === "Male")!.status).toBe("REFERENCE");
  });

  it("does not flag when every ratio clears the threshold", () => {
    const r = analyzeCategory("sex", [
      { group: "Male", applicants: 50, selected: 25 }, // 50%
      { group: "Female", applicants: 50, selected: 22 }, // 44% → 0.88
    ]);
    expect(r.flagged).toBe(false);
  });

  it("refuses to give a ratio for a group under the minimum size", () => {
    const r = analyzeCategory("race", [
      { group: "White", applicants: 60, selected: 30 },
      { group: "Asian", applicants: 3, selected: 0 }, // 0% but n=3
    ]);
    const small = r.groups.find((g) => g.group === "Asian")!;
    expect(small.status).toBe("INSUFFICIENT_DATA");
    expect(small.impactRatio).toBeNull();
    expect(r.flagged).toBe(false); // a 3-person group must not raise an alarm
    expect(r.notes.join(" ")).toMatch(/fewer than/);
  });

  it("marks a small overall sample as preliminary", () => {
    const r = analyzeCategory("sex", [
      { group: "Male", applicants: 6, selected: 3 },
      { group: "Female", applicants: 6, selected: 1 },
    ]);
    expect(r.preliminary).toBe(true);
    expect(r.notes.join(" ")).toMatch(/preliminary/i);
  });

  it("handles nobody being selected without producing NaN", () => {
    const r = analyzeCategory("sex", [
      { group: "Male", applicants: 40, selected: 0 },
      { group: "Female", applicants: 40, selected: 0 },
    ]);
    expect(r.flagged).toBe(false);
    expect(r.groups.every((g) => g.impactRatio === null || g.impactRatio === 1)).toBe(true);
  });
});

describe("grouping assessed candidates", () => {
  const pool = [
    candidate("1", { MENTAL_ACUITY: 6, ORGANIZATION: 7 }, { sex: "Male" }),
    candidate("2", { MENTAL_ACUITY: 2, ORGANIZATION: 2 }, { sex: "Male" }),
    candidate("3", { MENTAL_ACUITY: 6, ORGANIZATION: 6 }, { sex: "Female" }),
    candidate("4", { MENTAL_ACUITY: 6, ORGANIZATION: 6 }, { sex: "DECLINE" }),
    candidate("5", { MENTAL_ACUITY: 6, ORGANIZATION: 6 }),
  ];

  it("counts applicants and selections per group", () => {
    const out = outcomesByCategory(pool, RULES, "sex");
    expect(out.find((o) => o.group === "Male")).toEqual({
      group: "Male",
      applicants: 2,
      selected: 1,
    });
    expect(out.find((o) => o.group === "Female")).toEqual({
      group: "Female",
      applicants: 1,
      selected: 1,
    });
  });

  it("excludes declined and missing self-identification", () => {
    const out = outcomesByCategory(pool, RULES, "sex");
    expect(out.some((o) => o.group === "DECLINE")).toBe(false);
    expect(out.reduce((n, o) => n + o.applicants, 0)).toBe(3);
  });
});
