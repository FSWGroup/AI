import { describe, it, expect } from "vitest";
import { buildManagerBrief } from "@/lib/report/manager-brief";
import type { ReportDimension } from "@/lib/report/generate";
import { reportDimension, reportPayload as payload } from "../fixtures/report";

/** This suite reasons about behavioral dimensions; Energy is the stand-in. */
function dim(over: Partial<ReportDimension>): ReportDimension {
  return reportDimension({
    construct: "ENERGY",
    name: "Energy",
    category: "BEHAVIORAL",
    lowDescriptor: "Measured",
    highDescriptor: "Driving",
    ...over,
  });
}

describe("buildManagerBrief", () => {
  it("counts only required dimensions in the alignment denominator", () => {
    const brief = buildManagerBrief(
      payload({
        dimensions: [
          dim({
            construct: "ENERGY",
            band: 6,
            position: "WITHIN",
            benchmark: { min: 5, max: 7, required: true },
          }),
          dim({
            construct: "ASSERTIVENESS",
            name: "Assertiveness",
            band: 3,
            position: "BELOW",
            deviation: -2,
            benchmark: { min: 5, max: 7, required: true },
          }),
          dim({
            construct: "ORGANIZATION",
            name: "Organization",
            band: 6,
            position: "WITHIN",
            benchmark: { min: 5, max: 7, required: false },
          }),
        ],
      }),
    );
    expect(brief.alignment).toEqual({
      inRange: 1,
      requiredTotal: 2,
      optionalInRange: 1,
      optionalTotal: 1,
    });
  });

  it("treats above-range as worth exploring, never as a strength", () => {
    const brief = buildManagerBrief(
      payload({
        dimensions: [
          dim({
            construct: "ASSERTIVENESS",
            name: "Assertiveness",
            band: 9,
            position: "ABOVE",
            deviation: 2,
            benchmark: { min: 5, max: 7, required: true },
          }),
        ],
      }),
    );
    expect(brief.alignsWith).toHaveLength(0);
    expect(brief.probe.map((p) => p.name)).toEqual(["Assertiveness"]);
    expect(brief.probe[0].note).toContain("Higher is not automatically better");
  });

  it("ranks required dimensions ahead of optional ones when exploring", () => {
    const brief = buildManagerBrief(
      payload({
        dimensions: [
          dim({
            construct: "ORGANIZATION",
            name: "Organization",
            band: 1,
            position: "BELOW",
            deviation: -4,
            benchmark: { min: 5, max: 7, required: false },
          }),
          dim({
            construct: "ENERGY",
            name: "Energy",
            band: 4,
            position: "BELOW",
            deviation: -1,
            benchmark: { min: 5, max: 7, required: true },
          }),
        ],
      }),
    );
    expect(brief.probe.map((p) => p.name)).toEqual(["Energy", "Organization"]);
  });

  it("ignores dimensions with no benchmark on either side", () => {
    const brief = buildManagerBrief(
      payload({ dimensions: [dim({ band: 9, position: null })] }),
    );
    expect(brief.alignment.requiredTotal).toBe(0);
    expect(brief.alignsWith).toHaveLength(0);
    expect(brief.probe).toHaveLength(0);
  });

  it("escalates response quality to the worst validity level present", () => {
    const validity = (level: string) => ({
      construct: "DISTORTION" as const,
      name: "Distortion",
      band: 7,
      level,
      narrative: "",
      detail: {},
    });
    expect(
      buildManagerBrief(payload({ validity: [validity("NORMAL")] }))
        .responseQualityLevel,
    ).toBe("NORMAL");
    expect(
      buildManagerBrief(
        payload({ validity: [validity("NORMAL"), validity("ELEVATED")] }),
      ).responseQualityLevel,
    ).toBe("ELEVATED");
    expect(
      buildManagerBrief(
        payload({ validity: [validity("ELEVATED"), validity("HIGH")] }),
      ).responseQualityLevel,
    ).toBe("HIGH");
  });

  it("takes interview questions verbatim from the full report", () => {
    const brief = buildManagerBrief(
      payload({
        interviewGuide: [
          {
            construct: "ENERGY",
            name: "Energy",
            focus: "",
            reason: "",
            measures: "",
            questions: [
              {
                question: "Tell me about a stretch of weeks with heavy volume.",
                altWording: "alt",
                listenFor: "Sustained pace.",
              },
              { question: "second", altWording: "", listenFor: "" },
            ],
          },
        ],
      }),
    );
    expect(brief.questions).toEqual([
      {
        dimension: "Energy",
        question: "Tell me about a stretch of weeks with heavy volume.",
        listenFor: "Sustained pace.",
      },
    ]);
  });

  it("caps each list so the brief stays one page", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      dim({
        construct: "ENERGY",
        name: `Dim ${i}`,
        band: 6,
        position: "WITHIN",
        benchmark: { min: 5, max: 7, required: true },
      }),
    );
    const brief = buildManagerBrief(payload({ dimensions: many }));
    // The list is capped, but the count still reflects every dimension.
    expect(brief.alignsWith).toHaveLength(3);
    expect(brief.alignment.inRange).toBe(8);
  });

  it("produces no recommendation, score, or verdict field", () => {
    const brief = buildManagerBrief(payload());
    const keys = Object.keys(brief);
    for (const banned of ["recommendation", "decision", "verdict", "fitScore", "rank"]) {
      expect(keys).not.toContain(banned);
    }
    expect(brief.disclaimer).toContain("Decision support only.");
  });
});
