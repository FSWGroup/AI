import { describe, expect, it } from "vitest";
import { summarizeIntegrity } from "@/lib/scoring/integrity";

describe("integrity summary", () => {
  it("reports no notable events for a clean attempt", () => {
    const r = summarizeIntegrity([
      { type: "ATTEMPT_STARTED", count: 1 },
      { type: "SECTION_STARTED", count: 7 },
      { type: "SECTION_COMPLETED", count: 7 },
    ]);
    expect(r.level).toBe("NO_NOTABLE_EVENTS");
    expect(r.notableCounts).toHaveLength(0);
  });

  it("recommends minor review for a couple of tab switches", () => {
    const r = summarizeIntegrity([{ type: "TAB_HIDDEN", count: 2 }]);
    expect(r.level).toBe("MINOR_REVIEW_RECOMMENDED");
  });

  it("recommends review for heavier objective activity", () => {
    const r = summarizeIntegrity([
      { type: "TAB_HIDDEN", count: 4 },
      { type: "COPY_ATTEMPT", count: 1 },
    ]);
    expect(r.level).toBe("REVIEW_RECOMMENDED");
  });

  it("never produces a probability — only a level and raw counts", () => {
    const r = summarizeIntegrity([{ type: "CAMERA_INTERRUPTED", count: 1 }]);
    expect(Object.keys(r)).toEqual(["level", "weightedScore", "notableCounts"]);
  });
});
