import { describe, expect, it } from "vitest";
import { redactIdentity } from "@/lib/ai/redact";

const RESUME = `Jordan Reyes
jordan.reyes@example.invalid | (555) 010-2233 | 1420 Prospect Avenue, Cleveland, OH 44115
linkedin.com/in/jordanreyes

Senior Inside Sales Representative — Midwest Valve Supply (2021-2026)
Managed 200+ accounts generating $3.1M annual revenue.
Reduced quote turnaround from 48 to 16 hours.
References available; contact Jordan directly.`;

describe("résumé identity redaction", () => {
  const { text, redactedCounts } = redactIdentity(RESUME, ["Jordan", "Reyes"]);

  it("removes the candidate's name everywhere it appears", () => {
    expect(text).not.toMatch(/Jordan/i);
    expect(text).not.toMatch(/Reyes/i);
    expect(redactedCounts.name).toBeGreaterThanOrEqual(2);
  });

  it("removes email, phone, and links", () => {
    expect(text).not.toContain("@example.invalid");
    expect(text).not.toContain("555");
    expect(text).not.toContain("linkedin.com");
    expect(redactedCounts.email).toBe(1);
    expect(redactedCounts.phone).toBeGreaterThanOrEqual(1);
  });

  it("removes street address and postal code (an unlawful proxy)", () => {
    expect(text).not.toContain("Prospect Avenue");
    expect(text).not.toContain("44115");
  });

  it("preserves the work history the analysis actually needs", () => {
    expect(text).toContain("Senior Inside Sales Representative");
    expect(text).toContain("Midwest Valve Supply");
    expect(text).toContain("200+ accounts");
    expect(text).toContain("$3.1M");
    expect(text).toContain("48 to 16 hours");
  });

  it("is safe on empty input and unknown names", () => {
    expect(redactIdentity("", []).text).toBe("");
    expect(redactIdentity("Plain text.", []).text).toBe("Plain text.");
  });

  it("does not break on regex-special characters in a name", () => {
    const r = redactIdentity("O'Brien (A.J.) worked here.", ["O'Brien", "A.J."]);
    expect(r.text).toContain("worked here.");
  });
});
