import { describe, expect, it } from "vitest";
import {
  DIVERGENT_LEVELS,
  canSeeOtherGrades,
  canStart,
  canSubmit,
  effectiveAssignmentStatus,
  fileTypeAllowed,
  remainingSeconds,
  scoreGrade,
  summarizeGrades,
  validateCandidateSubmission,
  validateGradeSubmission,
  validateRubric,
  visibleGrades,
  type CriterionLike,
  type GradeLike,
} from "@/lib/worksample/rubric";

const NOW = new Date("2026-09-01T12:00:00Z");

function anchors(): { level: number; text: string }[] {
  return [
    { level: 1, text: "Did not attempt this part of the task." },
    { level: 2, text: "Attempted it but the result would need redoing." },
    { level: 3, text: "Usable as delivered, with normal review." },
    { level: 4, text: "Better than most people already doing this job." },
  ];
}

function criterion(id: string, over: Partial<CriterionLike> = {}): CriterionLike {
  return {
    id,
    name: id,
    description: null,
    anchors: anchors(),
    weight: 1,
    orderIndex: 0,
    ...over,
  };
}

function grade(
  graderId: string,
  levels: Record<string, number | null>,
  over: Partial<GradeLike> = {},
): GradeLike {
  return {
    id: `g-${graderId}`,
    graderId,
    graderName: graderId.toUpperCase(),
    status: "SUBMITTED",
    comment: "Reviewed the submission against each row of the rubric.",
    submittedAt: NOW,
    reconciled: false,
    ratings: Object.entries(levels).map(([criterionId, level]) => ({
      criterionId,
      criterionName: criterionId,
      level,
      note: null,
    })),
    ...over,
  };
}

describe("validateRubric", () => {
  it("accepts a well-formed rubric", () => {
    expect(validateRubric([criterion("clarity"), criterion("correctness")])).toEqual([]);
  });

  it("rejects an empty rubric", () => {
    expect(validateRubric([])[0].message).toContain("at least one criterion");
  });

  it("insists every level is anchored in writing", () => {
    const missing = criterion("clarity", {
      anchors: anchors().filter((a) => a.level !== 3),
    });
    const problems = validateRubric([missing]);
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("Level 3 has no written anchor");
  });

  it("rejects an anchor too short to distinguish anything", () => {
    const vague = criterion("clarity", {
      anchors: [...anchors().filter((a) => a.level !== 2), { level: 2, text: "ok" }],
    });
    expect(validateRubric([vague])[0].message).toContain("too short");
  });

  it("rejects duplicate names and non-positive weights", () => {
    const problems = validateRubric([
      criterion("a", { name: "Clarity" }),
      criterion("b", { name: "clarity" }),
      criterion("c", { name: "Depth", weight: 0 }),
    ]);
    expect(problems.some((p) => p.message.includes("same name"))).toBe(true);
    expect(problems.some((p) => p.message.includes("greater than zero"))).toBe(true);
  });

  it("warns when there are more criteria than a grader can hold", () => {
    const many = Array.from({ length: 9 }, (_, i) => criterion(`c${i}`));
    expect(validateRubric(many).some((p) => p.message.includes("halo"))).toBe(true);
  });
});

describe("scoreGrade", () => {
  const criteria = [
    criterion("speed", { weight: 1 }),
    criterion("quality", { weight: 3 }),
  ];

  it("weights criteria as configured", () => {
    const out = scoreGrade(grade("g1", { speed: 2, quality: 4 }), criteria);
    expect(out.score).toBeCloseTo((2 * 1 + 4 * 3) / 4, 10);
  });

  it("renormalizes rather than scoring an unassessable criterion as zero", () => {
    // "Could not tell from what was submitted" is a fact about the
    // submission. Scoring it 1 would turn it into a judgement of the person.
    const out = scoreGrade(grade("g1", { speed: null, quality: 4 }), criteria);
    expect(out.score).toBe(4);
    expect(out.unassessed).toEqual(["speed"]);
    expect(out.assessedCount).toBe(1);
  });

  it("returns null when nothing was assessable", () => {
    const out = scoreGrade(grade("g1", { speed: null, quality: null }), criteria);
    expect(out.score).toBeNull();
  });
});

describe("summarizeGrades", () => {
  const criteria = [criterion("speed"), criterion("quality", { orderIndex: 1 })];

  it("is incomplete until enough independent grades are in", () => {
    const out = summarizeGrades([grade("g1", { speed: 3, quality: 3 })], criteria, 2);
    expect(out.submittedCount).toBe(1);
    expect(out.complete).toBe(false);
    expect(out.needsReconciliation).toBe(false);
  });

  it("ignores drafts", () => {
    const out = summarizeGrades(
      [
        grade("g1", { speed: 3, quality: 3 }),
        grade("g2", { speed: 1, quality: 1 }, { status: "DRAFT", submittedAt: null }),
      ],
      criteria,
      2,
    );
    expect(out.submittedCount).toBe(1);
  });

  it("calls for reconciliation when graders are far apart on one criterion", () => {
    const out = summarizeGrades(
      [grade("g1", { speed: 4, quality: 3 }), grade("g2", { speed: 2, quality: 3 })],
      criteria,
      2,
    );
    expect(out.criteria.find((c) => c.criterionName === "speed")!.range).toBe(
      DIVERGENT_LEVELS,
    );
    expect(out.needsReconciliation).toBe(true);
    expect(out.reconciliationReason).toContain("Averaging that");
  });

  it("catches a wide overall gap that no single criterion explains", () => {
    const out = summarizeGrades(
      [grade("g1", { speed: 4, quality: 4 }), grade("g2", { speed: 3, quality: 3 })],
      criteria,
      2,
    );
    expect(out.criteria.every((c) => !c.divergent)).toBe(true);
    expect(out.needsReconciliation).toBe(true);
    expect(out.reconciliationReason).toContain("weighted the work differently");
  });

  it("does not ask for reconciliation when graders agree", () => {
    const out = summarizeGrades(
      [grade("g1", { speed: 3, quality: 4 }), grade("g2", { speed: 3, quality: 3 })],
      criteria,
      2,
    );
    expect(out.complete).toBe(true);
    expect(out.needsReconciliation).toBe(false);
    expect(out.meanScore).toBeCloseTo(3.25, 10);
    expect(out.scoreRange).toBeCloseTo(0.5, 10);
  });
});

describe("the blind", () => {
  const grades = [
    grade("author", { speed: 3 }),
    grade("other", { speed: 4 }),
    grade("pending", { speed: 2 }, { status: "DRAFT", submittedAt: null }),
  ];

  const GRADER = { canGrade: true, hasOversight: false };
  const OVERSIGHT = { canGrade: false, hasOversight: true };

  it("hides other grades until yours is filed", () => {
    const drafting = [
      grade("me", { speed: 3 }, { status: "DRAFT", submittedAt: null }),
      grade("other", { speed: 4 }),
    ];
    expect(canSeeOtherGrades("me", drafting)).toBe(false);
    const out = visibleGrades(drafting, "me", GRADER);
    expect(out.visible).toHaveLength(0);
    expect(out.hiddenCount).toBe(1);
  });

  it("opens them once you have committed", () => {
    expect(canSeeOtherGrades("author", grades)).toBe(true);
    expect(visibleGrades(grades, "author", GRADER).visible).toHaveLength(2);
  });

  it("lets oversight who cannot grade read everything", () => {
    const out = visibleGrades(grades, "recruiter", OVERSIGHT);
    expect(out.visible).toHaveLength(2);
    expect(out.hiddenCount).toBe(0);
  });

  it("keeps a grader under the blind even with the oversight permission", () => {
    // Otherwise the control is defeated by whoever most wants to defeat it.
    const drafting = [
      grade("boss", { speed: 3 }, { status: "DRAFT", submittedAt: null }),
      grade("other", { speed: 4 }),
    ];
    const out = visibleGrades(drafting, "boss", {
      canGrade: true,
      hasOversight: true,
    });
    expect(out.visible).toHaveLength(0);
    expect(out.hiddenCount).toBe(1);
  });

  it("keeps a grader who has not started under the blind", () => {
    // The dangerous case: a grader with oversight who has no grade row yet.
    // Keying the blind off "has a grade row" would treat them as a bystander
    // at exactly the moment their view is most easily contaminated.
    const out = visibleGrades(grades, "not-started-yet", {
      canGrade: true,
      hasOversight: true,
    });
    expect(out.visible).toHaveLength(0);
    expect(out.hiddenCount).toBe(2);
  });

  it("shows nothing to someone with neither permission", () => {
    const out = visibleGrades(grades, "stranger", {
      canGrade: false,
      hasOversight: false,
    });
    expect(out.visible).toHaveLength(0);
  });
});

describe("validateGradeSubmission", () => {
  const criteria = [criterion("speed"), criterion("quality")];
  const goodComment = "The parser handles the sample input but drops the trailing case.";

  it("accepts a complete grade", () => {
    expect(
      validateGradeSubmission(
        {
          ratings: [
            { criterionId: "speed", level: 3, note: null },
            { criterionId: "quality", level: 2, note: null },
          ],
          comment: goodComment,
        },
        criteria,
      ),
    ).toEqual([]);
  });

  it("requires every criterion to be addressed", () => {
    const errors = validateGradeSubmission(
      { ratings: [{ criterionId: "speed", level: 3, note: null }], comment: goodComment },
      criteria,
    );
    expect(errors[0]).toContain("could not assess");
  });

  it("requires written evidence for the levels", () => {
    const errors = validateGradeSubmission(
      {
        ratings: [
          { criterionId: "speed", level: 3, note: null },
          { criterionId: "quality", level: 2, note: null },
        ],
        comment: "good",
      },
      criteria,
    );
    expect(errors[0]).toContain("cannot be reconciled");
  });

  it("refuses a grade where nothing was assessed", () => {
    const errors = validateGradeSubmission(
      {
        ratings: [
          { criterionId: "speed", level: null, note: null },
          { criterionId: "quality", level: null, note: null },
        ],
        comment: goodComment,
      },
      criteria,
    );
    expect(errors.some((e) => e.includes("do not file an empty grade"))).toBe(true);
  });
});

describe("effectiveAssignmentStatus", () => {
  // Expiry is derived at read time rather than written by a cron, so a job
  // that failed to run cannot leave the admin list showing a stale status.
  it("reports an overdue assignment as expired without anything having run", () => {
    expect(
      effectiveAssignmentStatus(
        { status: "ASSIGNED", dueAt: new Date(NOW.getTime() - 1000) },
        NOW,
      ),
    ).toBe("EXPIRED");
  });

  it("leaves an assignment inside its window alone", () => {
    expect(
      effectiveAssignmentStatus(
        { status: "ASSIGNED", dueAt: new Date(NOW.getTime() + 1000) },
        NOW,
      ),
    ).toBe("ASSIGNED");
  });

  it("never overrides a status the candidate has already moved past", () => {
    // Somebody who started before the deadline and is mid-task must not have
    // their work reported as expired out from under them.
    for (const status of ["STARTED", "SUBMITTED", "GRADED", "WITHDRAWN"]) {
      expect(
        effectiveAssignmentStatus(
          { status, dueAt: new Date(NOW.getTime() - 86_400_000) },
          NOW,
        ),
      ).toBe(status);
    }
  });
});

describe("the candidate's side", () => {
  it("runs the clock on the server", () => {
    expect(
      remainingSeconds(
        { startedAt: NOW, expiresAt: new Date(NOW.getTime() + 90_000) },
        NOW,
      ),
    ).toBe(90);
    expect(
      remainingSeconds({ startedAt: NOW, expiresAt: new Date(NOW.getTime() - 1) }, NOW),
    ).toBe(0);
    expect(remainingSeconds({ startedAt: NOW, expiresAt: null }, NOW)).toBeNull();
  });

  it("closes the window after the due date", () => {
    const late = canStart(
      { status: "ASSIGNED", dueAt: new Date(NOW.getTime() - 1000) },
      NOW,
    );
    expect(late.ok).toBe(false);
    expect(canStart({ status: "ASSIGNED", dueAt: new Date(NOW.getTime() + 1000) }, NOW).ok).toBe(true);
  });

  it("refuses a second submission", () => {
    expect(canStart({ status: "SUBMITTED", dueAt: new Date(NOW.getTime() + 1000) }, NOW).ok).toBe(false);
  });

  it("allows a submission that lands seconds late but not minutes", () => {
    const expiresAt = new Date(NOW.getTime() - 10_000);
    expect(canSubmit({ status: "STARTED", expiresAt }, NOW).ok).toBe(true);
    const wayLate = new Date(NOW.getTime() - 120_000);
    expect(canSubmit({ status: "STARTED", expiresAt: wayLate }, NOW).ok).toBe(false);
  });

  it("checks what the task actually asked for", () => {
    expect(validateCandidateSubmission({ text: "", hasFile: true }, "TEXT")).toHaveLength(1);
    expect(validateCandidateSubmission({ text: "answer", hasFile: false }, "FILE")).toHaveLength(1);
    expect(validateCandidateSubmission({ text: "", hasFile: false }, "TEXT_AND_FILE")).toHaveLength(2);
    expect(validateCandidateSubmission({ text: "answer", hasFile: true }, "TEXT_AND_FILE")).toEqual([]);
  });

  it("matches file types case- and dot-insensitively", () => {
    expect(fileTypeAllowed("Answer.PDF", ["pdf", "docx"])).toBe(true);
    expect(fileTypeAllowed("answer.pdf", [".PDF"])).toBe(true);
    expect(fileTypeAllowed("answer.exe", ["pdf"])).toBe(false);
    expect(fileTypeAllowed("noextension", ["pdf"])).toBe(false);
    // An empty allowlist is a refusal, not a wildcard: a TEXT task never
    // gets asked for a list, and "accepts anything" is how an executable
    // arrives.
    expect(fileTypeAllowed("anything.zip", [])).toBe(false);
  });
});
