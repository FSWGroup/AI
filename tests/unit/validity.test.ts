import { describe, expect, it } from "vitest";
import {
  scoreDistortion,
  scoreEquivocation,
  VALIDITY_CONFIG,
} from "@/lib/scoring/validity";
import type { LikertItemResponse } from "@/lib/scoring/types";

function likert(
  construct: LikertItemResponse["construct"],
  answer: number | null,
  opts: Partial<LikertItemResponse> = {},
): LikertItemResponse {
  return {
    construct,
    weight: 1,
    reverseCoded: false,
    impressionManagement: false,
    answerIndex: answer,
    ...opts,
  };
}

describe("distortion / impression management", () => {
  it("reads NORMAL for a differentiated, honest-looking pattern", () => {
    const items = [
      // IM items mostly rejected
      likert("DISTORTION", 1, { impressionManagement: true }),
      likert("DISTORTION", 0, { impressionManagement: true }),
      likert("DISTORTION", 2, { impressionManagement: true }),
      // varied substantive answers
      likert("ENERGY", 3),
      likert("ENERGY", 1),
      likert("ORGANIZATION", 2),
      likert("ORGANIZATION", 4),
      likert("MOTIVATION", 3),
    ];
    const r = scoreDistortion(items);
    expect(r.level).toBe("NORMAL");
  });

  it("reads HIGH when IM items are endorsed and everything is maximally desirable", () => {
    const items = [
      likert("DISTORTION", 4, { impressionManagement: true }),
      likert("DISTORTION", 4, { impressionManagement: true }),
      likert("DISTORTION", 4, { impressionManagement: true }),
      ...Array.from({ length: 10 }, () => likert("ENERGY", 4)),
    ];
    const r = scoreDistortion(items);
    expect(r.level).toBe("HIGH");
    expect(r.scaledScore).toBeGreaterThanOrEqual(
      VALIDITY_CONFIG.distortion.highAt,
    );
  });

  it("preserves the raw measurements it used", () => {
    const r = scoreDistortion([
      likert("DISTORTION", 4, { impressionManagement: true }),
      likert("ENERGY", 4),
    ]);
    expect(r.detail.imItemsAnswered).toBe(1);
    expect(r.detail.extremeDesirableCount).toBe(1);
    expect(r.detail.thresholds).toBeDefined();
  });
});

describe("equivocation", () => {
  it("counts middle responses and compares to the configurable threshold", () => {
    const items = Array.from({ length: 40 }, () => likert("ENERGY", 2));
    const r = scoreEquivocation(items);
    expect(r.rawScore).toBe(40); // middle count is the raw score
    expect(r.detail.middleCount).toBe(40);
    expect(r.detail.middleCountThreshold).toBe(
      VALIDITY_CONFIG.equivocation.middleCountThreshold,
    );
    expect(r.detail.middleCountExceedsThreshold).toBe(true);
    expect(r.level).not.toBe("NORMAL"); // all-middle + zero variance
  });

  it("flags inconsistent paired items", () => {
    const consistent = scoreEquivocation([
      likert("ENERGY", 4, { pairKey: "p1" }),
      likert("ENERGY", 4, { pairKey: "p1" }),
      likert("ORGANIZATION", 0, { pairKey: "p2" }),
      likert("ORGANIZATION", 0, { pairKey: "p2" }),
      likert("MOTIVATION", 1),
      likert("MOTIVATION", 3),
    ]);
    const contradictory = scoreEquivocation([
      likert("ENERGY", 4, { pairKey: "p1" }),
      likert("ENERGY", 0, { pairKey: "p1" }),
      likert("ORGANIZATION", 4, { pairKey: "p2" }),
      likert("ORGANIZATION", 0, { pairKey: "p2" }),
      likert("MOTIVATION", 1),
      likert("MOTIVATION", 3),
    ]);
    expect(contradictory.detail.pairInconsistency).toBeGreaterThan(
      consistent.detail.pairInconsistency as number,
    );
    expect(contradictory.scaledScore).toBeGreaterThan(consistent.scaledScore);
  });

  it("accounts for reverse coding inside pairs", () => {
    // Same underlying stance: agree with positive, disagree with reversed.
    const r = scoreEquivocation([
      likert("ENERGY", 4, { pairKey: "p1" }),
      likert("ENERGY", 0, { pairKey: "p1", reverseCoded: true }),
    ]);
    expect(r.detail.pairInconsistency).toBe(0);
  });

  it("reads NORMAL for a differentiated pattern", () => {
    const answers = [0, 4, 1, 3, 4, 0, 2, 3, 1, 4, 0, 3];
    const r = scoreEquivocation(
      answers.map((a) => likert("ENERGY", a)),
    );
    expect(r.level).toBe("NORMAL");
  });
});
