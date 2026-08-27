import { describe, expect, it } from "vitest";
import {
  likertItemScore,
  scoreBehavioralConstruct,
} from "@/lib/scoring/behavioral";
import type { LikertItemResponse } from "@/lib/scoring/types";

function likert(
  construct: LikertItemResponse["construct"],
  answer: number | null,
  reverse = false,
  im = false,
): LikertItemResponse {
  return {
    construct,
    weight: 1,
    reverseCoded: reverse,
    impressionManagement: im,
    answerIndex: answer,
  };
}

describe("likert item scoring", () => {
  it("scores positive items 1..5", () => {
    expect(likertItemScore(likert("ENERGY", 0))).toBe(1);
    expect(likertItemScore(likert("ENERGY", 4))).toBe(5);
  });
  it("reverse-codes items (agree = low standing)", () => {
    expect(likertItemScore(likert("ENERGY", 4, true))).toBe(1);
    expect(likertItemScore(likert("ENERGY", 0, true))).toBe(5);
    expect(likertItemScore(likert("ENERGY", 2, true))).toBe(3);
  });
  it("returns null for unanswered items", () => {
    expect(likertItemScore(likert("ENERGY", null))).toBeNull();
  });
});

describe("behavioral construct scoring", () => {
  it("normalizes the weighted mean to 0-100", () => {
    const items = [
      likert("ORGANIZATION", 4), // 5
      likert("ORGANIZATION", 3), // 4
      likert("ORGANIZATION", 0, true), // reverse: 5
      likert("ORGANIZATION", 1, true), // reverse: 4
    ];
    const r = scoreBehavioralConstruct("ORGANIZATION", items);
    expect(r.rawScore).toBe(4.5);
    expect(r.scaledScore).toBe(87.5);
  });

  it("ignores other constructs and impression-management items", () => {
    const items = [
      likert("ORGANIZATION", 4),
      likert("ENERGY", 0),
      likert("DISTORTION", 4, false, true),
    ];
    const r = scoreBehavioralConstruct("ORGANIZATION", items);
    expect(r.detail.itemsPresented).toBe(1);
    expect(r.rawScore).toBe(5);
  });

  it("uses the mean so a single answer cannot swing the trait", () => {
    const base = Array.from({ length: 9 }, () => likert("ENERGY", 3)); // all 4s
    const withOneExtreme = [...base, likert("ENERGY", 0)]; // one 1
    const a = scoreBehavioralConstruct("ENERGY", base);
    const b = scoreBehavioralConstruct("ENERGY", withOneExtreme);
    expect(Math.abs(a.scaledScore - b.scaledScore)).toBeLessThan(10);
  });

  it("handles missing responses and flags low answered fractions", () => {
    const items = [
      likert("ENERGY", 4),
      likert("ENERGY", null),
      likert("ENERGY", null),
      likert("ENERGY", null),
    ];
    const r = scoreBehavioralConstruct("ENERGY", items);
    expect(r.detail.answered).toBe(1);
    expect(r.detail.scorable).toBe(false); // under MIN_ANSWERED_FRACTION
  });
});
