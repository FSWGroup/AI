import { describe, expect, it } from "vitest";
import {
  computeExpiry,
  isExpired,
  remainingSeconds,
  warningPoints,
} from "@/lib/timing";

describe("server-authoritative timing", () => {
  it("computes expiry from start + duration", () => {
    const start = new Date("2026-01-01T10:00:00Z");
    expect(computeExpiry(start, 600).toISOString()).toBe(
      "2026-01-01T10:10:00.000Z",
    );
  });

  it("applies accommodation time multipliers", () => {
    const start = new Date("2026-01-01T10:00:00Z");
    expect(computeExpiry(start, 600, 1.5).toISOString()).toBe(
      "2026-01-01T10:15:00.000Z",
    );
  });

  it("derives remaining time from the stored deadline (refresh-proof)", () => {
    const expires = new Date(Date.now() + 90_000);
    const r1 = remainingSeconds(expires);
    const r2 = remainingSeconds(expires); // a "refresh" cannot add time
    expect(r1).toBeLessThanOrEqual(90);
    expect(r2).toBeLessThanOrEqual(r1);
  });

  it("never returns negative remaining time", () => {
    expect(remainingSeconds(new Date(Date.now() - 5000))).toBe(0);
    expect(isExpired(new Date(Date.now() - 1))).toBe(true);
    expect(isExpired(new Date(Date.now() + 1000))).toBe(false);
  });

  it("chooses warning points that fit the section length", () => {
    expect(warningPoints(660)).toEqual([300, 120, 60, 30]);
    expect(warningPoints(90)).toEqual([60, 30]);
    expect(warningPoints(20)).toEqual([10]);
  });
});
