import { describe, expect, it } from "vitest";
import { scoreCognitiveSection } from "@/lib/scoring/cognitive";
import type { CognitiveItemResponse } from "@/lib/scoring/types";

function item(
  answer: number | null,
  correct = 0,
  weight = 1,
  ms?: number,
): CognitiveItemResponse {
  return { answerIndex: answer, correctIndex: correct, weight, responseTimeMs: ms };
}

describe("cognitive scoring", () => {
  it("scores accuracy over presented items", () => {
    const r = scoreCognitiveSection("MENTAL_ACUITY", [
      item(0), // correct
      item(1), // wrong
      item(0), // correct
      item(null), // unanswered
    ]);
    expect(r.rawScore).toBe(2);
    expect(r.scaledScore).toBe(50);
    expect(r.detail.answered).toBe(3);
    expect(r.detail.unanswered).toBe(1);
  });

  it("counts unanswered items against the score (standardized timing)", () => {
    const all = scoreCognitiveSection("VOCABULARY", [item(0), item(0)]);
    const half = scoreCognitiveSection("VOCABULARY", [item(0), item(null)]);
    expect(all.scaledScore).toBe(100);
    expect(half.scaledScore).toBe(50);
  });

  it("applies item weights", () => {
    const r = scoreCognitiveSection("BUSINESS_TERMS", [
      item(0, 0, 2), // correct, double weight
      item(1, 0, 1), // wrong
    ]);
    expect(r.rawScore).toBe(2);
    expect(r.scaledScore).toBeCloseTo(66.67, 1);
  });

  it("never rewards rapid guessing: speed does not change the score", () => {
    const fast = scoreCognitiveSection("MENTAL_ACUITY", [
      item(1, 0, 1, 200),
      item(1, 0, 1, 150),
    ]);
    const slow = scoreCognitiveSection("MENTAL_ACUITY", [
      item(1, 0, 1, 30_000),
      item(1, 0, 1, 45_000),
    ]);
    expect(fast.rawScore).toBe(slow.rawScore);
    expect(fast.scaledScore).toBe(slow.scaledScore);
    // Speed is reported separately for calibration only.
    expect(fast.detail.avgResponseMs).toBe(175);
  });

  it("handles an empty section without dividing by zero", () => {
    const r = scoreCognitiveSection("MENTAL_ACUITY", []);
    expect(r.scaledScore).toBe(0);
  });
});
