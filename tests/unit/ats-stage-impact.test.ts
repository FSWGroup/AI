import { describe, it, expect } from "vitest";
import {
  analyzeFunnelImpact,
  stageOutcomes,
  MIN_TOTAL_FOR_ANALYSIS,
  type StageDemographics,
  type StageReach,
} from "@/lib/ats/stage-impact";

const STAGES = [
  { name: "Applied", kind: "APPLIED" as const },
  { name: "Screen", kind: "SCREEN" as const },
  { name: "Interview", kind: "INTERVIEW" as const },
  { name: "Hired", kind: "HIRED" as const },
];
const NAMES = STAGES.map((s) => s.name);

/** n applicants, the first `advanced` of whom reach the next stage. */
function cohort(
  prefix: string,
  n: number,
  advanced: number,
  group: string,
  stage = "Screen",
  nextStage = "Interview",
): { reach: StageReach[]; people: StageDemographics[] } {
  const reach: StageReach[] = [];
  const people: StageDemographics[] = [];
  for (let i = 0; i < n; i++) {
    const id = `${prefix}${i}`;
    reach.push({ applicationId: id, stageName: stage });
    if (i < advanced) reach.push({ applicationId: id, stageName: nextStage });
    people.push({ applicationId: id, demographics: { sex: group } });
  }
  return { reach, people };
}

describe("stageOutcomes", () => {
  it("counts pass-through to any later stage, not just the next one", () => {
    // Someone who skipped Interview and went straight to Hired still passed.
    const reach: StageReach[] = [
      { applicationId: "a", stageName: "Screen" },
      { applicationId: "a", stageName: "Hired" },
    ];
    const people: StageDemographics[] = [
      { applicationId: "a", demographics: { sex: "FEMALE" } },
    ];
    const { outcomes } = stageOutcomes(1, NAMES, reach, people, "sex");
    expect(outcomes).toEqual([{ group: "FEMALE", applicants: 1, selected: 1 }]);
  });

  it("excludes people who never reached the stage", () => {
    const reach: StageReach[] = [{ applicationId: "a", stageName: "Applied" }];
    const people: StageDemographics[] = [
      { applicationId: "a", demographics: { sex: "MALE" } },
    ];
    expect(stageOutcomes(1, NAMES, reach, people, "sex").outcomes).toEqual([]);
  });

  it("excludes declined and missing self-identification", () => {
    const reach: StageReach[] = [
      { applicationId: "a", stageName: "Screen" },
      { applicationId: "b", stageName: "Screen" },
      { applicationId: "c", stageName: "Screen" },
    ];
    const people: StageDemographics[] = [
      { applicationId: "a", demographics: { sex: "DECLINE" } },
      { applicationId: "b", demographics: null },
      { applicationId: "c", demographics: { sex: "FEMALE" } },
    ];
    const { outcomes, analyzed } = stageOutcomes(1, NAMES, reach, people, "sex");
    expect(analyzed).toBe(1);
    expect(outcomes).toEqual([{ group: "FEMALE", applicants: 1, selected: 0 }]);
  });

  it("aggregates per group rather than per person", () => {
    const a = cohort("m", 4, 2, "MALE");
    const b = cohort("f", 6, 1, "FEMALE");
    const { outcomes } = stageOutcomes(
      1,
      NAMES,
      [...a.reach, ...b.reach],
      [...a.people, ...b.people],
      "sex",
    );
    expect(outcomes).toEqual(
      expect.arrayContaining([
        { group: "MALE", applicants: 4, selected: 2 },
        { group: "FEMALE", applicants: 6, selected: 1 },
      ]),
    );
  });
});

describe("analyzeFunnelImpact", () => {
  const categories = [{ key: "sex", label: "Sex" }];

  it("does not analyze the final stage, which has nothing to pass through to", () => {
    const results = analyzeFunnelImpact({
      orderedStages: STAGES,
      reach: [],
      people: [],
      categories,
    });
    expect(results.map((r) => r.stageName)).toEqual(["Applied", "Screen", "Interview"]);
  });

  it("withholds analysis below the sample floor and says why", () => {
    const { reach, people } = cohort("x", 8, 4, "MALE");
    const results = analyzeFunnelImpact({
      orderedStages: STAGES,
      reach,
      people,
      categories,
    });
    const screen = results.find((r) => r.stageName === "Screen")!;
    expect(screen.analyzed).toBe(8);
    expect(screen.insufficientReason).toContain(String(MIN_TOTAL_FOR_ANALYSIS));
  });

  it("says plainly when nobody at a stage has self-identified", () => {
    const results = analyzeFunnelImpact({
      orderedStages: STAGES,
      reach: [{ applicationId: "a", stageName: "Screen" }],
      people: [{ applicationId: "a", demographics: null }],
      categories,
    });
    const screen = results.find((r) => r.stageName === "Screen")!;
    expect(screen.insufficientReason).toContain("self-identified");
  });

  it("flags a stage where one group passes through far less often", () => {
    // 20 per group; 80% of one advances, 30% of the other. Ratio 0.375.
    const a = cohort("m", 20, 16, "MALE");
    const b = cohort("f", 20, 6, "FEMALE");
    const results = analyzeFunnelImpact({
      orderedStages: STAGES,
      reach: [...a.reach, ...b.reach],
      people: [...a.people, ...b.people],
      categories,
    });
    const screen = results.find((r) => r.stageName === "Screen")!;
    expect(screen.insufficientReason).toBeNull();
    expect(screen.categories[0].flagged).toBe(true);
    const female = screen.categories[0].groups.find((g) => g.group === "FEMALE")!;
    expect(female.impactRatio).toBeCloseTo(0.375, 2);
  });

  it("does not flag a stage where groups pass through at similar rates", () => {
    const a = cohort("m", 20, 15, "MALE");
    const b = cohort("f", 20, 14, "FEMALE");
    const results = analyzeFunnelImpact({
      orderedStages: STAGES,
      reach: [...a.reach, ...b.reach],
      people: [...a.people, ...b.people],
      categories,
    });
    expect(results.find((r) => r.stageName === "Screen")!.categories[0].flagged).toBe(
      false,
    );
  });

  it("analyzes an unstructured stage the same way it analyzes the assessment", () => {
    // The point of the module: a résumé screen gets the same scrutiny as a
    // test, because that is usually where the larger disparity is.
    const a = cohort("m", 20, 18, "MALE", "Applied", "Screen");
    const b = cohort("f", 20, 8, "FEMALE", "Applied", "Screen");
    const results = analyzeFunnelImpact({
      orderedStages: STAGES,
      reach: [...a.reach, ...b.reach],
      people: [...a.people, ...b.people],
      categories,
    });
    const applied = results.find((r) => r.stageName === "Applied")!;
    expect(applied.categories[0].flagged).toBe(true);
  });
});
