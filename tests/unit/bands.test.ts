import { describe, expect, it } from "vitest";
import {
  bandScore,
  clampBand,
  provisionalBand,
  stanineFromNormTable,
} from "@/lib/scoring/bands";
import type { NormTableData } from "@/lib/scoring/types";

describe("provisional 1-9 bands", () => {
  it("maps scaled scores onto the documented thresholds", () => {
    expect(provisionalBand(0).band).toBe(1);
    expect(provisionalBand(14.9).band).toBe(1);
    expect(provisionalBand(15).band).toBe(2);
    expect(provisionalBand(27.5).band).toBe(3);
    expect(provisionalBand(45).band).toBe(4);
    expect(provisionalBand(50).band).toBe(5);
    expect(provisionalBand(59.99).band).toBe(5);
    expect(provisionalBand(60).band).toBe(6);
    expect(provisionalBand(75).band).toBe(7);
    expect(provisionalBand(85).band).toBe(8);
    expect(provisionalBand(90).band).toBe(9);
    expect(provisionalBand(100).band).toBe(9);
  });

  it("clamps out-of-range inputs instead of failing", () => {
    expect(provisionalBand(-5).band).toBe(1);
    expect(provisionalBand(140).band).toBe(9);
  });

  it("is labeled PROVISIONAL, never STANINE", () => {
    expect(provisionalBand(50).bandType).toBe("PROVISIONAL");
  });
});

describe("stanine via norm table", () => {
  const table: NormTableData = {
    id: "norm1",
    construct: "MENTAL_ACUITY",
    thresholds: [
      { band: 1, maxRaw: 3, percentile: 4 },
      { band: 2, maxRaw: 6, percentile: 11 },
      { band: 3, maxRaw: 9, percentile: 23 },
      { band: 4, maxRaw: 12, percentile: 40 },
      { band: 5, maxRaw: 15, percentile: 60 },
      { band: 6, maxRaw: 18, percentile: 77 },
      { band: 7, maxRaw: 20, percentile: 89 },
      { band: 8, maxRaw: 22, percentile: 96 },
    ],
  };

  it("maps raw scores across boundaries", () => {
    expect(stanineFromNormTable(0, table).band).toBe(1);
    expect(stanineFromNormTable(3, table).band).toBe(1);
    expect(stanineFromNormTable(4, table).band).toBe(2);
    expect(stanineFromNormTable(15, table).band).toBe(5);
    expect(stanineFromNormTable(22, table).band).toBe(8);
    expect(stanineFromNormTable(23, table).band).toBe(9);
    expect(stanineFromNormTable(24, table).band).toBe(9);
  });

  it("records the norm table id and type", () => {
    const r = stanineFromNormTable(10, table);
    expect(r.bandType).toBe("STANINE");
    expect(r.normTableId).toBe("norm1");
    expect(r.percentile).toBe(40);
  });

  it("bandScore prefers the norm table when present, provisional otherwise", () => {
    expect(bandScore(10, 42, table).bandType).toBe("STANINE");
    expect(bandScore(10, 42, null).bandType).toBe("PROVISIONAL");
    expect(bandScore(10, 42, null).band).toBe(4);
  });
});

describe("clampBand", () => {
  it("rounds and clamps to 1..9", () => {
    expect(clampBand(0)).toBe(1);
    expect(clampBand(5.4)).toBe(5);
    expect(clampBand(5.5)).toBe(6);
    expect(clampBand(12)).toBe(9);
  });
});

describe("non-finite scores", () => {
  it("never reports a broken computation as the top band", () => {
    expect(() => provisionalBand(NaN)).toThrow(/non-finite/i);
    expect(() => provisionalBand(Infinity)).toThrow();
    expect(() => bandScore(NaN, NaN, null)).toThrow();
  });
  it("still bands real scores", () => {
    expect(provisionalBand(50).band).toBe(5);
  });
});

import { percentileFromCurve } from "@/lib/scoring/percentile-curve";
import { percentileOf } from "@/lib/validation/stats";

describe("percentileFromCurve tie convention", () => {
  it("uses the midpoint of a tie block, like percentileOf", () => {
    const curve = [ {raw:4,percentile:1}, {raw:5,percentile:23}, {raw:5,percentile:35}, {raw:5,percentile:47}, {raw:6,percentile:60} ];
    expect(percentileFromCurve(curve, 5)).toBe(35);
  });
  it("agrees with percentileOf on a coarse sample", () => {
    const sample = [1,1,2,2,2,3,3,4,4,4,4,5];
    const sorted = [...sample].sort((a,b)=>a-b);
    const curve = Array.from({length:99},(_,i)=>{ const p=i+1; const idx=Math.min(sorted.length-1,Math.floor((p/100)*sorted.length)); return {raw:sorted[idx],percentile:p}; });
    for (const v of [2,3,4]) {
      expect(Math.abs(percentileFromCurve(curve, v) - percentileOf(sorted, v))).toBeLessThan(12);
    }
  });
});
