import { describe, expect, it } from "vitest";
import { classifyAgainstRange, rangeDeviation } from "@/lib/scoring/benchmark";
import {
  evaluateConcernRules,
  selectDevelopmentDimensions,
  selectInterviewDimensions,
  type DimensionOutcome,
} from "@/lib/report/selection";
import type { BenchmarkRange } from "@/lib/scoring/types";
import type { Construct } from "@/content/types";

function outcome(
  construct: Construct,
  band: number,
  min: number,
  max: number,
  weight = 1,
): DimensionOutcome {
  const benchmark: BenchmarkRange = {
    construct,
    minScore: min,
    maxScore: max,
    required: true,
    enabled: true,
    weight,
  };
  return {
    construct,
    band,
    position: classifyAgainstRange(band, benchmark),
    deviation: rangeDeviation(band, benchmark),
    benchmark,
  };
}

describe("benchmark classification", () => {
  it("classifies below/within/above", () => {
    const range = { minScore: 5, maxScore: 7 };
    expect(classifyAgainstRange(4, range)).toBe("BELOW");
    expect(classifyAgainstRange(5, range)).toBe("WITHIN");
    expect(classifyAgainstRange(7, range)).toBe("WITHIN");
    expect(classifyAgainstRange(8, range)).toBe("ABOVE");
  });
  it("measures deviation in bands", () => {
    const range = { minScore: 5, maxScore: 7 };
    expect(rangeDeviation(2, range)).toBe(3);
    expect(rangeDeviation(6, range)).toBe(0);
    expect(rangeDeviation(9, range)).toBe(2);
  });
});

describe("report-selection rules (spec §32 scenario, implemented generically)", () => {
  // Mental Acuity 9 vs 5-7, Organization 3 vs 5-9, Mental Toughness 2 vs 3-6.
  const outcomes: DimensionOutcome[] = [
    outcome("MENTAL_ACUITY", 9, 5, 7),
    outcome("ORGANIZATION", 3, 5, 9),
    outcome("MENTAL_TOUGHNESS", 2, 3, 6),
    outcome("ENERGY", 6, 5, 7),
    outcome("COMMUNICATION", 6, 5, 7),
  ];

  it("selects the deviating dimensions for interview follow-up", () => {
    const selected = selectInterviewDimensions(outcomes, []);
    const constructs = selected.map((s) => s.construct);
    expect(constructs).toContain("ORGANIZATION");
    expect(constructs).toContain("MENTAL_TOUGHNESS");
    expect(constructs).toContain("MENTAL_ACUITY"); // above-range: role challenge
    expect(selected.length).toBeLessThanOrEqual(4);
    expect(selected.length).toBeGreaterThanOrEqual(2);
    const acuity = selected.find((s) => s.construct === "MENTAL_ACUITY")!;
    expect(acuity.focus).toBe("ABOVE_RANGE");
  });

  it("prioritizes below-range deviations over equal above-range ones", () => {
    const selected = selectInterviewDimensions(outcomes, []);
    const org = selected.find((s) => s.construct === "ORGANIZATION")!;
    const acuity = selected.find((s) => s.construct === "MENTAL_ACUITY")!;
    expect(org.priority).toBeGreaterThan(acuity.priority);
  });

  it("adds validity follow-up when indicators are elevated", () => {
    const selected = selectInterviewDimensions(outcomes, [
      { construct: "DISTORTION", level: "HIGH" },
    ]);
    expect(selected.some((s) => s.focus === "VALIDITY")).toBe(true);
  });

  it("still returns at least two useful probes when nothing deviates", () => {
    const inRange = [
      outcome("ENERGY", 6, 5, 7),
      outcome("COMMUNICATION", 5, 5, 7),
      outcome("ORGANIZATION", 7, 5, 9),
    ];
    const selected = selectInterviewDimensions(inRange, []);
    expect(selected.length).toBeGreaterThanOrEqual(2);
  });

  it("focuses development on below-range dimensions, never on 'too much' aptitude", () => {
    const dev = selectDevelopmentDimensions(outcomes);
    const constructs = dev.map((d) => d.construct);
    expect(constructs).toContain("ORGANIZATION");
    expect(constructs).toContain("MENTAL_TOUGHNESS");
    expect(constructs).not.toContain("MENTAL_ACUITY");
    // Organization (deviation 2) ranks above Mental Toughness (deviation 1).
    expect(constructs[0]).toBe("ORGANIZATION");
  });
});

describe("areas-of-concern rules", () => {
  it("flags configured low bands as interview attention, never failure", () => {
    const flagged = evaluateConcernRules(
      [
        { construct: "MENTAL_TOUGHNESS", maxBand: 2, label: "Additional Interview Attention Recommended", enabled: true },
        { construct: "ENERGY", maxBand: 2, label: "Additional Interview Attention Recommended", enabled: true },
        { construct: "FLEXIBILITY", maxBand: 2, label: "x", enabled: false },
      ],
      { MENTAL_TOUGHNESS: 2, ENERGY: 6, FLEXIBILITY: 1 },
    );
    expect(flagged).toHaveLength(1);
    expect(flagged[0].construct).toBe("MENTAL_TOUGHNESS");
    expect(flagged[0].label).toMatch(/Interview Attention/);
  });
});
