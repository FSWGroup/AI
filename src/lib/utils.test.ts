import { describe, it, expect } from "vitest";
import {
  cn,
  formatBytes,
  formatDuration,
  formatMinutes,
  initials,
  pct,
  plural,
  slugify,
  truncate,
} from "@/lib/utils";

describe("cn", () => {
  it("joins truthy class names and drops falsy ones", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
});

describe("pct", () => {
  it("rounds to a whole percentage", () => {
    expect(pct(66.6)).toBe("67%");
    expect(pct(0)).toBe("0%");
    expect(pct(100)).toBe("100%");
  });
});

describe("formatMinutes", () => {
  it("formats minutes, hours, and combinations", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1 hr");
    expect(formatMinutes(95)).toBe("1 hr 35 min");
    expect(formatMinutes(120)).toBe("2 hr");
  });

  it("shows an em dash for missing or zero durations", () => {
    expect(formatMinutes(null)).toBe("—");
    expect(formatMinutes(undefined)).toBe("—");
    expect(formatMinutes(0)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("formats seconds as m:ss and h:mm:ss", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(9)).toBe("0:09");
  });

  it("handles missing values", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });
});

describe("formatBytes", () => {
  it("scales through units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(1536 * 1024 * 1024)).toBe("1.5 GB");
  });
});

describe("initials", () => {
  it("takes first and last initials", () => {
    expect(initials("Jordan Pace")).toBe("JP");
    expect(initials("Avery R. Nolan")).toBe("AN");
  });

  it("handles a single name and empty input", () => {
    expect(initials("Cher")).toBe("CH");
    expect(initials("   ")).toBe("?");
  });
});

describe("slugify", () => {
  it("produces URL-safe slugs", () => {
    expect(slugify("Create a Customer Quote")).toBe("create-a-customer-quote");
    expect(slugify("  Trim & Punctuate!  ")).toBe("trim-punctuate");
  });

  it("strips diacritics", () => {
    expect(slugify("Café Résumé")).toBe("cafe-resume");
  });

  it("caps length", () => {
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe("truncate", () => {
  it("leaves short text alone", () => {
    expect(truncate("short", 20)).toBe("short");
  });

  it("cuts on a word boundary when one is close enough", () => {
    const result = truncate("the quick brown fox jumps over", 20);
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(21);
    expect(result).not.toContain("jum…");
  });
});

describe("plural", () => {
  it("uses the singular for exactly one", () => {
    expect(plural(1, "course")).toBe("course");
    expect(plural(0, "course")).toBe("courses");
    expect(plural(2, "course")).toBe("courses");
  });

  it("accepts an irregular plural", () => {
    expect(plural(2, "person", "people")).toBe("people");
  });
});
