import { describe, it, expect } from "vitest";
import {
  DEFAULT_PIPELINE,
  checkMove,
  moveDirection,
  validatePipeline,
  type StageLike,
} from "@/lib/ats/stages";

function stage(over: Partial<StageLike>): StageLike {
  return { id: "s1", name: "Stage", kind: "SCREEN", orderIndex: 1, ...over };
}

describe("validatePipeline", () => {
  it("accepts the default pipeline", () => {
    expect(validatePipeline(DEFAULT_PIPELINE)).toEqual([]);
  });

  it("requires exactly one Applied stage, first", () => {
    expect(
      validatePipeline([
        { name: "Screen", kind: "SCREEN" },
        { name: "Applied", kind: "APPLIED" },
        { name: "Hired", kind: "HIRED" },
      ]).map((e) => e.message),
    ).toContain("The Applied stage must be first.");
  });

  it("requires exactly one Hired stage, last", () => {
    const errors = validatePipeline([
      { name: "Applied", kind: "APPLIED" },
      { name: "Hired", kind: "HIRED" },
      { name: "Screen", kind: "SCREEN" },
    ]);
    expect(errors.map((e) => e.message)).toContain("The Hired stage must be last.");
  });

  it("rejects duplicate stage names", () => {
    const errors = validatePipeline([
      { name: "Applied", kind: "APPLIED" },
      { name: "Interview", kind: "INTERVIEW" },
      { name: "interview", kind: "INTERVIEW" },
      { name: "Hired", kind: "HIRED" },
    ]);
    expect(errors.map((e) => e.message)).toContain(
      "Stage names must be unique within a pipeline.",
    );
  });

  it("allows repeated interview stages with distinct names", () => {
    expect(
      validatePipeline([
        { name: "Applied", kind: "APPLIED" },
        { name: "First interview", kind: "INTERVIEW" },
        { name: "Second interview", kind: "INTERVIEW" },
        { name: "Hired", kind: "HIRED" },
      ]),
    ).toEqual([]);
  });
});

describe("moveDirection", () => {
  it("treats a first placement as forward", () => {
    expect(moveDirection(null, stage({ orderIndex: 0 }))).toBe("FORWARD");
  });
  it("detects moving back", () => {
    expect(
      moveDirection(stage({ orderIndex: 3 }), stage({ id: "s2", orderIndex: 1 })),
    ).toBe("BACKWARD");
  });
});

describe("checkMove", () => {
  const base = { applicationStatus: "ACTIVE", hasAcceptedOffer: false };

  it("allows an ordinary forward move", () => {
    const result = checkMove({
      ...base,
      from: stage({ orderIndex: 0 }),
      to: stage({ id: "s2", orderIndex: 1 }),
    });
    expect(result.allowed).toBe(true);
  });

  it("allows skipping stages", () => {
    // A referral who already met the manager should not be walked through a
    // screen for the software's benefit.
    const result = checkMove({
      ...base,
      from: stage({ orderIndex: 0 }),
      to: stage({ id: "s4", kind: "INTERVIEW", orderIndex: 4 }),
    });
    expect(result.allowed).toBe(true);
  });

  it("allows moving backwards", () => {
    const result = checkMove({
      ...base,
      from: stage({ orderIndex: 3 }),
      to: stage({ id: "s2", orderIndex: 1 }),
    });
    expect(result.allowed).toBe(true);
  });

  it("refuses to mark someone hired without an accepted offer", () => {
    const result = checkMove({
      ...base,
      from: stage({ orderIndex: 5 }),
      to: stage({ id: "h", kind: "HIRED", orderIndex: 7 }),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("accepted an offer");
  });

  it("allows hired once an offer is accepted, and says to mark them hired", () => {
    const result = checkMove({
      ...base,
      hasAcceptedOffer: true,
      from: stage({ orderIndex: 5 }),
      to: stage({ id: "h", kind: "HIRED", orderIndex: 7 }),
    });
    expect(result.allowed).toBe(true);
    expect(result.effects).toContainEqual({ kind: "MARK_HIRED" });
  });

  it("asks for an assessment when entering an assessment stage", () => {
    const result = checkMove({
      ...base,
      from: stage({ orderIndex: 1 }),
      to: stage({ id: "a", kind: "ASSESSMENT", orderIndex: 2 }),
    });
    expect(result.effects).toContainEqual({ kind: "ISSUE_ASSESSMENT" });
  });

  it("blocks moves on rejected, withdrawn, and hired applications", () => {
    for (const status of ["REJECTED", "WITHDRAWN", "HIRED"]) {
      const result = checkMove({
        ...base,
        applicationStatus: status,
        from: stage({ orderIndex: 0 }),
        to: stage({ id: "s2", orderIndex: 1 }),
      });
      expect(result.allowed).toBe(false);
    }
  });

  it("refuses a move into the stage the application is already in", () => {
    const s = stage({ orderIndex: 1 });
    expect(checkMove({ ...base, from: s, to: s }).allowed).toBe(false);
  });
});
