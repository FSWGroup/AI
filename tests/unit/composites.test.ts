import { describe, expect, it } from "vitest";
import {
  classifyCompositeBand,
  evaluateComposite,
  overallSalesAlignment,
} from "@/lib/scoring/composites";

describe("composite evaluation", () => {
  it("computes an exact weighted mean of component bands", () => {
    const r = evaluateComposite(
      {
        key: "sales_persistence",
        name: "Persistence and consistency",
        category: "SALES",
        version: "1.0",
        components: [
          { construct: "MENTAL_TOUGHNESS", weight: 1 },
          { construct: "ENERGY", weight: 1 },
          { construct: "FLEXIBILITY", weight: 1 },
        ],
      },
      { MENTAL_TOUGHNESS: 2, ENERGY: 6, FLEXIBILITY: 7 },
    );
    expect(r.value).toBe(5);
    expect(r.band).toBe(5);
    expect(r.detail.components).toHaveLength(3);
  });

  it("respects unequal weights", () => {
    const r = evaluateComposite(
      {
        key: "k",
        name: "n",
        category: "SALES",
        version: "1.0",
        components: [
          { construct: "MENTAL_ACUITY", weight: 3 },
          { construct: "AWARENESS_MEMORY", weight: 1 },
        ],
      },
      { MENTAL_ACUITY: 9, AWARENESS_MEMORY: 5 },
    );
    expect(r.value).toBe(8);
  });

  it("skips missing components and records them", () => {
    const r = evaluateComposite(
      {
        key: "k",
        name: "n",
        category: "LEADERSHIP",
        version: "1.0",
        components: [
          { construct: "ORGANIZATION", weight: 1 },
          { construct: "MENTAL_ACUITY", weight: 1 },
        ],
      },
      { ORGANIZATION: 4 },
    );
    expect(r.value).toBe(4);
    expect(r.detail.missingComponents).toEqual(["MENTAL_ACUITY"]);
  });
});

describe("sales alignment classification", () => {
  it("classifies bands qualitatively — never a success probability", () => {
    expect(classifyCompositeBand(9)).toBe("STRONG_ALIGNMENT");
    expect(classifyCompositeBand(7)).toBe("STRONG_ALIGNMENT");
    expect(classifyCompositeBand(5)).toBe("GENERALLY_ALIGNED");
    expect(classifyCompositeBand(4)).toBe("MIXED_ALIGNMENT");
    expect(classifyCompositeBand(2)).toBe("REQUIRES_INVESTIGATION");
  });

  it("summarizes overall patterns with a transparent count rule", () => {
    expect(overallSalesAlignment([8, 8, 7, 7, 7, 6, 6, 7])).toBe("STRONG_ALIGNMENT");
    expect(overallSalesAlignment([6, 6, 5, 5, 4, 7, 5, 6])).toBe("GENERALLY_ALIGNED");
    expect(overallSalesAlignment([2, 3, 2, 6, 5, 3])).toBe("REQUIRES_INVESTIGATION");
    expect(overallSalesAlignment([])).toBe("MIXED_ALIGNMENT");
  });
});
