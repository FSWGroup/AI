import { describe, it, expect } from "vitest";
import { buildCandidateFeedback } from "@/lib/report/candidate-feedback";
import type { ReportPayload, ReportDimension } from "@/lib/report/generate";
import { reportDimension, reportPayload } from "../fixtures/report";

/** Every dimension here is benchmarked; feedback selection depends on it. */
function dim(over: Partial<ReportDimension>): ReportDimension {
  return reportDimension({
    benchmark: { min: 5, max: 7, required: true },
    position: "WITHIN",
    ...over,
  });
}

/**
 * A report carrying an elevated distortion score, a flagged concern and
 * integrity events — none of which may reach the candidate. That is what
 * these tests are checking, so they are part of the fixture, not overrides.
 */
function payload(dimensions: ReportDimension[]): ReportPayload {
  return reportPayload({
    dimensions,
    validity: [
      {
        construct: "DISTORTION",
        name: "Distortion",
        band: 8,
        level: "HIGH",
        narrative: "Elevated.",
        detail: {},
      },
    ],
    concerns: [{ construct: "ENERGY", name: "Energy", band: 2, label: "Attention" }],
    integrity: {
      level: "ELEVATED",
      label: "Notable events logged",
      weightedScore: 12,
      notableCounts: [{ type: "TAB_BLUR", count: 3 }],
      reviewReminder: "",
    },
  });
}

const templates = new Map<string, string[]>([
  ["ENERGY", ["Block out focused work time.", "Pace longer projects."]],
]);

describe("buildCandidateFeedback", () => {
  it("never leaks bands, benchmarks, validity, or integrity", () => {
    const feedback = buildCandidateFeedback(
      payload([
        dim({ band: 8 }),
        dim({
          construct: "ENERGY",
          name: "Energy",
          category: "BEHAVIORAL",
          band: 2,
        }),
      ]),
      "Alex",
      templates,
    );
    const json = JSON.stringify(feedback);
    for (const leak of [
      "Distortion",
      "Elevated",
      "TAB_BLUR",
      "Notable events",
      "benchmark",
      "Attention",
      "Decision support only",
    ]) {
      expect(json).not.toContain(leak);
    }
    // No numeric band anywhere, and no key that could carry one.
    expect(json).not.toMatch(/"band"/);
    expect(json).not.toMatch(/\b[1-9] of 9\b/);
  });

  it("leads with the strongest aptitudes when any clear the threshold", () => {
    const feedback = buildCandidateFeedback(
      payload([
        dim({ construct: "MENTAL_ACUITY", name: "Mental Acuity", band: 9 }),
        dim({ construct: "VOCABULARY", name: "Vocabulary", band: 7 }),
        dim({ construct: "BUSINESS_TERMS", name: "Business Terms", band: 3 }),
      ]),
      "Alex",
      templates,
    );
    expect(feedback.strengths.map((s) => s.name)).toEqual([
      "Mental Acuity",
      "Vocabulary",
    ]);
    expect(feedback.strengths[0].statement).toContain("particular strength");
  });

  it("still shows a relative best when nothing clears the threshold", () => {
    const feedback = buildCandidateFeedback(
      payload([
        dim({ construct: "MENTAL_ACUITY", name: "Mental Acuity", band: 4 }),
        dim({ construct: "VOCABULARY", name: "Vocabulary", band: 2 }),
      ]),
      "Alex",
      templates,
    );
    expect(feedback.strengths).toHaveLength(2);
    expect(feedback.strengths[0].name).toBe("Mental Acuity");
    expect(feedback.strengths[0].statement).toContain("among your stronger");
  });

  it("describes low behavioral scores as a style, not a shortfall", () => {
    const feedback = buildCandidateFeedback(
      payload([
        dim({
          construct: "ASSERTIVENESS",
          name: "Assertiveness",
          category: "BEHAVIORAL",
          band: 2,
        }),
      ]),
      "Alex",
      templates,
    );
    expect(feedback.workStyle[0].statement).toContain("not a shortfall");
  });

  it("caps development areas at three and only where advice exists", () => {
    const lows = ["ENERGY", "FLEXIBILITY", "ORGANIZATION", "COMMUNICATION"].map(
      (c, i) =>
        dim({
          construct: c as ReportDimension["construct"],
          name: c,
          category: "BEHAVIORAL",
          band: 1 + i,
        }),
    );
    const feedback = buildCandidateFeedback(payload(lows), "Alex", templates);
    // Only ENERGY has a template, so only it can appear.
    expect(feedback.development).toEqual([
      { name: "ENERGY", suggestions: templates.get("ENERGY") },
    ]);
    expect(feedback.development.length).toBeLessThanOrEqual(3);
  });

  it("omits development entirely when nothing scored low", () => {
    const feedback = buildCandidateFeedback(
      payload([
        dim({ construct: "ENERGY", name: "Energy", category: "BEHAVIORAL", band: 7 }),
      ]),
      "Alex",
      templates,
    );
    expect(feedback.development).toHaveLength(0);
  });

  it("states there is no pass or fail", () => {
    const feedback = buildCandidateFeedback(payload([dim({})]), "Alex", templates);
    expect(feedback.aboutTheAssessment.join(" ")).toContain("no pass or fail");
    expect(feedback.candidateFirstName).toBe("Alex");
  });
});
