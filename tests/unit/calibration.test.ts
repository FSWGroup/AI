import { describe, expect, it } from "vitest";
import {
  calibrateRater,
  calibrateTeam,
  collapseDuplicateAssessments,
  MIN_ASSESSMENTS,
  MIN_OUTCOMES,
  MIN_SHARED,
  MIN_USEFUL_SPREAD,
  type AssessmentRow,
} from "@/lib/calibration/calibration";

const BASE = new Date("2026-06-01T09:00:00Z");

function row(
  raterId: string,
  subjectId: string,
  value: number,
  over: Partial<AssessmentRow> = {},
): AssessmentRow {
  return {
    raterId,
    raterName: raterId.toUpperCase(),
    subjectId,
    value,
    submittedAt: new Date(BASE.getTime() + 60 * 60 * 1000),
    eventAt: BASE,
    source: "SCORECARD",
    ...over,
  };
}

/** n candidates, each seen by `lenient` (always +1) and two steady raters. */
function panel(n: number): AssessmentRow[] {
  const rows: AssessmentRow[] = [];
  for (let i = 0; i < n; i++) {
    const truth = 1 + (i % 3); // 1, 2, 3 cycling
    rows.push(row("steady1", `c${i}`, truth));
    rows.push(row("steady2", `c${i}`, truth));
    rows.push(row("lenient", `c${i}`, Math.min(4, truth + 1)));
  }
  return rows;
}

describe("calibrateRater", () => {
  it("says nothing about a rater with too few assessments", () => {
    const rows = panel(2);
    const c = calibrateRater("lenient", "LENIENT", rows)!;
    expect(c.assessments).toBeLessThan(MIN_ASSESSMENTS);
    expect(c.observations).toHaveLength(1);
    expect(c.observations[0].kind).toBe("TOO_FEW");
  });

  it("detects leniency against the same candidates, not against raw averages", () => {
    const c = calibrateRater("lenient", "LENIENT", panel(12))!;
    expect(c.leniency).toBeCloseTo(1, 5);
    expect(c.tendency).toBe("LENIENT");
    expect(c.observations.some((o) => o.kind === "LENIENT")).toBe(true);
  });

  it("does not call someone lenient for interviewing a stronger pool", () => {
    // finalist_only sees late-stage candidates and rates them 4; everyone
    // agrees with them on every one. Their raw mean is the highest on the
    // team and their calibration is perfect, which is the whole point of
    // pairing.
    const rows: AssessmentRow[] = [];
    for (let i = 0; i < 8; i++) {
      rows.push(row("screener", `early${i}`, 1 + (i % 2)));
      rows.push(row("screener2", `early${i}`, 1 + (i % 2)));
      rows.push(row("finalist_only", `late${i}`, 4));
      rows.push(row("screener", `late${i}`, 4));
    }
    const finalist = calibrateRater("finalist_only", "F", rows)!;
    const screener = calibrateRater("screener", "S", rows)!;
    expect(finalist.ownMean).toBeGreaterThan(screener.ownMean);
    expect(finalist.leniency).toBeCloseTo(0, 5);
    expect(finalist.tendency).toBe("ALIGNED");
  });

  it("flags a rater who gives everyone the same answer", () => {
    const rows: AssessmentRow[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(row("flat", `c${i}`, 3));
      rows.push(row("other", `c${i}`, 1 + (i % 4)));
    }
    const c = calibrateRater("flat", "FLAT", rows)!;
    expect(c.ownSpread).toBe(0);
    const narrow = c.observations.find((o) => o.kind === "NARROW_RANGE");
    expect(narrow).toBeDefined();
    expect(narrow!.finding).toContain("10 of 10");
  });

  it("separates inconsistent disagreement from consistent severity", () => {
    // erratic sits far above the panel on some candidates and far below on
    // others, and the gaps cancel exactly: +2, +1, -1, -2 per block of four.
    const rows: AssessmentRow[] = [];
    const ERRATIC = [3, 3, 2, 2];
    for (let i = 0; i < 12; i++) {
      const truth = 1 + (i % 4);
      rows.push(row("a", `c${i}`, truth));
      rows.push(row("b", `c${i}`, truth));
      rows.push(row("erratic", `c${i}`, ERRATIC[i % 4]));
    }
    const c = calibrateRater("erratic", "E", rows)!;
    // Average gap is zero — a raw leniency check would see nothing wrong.
    expect(c.leniency!).toBeCloseTo(0, 10);
    expect(c.tendency).toBe("ALIGNED");
    // But the agreement correlation catches it.
    expect(c.agreement!).toBeLessThan(0.2);
    expect(c.observations.some((o) => o.kind === "DISAGREES")).toBe(true);
  });

  it("withholds any peer comparison below the shared-candidate floor", () => {
    const rows: AssessmentRow[] = [];
    for (let i = 0; i < 8; i++) rows.push(row("solo", `c${i}`, 1 + (i % 4)));
    // Only two candidates are shared with anyone.
    rows.push(row("other", "c0", 2));
    rows.push(row("other", "c1", 3));
    const c = calibrateRater("solo", "SOLO", rows)!;
    expect(c.sharedSubjects).toBeLessThan(MIN_SHARED);
    expect(c.leniency).toBeNull();
    expect(c.agreement).toBeNull();
    expect(c.tendency).toBe("UNKNOWN");
  });

  it("reports predictive value only above the outcome floor", () => {
    const rows: AssessmentRow[] = [];
    const outcomes = [];
    for (let i = 0; i < 14; i++) {
      rows.push(row("r", `c${i}`, 1 + (i % 4)));
      rows.push(row("peer", `c${i}`, 1 + (i % 4)));
      outcomes.push({ subjectId: `c${i}`, criterion: 1 + (i % 4) });
    }
    const withOutcomes = calibrateRater("r", "R", rows, outcomes)!;
    expect(withOutcomes.outcomeCount).toBe(14);
    expect(withOutcomes.predictiveR).toBeCloseTo(1, 5);
    expect(withOutcomes.observations.some((o) => o.kind === "PREDICTIVE")).toBe(true);

    const few = outcomes.slice(0, MIN_OUTCOMES - 1);
    const withFew = calibrateRater("r", "R", rows, few)!;
    expect(withFew.predictiveR).toBeNull();
  });

  it("flags scorecards written from memory", () => {
    const rows: AssessmentRow[] = [];
    for (let i = 0; i < 8; i++) {
      rows.push(
        row("slow", `c${i}`, 1 + (i % 4), {
          submittedAt: new Date(BASE.getTime() + 100 * 60 * 60 * 1000),
        }),
      );
      rows.push(row("fast", `c${i}`, 1 + (i % 4)));
    }
    const c = calibrateRater("slow", "SLOW", rows)!;
    expect(c.lateCount).toBe(8);
    expect(c.medianHoursToSubmit).toBeCloseTo(100, 5);
    expect(c.observations.some((o) => o.kind === "LATE")).toBe(true);

    const fast = calibrateRater("fast", "FAST", rows)!;
    expect(fast.lateCount).toBe(0);
    expect(fast.observations.some((o) => o.kind === "LATE")).toBe(false);
  });

  it("says so plainly when nothing stands out", () => {
    const rows: AssessmentRow[] = [];
    for (let i = 0; i < 10; i++) {
      const truth = 1 + (i % 4);
      rows.push(row("good", `c${i}`, truth));
      rows.push(row("also_good", `c${i}`, truth));
    }
    const c = calibrateRater("good", "GOOD", rows)!;
    expect(c.observations).toHaveLength(1);
    expect(c.observations[0].kind).toBe("WELL_CALIBRATED");
  });
});

describe("polarized raters", () => {
  it("flags a rater who only ever says strong no or strong yes", () => {
    // High spread and no discrimination at all: a wide-variance check alone
    // would call this the best-calibrated person on the panel.
    const rows: AssessmentRow[] = [];
    for (let i = 0; i < 12; i++) {
      const truth = 1 + (i % 4);
      rows.push(row("a", `c${i}`, truth));
      rows.push(row("b", `c${i}`, truth));
      rows.push(row("binary", `c${i}`, truth <= 2 ? 1 : 4));
    }
    const c = calibrateRater("binary", "BINARY", rows)!;
    expect(c.ownSpread).toBeGreaterThan(MIN_USEFUL_SPREAD);
    const polarized = c.observations.find((o) => o.kind === "POLARIZED");
    expect(polarized).toBeDefined();
    expect(polarized!.finding).toContain("100%");
  });

  it("does not flag a rater who uses the whole scale", () => {
    const rows: AssessmentRow[] = [];
    for (let i = 0; i < 12; i++) {
      const truth = 1 + (i % 4);
      rows.push(row("a", `c${i}`, truth));
      rows.push(row("balanced", `c${i}`, truth));
    }
    const c = calibrateRater("balanced", "B", rows)!;
    expect(c.observations.some((o) => o.kind === "POLARIZED")).toBe(false);
  });
});

describe("headline finding", () => {
  it("puts inconsistency ahead of leniency", () => {
    // A consistent bias can be adjusted for in a debrief; disagreement that
    // varies candidate by candidate cannot, so it leads.
    const rows: AssessmentRow[] = [];
    const ERRATIC = [4, 4, 1, 1];
    for (let i = 0; i < 12; i++) {
      const truth = 1 + (i % 4);
      rows.push(row("a", `c${i}`, truth));
      rows.push(row("b", `c${i}`, truth));
      rows.push(row("messy", `c${i}`, ERRATIC[i % 4]));
    }
    const c = calibrateRater("messy", "M", rows)!;
    expect(c.observations.some((o) => o.kind === "DISAGREES")).toBe(true);
    expect(c.headline).toBe("DISAGREES");
  });

  it("says nothing stands out when nothing does", () => {
    const rows: AssessmentRow[] = [];
    for (let i = 0; i < 10; i++) {
      const truth = 1 + (i % 4);
      rows.push(row("good", `c${i}`, truth));
      rows.push(row("peer", `c${i}`, truth));
    }
    expect(calibrateRater("good", "G", rows)!.headline).toBe("WELL_CALIBRATED");
  });
});

describe("calibrateTeam", () => {
  it("lists raters alphabetically rather than ranking them", () => {
    const team = calibrateTeam(panel(12));
    expect(team.raters.map((r) => r.raterName)).toEqual([
      "LENIENT",
      "STEADY1",
      "STEADY2",
    ]);
  });

  it("measures how far apart the panel is on shared candidates", () => {
    const team = calibrateTeam(panel(12));
    // Per candidate: steady/steady gap 0, and two steady/lenient gaps of 1
    // each — except where the lenient rating hits the ceiling at 4.
    expect(team.panelDisagreement!).toBeGreaterThan(0.4);
    expect(team.panelDisagreement!).toBeLessThan(0.8);
    expect(team.sharedSubjects).toBe(12);
    expect(team.soloSubjects).toBe(0);
  });

  it("warns when most candidates were only seen by one person", () => {
    const rows: AssessmentRow[] = [];
    for (let i = 0; i < 10; i++) rows.push(row("a", `solo${i}`, 3));
    rows.push(row("a", "shared", 3));
    rows.push(row("b", "shared", 2));
    const team = calibrateTeam(rows);
    expect(team.soloSubjects).toBe(10);
    expect(team.sharedSubjects).toBe(1);
    expect(team.warnings.join(" ")).toContain("cannot be calibrated");
  });

  it("says predictive value is unavailable rather than showing nothing", () => {
    const team = calibrateTeam(panel(12), [{ subjectId: "c0", criterion: 3 }]);
    expect(team.warnings.join(" ")).toContain("predictive value is not reported");
  });
});

const dupRow = (
  raterId: string,
  subjectId: string,
  value: number,
  source: "SCORECARD" | "REVIEW" = "SCORECARD",
): AssessmentRow => ({
  raterId,
  raterName: raterId,
  subjectId,
  value,
  submittedAt: new Date("2026-01-01"),
  eventAt: null,
  source,
});
describe("duplicate (rater, candidate) rows", () => {
  const rows: AssessmentRow[] = [
    dupRow("a", "s1", 4), dupRow("a", "s1", 2, "REVIEW"), dupRow("b", "s1", 3),
    ...["s2","s3","s4","s5"].flatMap((s) => [dupRow("a", s, 4), dupRow("b", s, 3)]),
  ];
  it("collapses to one row per pair", () => {
    const out = collapseDuplicateAssessments(rows);
    expect(out).toHaveLength(10);
    expect(out.find((r) => r.raterId === "a" && r.subjectId === "s1")!.value).toBe(3);
  });
  it("counts candidates, not assessments, and never pairs a rater with herself", () => {
    const team = calibrateTeam(rows);
    expect(team.sharedSubjects).toBe(5);
    // Mean |gap| between two DIFFERENT people: s1 is now 3 vs 3 = 0, s2-s5 are 1 each.
    expect(team.panelDisagreement).toBeCloseTo(0.8, 10);
    expect(team.raters.find((r) => r.raterId === "a")!.sharedSubjects).toBe(5);
  });
  it("says nothing about predictive value when there are no raters", () => {
    const empty = calibrateTeam([], [{ subjectId: "s1", criterion: 3 }]);
    expect(empty.warnings.join(" ")).not.toContain("No interviewer yet");
  });
});
