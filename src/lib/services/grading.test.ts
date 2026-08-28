import { describe, it, expect } from "vitest";
import { gradeAttempt, gradeQuestion } from "@/lib/services/grading";

/**
 * Quiz grading.
 *
 * A grading bug writes a wrong score into an immutable completion record, which
 * is then used as evidence that someone was trained. There is no fixing that
 * afterwards, so every question type is tested including the failure shapes:
 * missing answers, malformed answers, and empty configs.
 *
 * `gradeQuestion` and `gradeAttempt` are pure, so this needs no database.
 */

describe("MULTIPLE_CHOICE", () => {
  const config = { options: ["Representative", "Sales Manager", "Nobody"], correctIndex: 1 };

  it("awards full points for the correct index", () => {
    const result = gradeQuestion("MULTIPLE_CHOICE", config, 1, 2);
    expect(result.isCorrect).toBe(true);
    expect(result.pointsEarned).toBe(2);
    expect(result.pointsPossible).toBe(2);
    expect(result.needsManualGrading).toBe(false);
  });

  it("awards nothing for a wrong index", () => {
    const result = gradeQuestion("MULTIPLE_CHOICE", config, 0, 2);
    expect(result.isCorrect).toBe(false);
    expect(result.pointsEarned).toBe(0);
  });

  it("treats an unanswered question as incorrect, not as correct", () => {
    for (const answer of [undefined, null]) {
      const result = gradeQuestion("MULTIPLE_CHOICE", config, answer, 2);
      expect(result.isCorrect).toBe(false);
      expect(result.pointsEarned).toBe(0);
    }
  });

  it("does not credit an out-of-range or non-numeric answer", () => {
    for (const answer of [99, -1, "1", {}, []]) {
      const result = gradeQuestion("MULTIPLE_CHOICE", config, answer, 2);
      expect(result.pointsEarned).toBe(0);
    }
  });
});

describe("MULTIPLE_SELECT", () => {
  const config = { options: ["A", "B", "C", "D"], correctIndexes: [0, 1, 2] };

  it("awards full points for exactly the correct set", () => {
    const result = gradeQuestion("MULTIPLE_SELECT", config, [0, 1, 2], 3);
    expect(result.isCorrect).toBe(true);
    expect(result.pointsEarned).toBe(3);
  });

  it("ignores the order of selections", () => {
    const result = gradeQuestion("MULTIPLE_SELECT", config, [2, 0, 1], 3);
    expect(result.isCorrect).toBe(true);
    expect(result.pointsEarned).toBe(3);
  });

  it("gives partial credit for a subset", () => {
    const result = gradeQuestion("MULTIPLE_SELECT", config, [0, 1], 3);
    expect(result.isCorrect).toBe(false);
    expect(result.pointsEarned).toBeGreaterThan(0);
    expect(result.pointsEarned).toBeLessThan(3);
  });

  it("penalizes an incorrect selection", () => {
    const twoRight = gradeQuestion("MULTIPLE_SELECT", config, [0, 1], 3).pointsEarned;
    const twoRightOneWrong = gradeQuestion("MULTIPLE_SELECT", config, [0, 1, 3], 3).pointsEarned;
    expect(twoRightOneWrong).toBeLessThan(twoRight);
  });

  it("never awards negative points", () => {
    const result = gradeQuestion("MULTIPLE_SELECT", config, [3], 3);
    expect(result.pointsEarned).toBeGreaterThanOrEqual(0);
  });

  it("does not credit selecting everything", () => {
    const result = gradeQuestion("MULTIPLE_SELECT", config, [0, 1, 2, 3], 3);
    expect(result.isCorrect).toBe(false);
    expect(result.pointsEarned).toBeLessThan(3);
  });

  it("treats no selection as zero", () => {
    expect(gradeQuestion("MULTIPLE_SELECT", config, [], 3).pointsEarned).toBe(0);
    expect(gradeQuestion("MULTIPLE_SELECT", config, undefined, 3).pointsEarned).toBe(0);
  });
});

describe("TRUE_FALSE", () => {
  it("grades a true answer", () => {
    expect(gradeQuestion("TRUE_FALSE", { correct: true }, true, 1).isCorrect).toBe(true);
    expect(gradeQuestion("TRUE_FALSE", { correct: true }, false, 1).isCorrect).toBe(false);
  });

  it("grades a false answer", () => {
    expect(gradeQuestion("TRUE_FALSE", { correct: false }, false, 1).isCorrect).toBe(true);
    expect(gradeQuestion("TRUE_FALSE", { correct: false }, true, 1).isCorrect).toBe(false);
  });

  it("does not treat an unanswered question as false-and-correct", () => {
    // The dangerous case: config.correct === false and the answer is missing.
    const result = gradeQuestion("TRUE_FALSE", { correct: false }, undefined, 1);
    expect(result.pointsEarned).toBe(0);
    expect(result.isCorrect).toBe(false);
  });
});

describe("FILL_BLANK", () => {
  const config = { acceptableAnswers: ["check", "check valve", "non-return"] };

  it("accepts any listed answer", () => {
    for (const answer of ["check", "check valve", "non-return"]) {
      expect(gradeQuestion("FILL_BLANK", config, answer, 1).isCorrect).toBe(true);
    }
  });

  it("ignores case and surrounding whitespace", () => {
    expect(gradeQuestion("FILL_BLANK", config, "  CHECK Valve  ", 1).isCorrect).toBe(true);
  });

  it("rejects a wrong answer", () => {
    expect(gradeQuestion("FILL_BLANK", config, "ball", 1).isCorrect).toBe(false);
  });

  it("rejects an empty answer", () => {
    expect(gradeQuestion("FILL_BLANK", config, "", 1).pointsEarned).toBe(0);
    expect(gradeQuestion("FILL_BLANK", config, "   ", 1).pointsEarned).toBe(0);
    expect(gradeQuestion("FILL_BLANK", config, undefined, 1).pointsEarned).toBe(0);
  });
});

describe("SHORT_ANSWER", () => {
  it("credits an answer containing the expected keywords", () => {
    const config = { acceptableKeywords: ["call it", "immediately"] };
    const result = gradeQuestion(
      "SHORT_ANSWER",
      config,
      "I would call IT immediately so the device can be wiped.",
      2,
    );
    expect(result.pointsEarned).toBeGreaterThan(0);
  });

  it("does not credit an answer missing the keywords", () => {
    const config = { acceptableKeywords: ["call it", "immediately"] };
    const result = gradeQuestion("SHORT_ANSWER", config, "I would think about it.", 2);
    expect(result.pointsEarned).toBe(0);
  });

  it("defers to manual grading when configured", () => {
    const config = { manualGrading: true };
    const result = gradeQuestion("SHORT_ANSWER", config, "A thoughtful answer.", 2);
    expect(result.needsManualGrading).toBe(true);
    expect(result.isCorrect).toBeNull();
  });

  it("defers to manual grading when no keywords are configured", () => {
    const result = gradeQuestion("SHORT_ANSWER", {}, "Some answer.", 2);
    expect(result.needsManualGrading).toBe(true);
    expect(result.isCorrect).toBeNull();
  });
});

describe("LONG_ANSWER", () => {
  it("always defers to a human", () => {
    const result = gradeQuestion("LONG_ANSWER", {}, "An extended written response.", 5);
    expect(result.needsManualGrading).toBe(true);
    expect(result.isCorrect).toBeNull();
    expect(result.pointsPossible).toBe(5);
  });
});

describe("MATCHING", () => {
  const config = {
    pairs: [
      { left: "Ball valve", right: "Quarter-turn on/off isolation" },
      { left: "Globe valve", right: "Throttling and flow regulation" },
      { left: "Check valve", right: "Preventing backflow" },
      { left: "Control valve", right: "Precise automated modulation" },
    ],
  };

  it("awards full points for all pairs matched", () => {
    const result = gradeQuestion("MATCHING", config, [0, 1, 2, 3], 4);
    expect(result.isCorrect).toBe(true);
    expect(result.pointsEarned).toBe(4);
  });

  it("gives per-pair credit for a partial match", () => {
    // First two correct, last two swapped.
    const result = gradeQuestion("MATCHING", config, [0, 1, 3, 2], 4);
    expect(result.isCorrect).toBe(false);
    expect(result.pointsEarned).toBe(2);
  });

  it("awards nothing for all pairs wrong", () => {
    const result = gradeQuestion("MATCHING", config, [1, 0, 3, 2], 4);
    expect(result.pointsEarned).toBe(0);
  });

  it("handles a missing or malformed answer", () => {
    expect(gradeQuestion("MATCHING", config, undefined, 4).pointsEarned).toBe(0);
    expect(gradeQuestion("MATCHING", config, "nope", 4).pointsEarned).toBe(0);
    expect(gradeQuestion("MATCHING", config, [0], 4).pointsEarned).toBeLessThan(4);
  });
});

describe("ORDERING", () => {
  const config = {
    items: [
      "Confirm the customer account and ship-to",
      "Add line items with quantities",
      "Check stock and lead time",
      "Apply pricing from the current price sheet",
      "Send the quote and log the send date",
      "Create a three-day follow-up task",
    ],
  };

  it("awards full points for the correct order", () => {
    const result = gradeQuestion("ORDERING", config, [0, 1, 2, 3, 4, 5], 3);
    expect(result.isCorrect).toBe(true);
    expect(result.pointsEarned).toBe(3);
  });

  it("gives partial credit for a nearly-correct order", () => {
    // One adjacent swap near the end.
    const result = gradeQuestion("ORDERING", config, [0, 1, 2, 3, 5, 4], 3);
    expect(result.isCorrect).toBe(false);
    expect(result.pointsEarned).toBeGreaterThan(0);
    expect(result.pointsEarned).toBeLessThan(3);
  });

  it("scores a fully reversed order below a nearly-correct one", () => {
    const nearly = gradeQuestion("ORDERING", config, [0, 1, 2, 3, 5, 4], 3).pointsEarned;
    const reversed = gradeQuestion("ORDERING", config, [5, 4, 3, 2, 1, 0], 3).pointsEarned;
    expect(reversed).toBeLessThan(nearly);
  });

  it("handles a missing or malformed answer", () => {
    expect(gradeQuestion("ORDERING", config, undefined, 3).pointsEarned).toBe(0);
    expect(gradeQuestion("ORDERING", config, {}, 3).pointsEarned).toBe(0);
  });
});

describe("SCENARIO", () => {
  const config = {
    choices: [
      { id: "s1", label: "Update the bank details", correct: false },
      { id: "s2", label: "Reply and ask them to confirm", correct: false },
      { id: "s3", label: "Call the number already on file", correct: true },
    ],
  };

  it("credits the correct choice", () => {
    const result = gradeQuestion("SCENARIO", config, "s3", 3);
    expect(result.isCorrect).toBe(true);
    expect(result.pointsEarned).toBe(3);
  });

  it("does not credit an incorrect choice", () => {
    expect(gradeQuestion("SCENARIO", config, "s1", 3).pointsEarned).toBe(0);
  });

  it("does not credit an unknown choice id", () => {
    expect(gradeQuestion("SCENARIO", config, "s99", 3).pointsEarned).toBe(0);
    expect(gradeQuestion("SCENARIO", config, undefined, 3).pointsEarned).toBe(0);
  });
});

describe("FILE_SUBMISSION", () => {
  it("defers to a human when a file was submitted", () => {
    const result = gradeQuestion("FILE_SUBMISSION", {}, { mediaId: "media_1" }, 5);
    expect(result.needsManualGrading).toBe(true);
    expect(result.isCorrect).toBeNull();
  });

  it("does not award points for nothing submitted", () => {
    const result = gradeQuestion("FILE_SUBMISSION", {}, undefined, 5);
    expect(result.pointsEarned).toBe(0);
  });
});

describe("malformed configs fail closed", () => {
  it("awards no points when the config is empty or wrong-shaped", () => {
    for (const config of [{}, null, undefined, "nonsense", []]) {
      const result = gradeQuestion("MULTIPLE_CHOICE", config, 0, 2);
      expect(result.pointsEarned).toBe(0);
    }
  });

  it("does not throw on any type with garbage input", () => {
    const types = [
      "MULTIPLE_CHOICE",
      "MULTIPLE_SELECT",
      "TRUE_FALSE",
      "FILL_BLANK",
      "SHORT_ANSWER",
      "LONG_ANSWER",
      "MATCHING",
      "ORDERING",
      "SCENARIO",
      "FILE_SUBMISSION",
    ] as const;

    for (const type of types) {
      expect(() => gradeQuestion(type, { junk: true }, { junk: true }, 1)).not.toThrow();
    }
  });
});

describe("gradeAttempt", () => {
  const questions = [
    {
      id: "q1",
      type: "MULTIPLE_CHOICE" as const,
      config: { options: ["A", "B"], correctIndex: 1 },
      points: 2,
    },
    { id: "q2", type: "TRUE_FALSE" as const, config: { correct: true }, points: 1 },
    {
      id: "q3",
      type: "MULTIPLE_SELECT" as const,
      config: { options: ["A", "B", "C"], correctIndexes: [0, 1] },
      points: 2,
    },
  ];

  it("computes a perfect score", () => {
    const summary = gradeAttempt(questions, { q1: 1, q2: true, q3: [0, 1] });
    expect(summary.pointsEarned).toBe(5);
    expect(summary.pointsPossible).toBe(5);
    expect(summary.scorePercent).toBe(100);
    expect(summary.hasPendingManualGrading).toBe(false);
  });

  it("computes a zero score", () => {
    const summary = gradeAttempt(questions, { q1: 0, q2: false, q3: [2] });
    expect(summary.pointsEarned).toBe(0);
    expect(summary.scorePercent).toBe(0);
  });

  it("weights questions by their point value, not by count", () => {
    // q1 alone is 2 of 5 points — 40%, not one-third.
    const summary = gradeAttempt(questions, { q1: 1, q2: false, q3: [2] });
    expect(summary.pointsEarned).toBe(2);
    expect(summary.scorePercent).toBe(40);
  });

  it("counts unanswered questions against the score", () => {
    const summary = gradeAttempt(questions, { q1: 1 });
    expect(summary.pointsPossible).toBe(5);
    expect(summary.pointsEarned).toBe(2);
    expect(summary.scorePercent).toBe(40);
  });

  it("reports pending manual grading", () => {
    const withEssay = [
      ...questions,
      { id: "q4", type: "LONG_ANSWER" as const, config: {}, points: 5 },
    ];
    const summary = gradeAttempt(withEssay, { q1: 1, q2: true, q3: [0, 1], q4: "An answer." });
    expect(summary.hasPendingManualGrading).toBe(true);
    // The manual question still contributes to the possible total.
    expect(summary.pointsPossible).toBe(10);
  });

  it("returns a per-question breakdown", () => {
    const summary = gradeAttempt(questions, { q1: 1, q2: false, q3: [0, 1] });
    expect(summary.perQuestion.q1?.isCorrect).toBe(true);
    expect(summary.perQuestion.q2?.isCorrect).toBe(false);
    expect(summary.perQuestion.q3?.isCorrect).toBe(true);
  });

  it("scores an empty question set as zero rather than dividing by zero", () => {
    const summary = gradeAttempt([], {});
    expect(summary.scorePercent).toBe(0);
    expect(summary.pointsPossible).toBe(0);
    expect(Number.isNaN(summary.scorePercent)).toBe(false);
  });

  it("rounds the percentage without accumulating float error", () => {
    const thirds = [
      { id: "a", type: "TRUE_FALSE" as const, config: { correct: true }, points: 1 },
      { id: "b", type: "TRUE_FALSE" as const, config: { correct: true }, points: 1 },
      { id: "c", type: "TRUE_FALSE" as const, config: { correct: true }, points: 1 },
    ];
    const summary = gradeAttempt(thirds, { a: true, b: false, c: false });
    // 1 of 3 → 33.33, not 33.33333333333333
    expect(summary.scorePercent).toBeCloseTo(33.33, 2);
    expect(String(summary.scorePercent).length).toBeLessThan(8);
  });
});

describe("pass thresholds behave at the boundary", () => {
  const questions = Array.from({ length: 10 }, (_, i) => ({
    id: `q${i}`,
    type: "TRUE_FALSE" as const,
    config: { correct: true },
    points: 1,
  }));

  it("scores exactly at an 80% threshold", () => {
    const answers: Record<string, unknown> = {};
    questions.forEach((q, i) => {
      answers[q.id] = i < 8;
    });
    const summary = gradeAttempt(questions, answers);
    expect(summary.scorePercent).toBe(80);
    // A passing score of 80 must treat exactly 80 as a pass, not a fail.
    expect(summary.scorePercent >= 80).toBe(true);
  });

  it("scores just below the threshold", () => {
    const answers: Record<string, unknown> = {};
    questions.forEach((q, i) => {
      answers[q.id] = i < 7;
    });
    const summary = gradeAttempt(questions, answers);
    expect(summary.scorePercent).toBe(70);
    expect(summary.scorePercent >= 80).toBe(false);
  });
});
