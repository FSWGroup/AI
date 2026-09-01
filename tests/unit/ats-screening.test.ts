import { describe, it, expect } from "vitest";
import {
  evaluateKnockouts,
  validateAnswers,
  summarizeKnockout,
  type ScreeningQuestionRule,
} from "@/lib/ats/screening";

function q(over: Partial<ScreeningQuestionRule>): ScreeningQuestionRule {
  return {
    id: "q1",
    prompt: "Question?",
    kind: "SHORT_TEXT",
    required: false,
    choices: [],
    knockout: false,
    knockoutOperator: null,
    knockoutValue: null,
    ...over,
  };
}

describe("validateAnswers", () => {
  it("requires answers only to required questions", () => {
    const questions = [q({ id: "a", required: true }), q({ id: "b" })];
    expect(validateAnswers(questions, [])).toEqual([
      { questionId: "a", message: "This question is required." },
    ]);
  });

  it("treats whitespace as unanswered", () => {
    const questions = [q({ id: "a", required: true })];
    expect(validateAnswers(questions, [{ questionId: "a", text: "   " }])).toHaveLength(1);
  });

  it("rejects choices outside the offered options", () => {
    const questions = [
      q({ id: "a", kind: "SINGLE_CHOICE", choices: ["Yes", "No"] }),
    ];
    expect(validateAnswers(questions, [{ questionId: "a", text: "Maybe" }])).toHaveLength(1);
    expect(validateAnswers(questions, [{ questionId: "a", text: "Yes" }])).toHaveLength(0);
  });

  it("accepts a multi-choice answer drawn from the options", () => {
    const questions = [
      q({ id: "a", kind: "MULTI_CHOICE", choices: ["PHP", "JS", "Go"] }),
    ];
    expect(
      validateAnswers(questions, [{ questionId: "a", list: ["PHP", "Go"] }]),
    ).toHaveLength(0);
    expect(
      validateAnswers(questions, [{ questionId: "a", list: ["PHP", "Rust"] }]),
    ).toHaveLength(1);
  });
});

describe("evaluateKnockouts", () => {
  it("fires MIN when the answer is under the threshold", () => {
    const questions = [
      q({
        id: "yrs",
        prompt: "Years of experience?",
        kind: "NUMBER",
        knockout: true,
        knockoutOperator: "MIN",
        knockoutValue: "3",
      }),
    ];
    const under = evaluateKnockouts(questions, [{ questionId: "yrs", number: 1 }]);
    expect(under.knockedOut).toBe(true);
    expect(under.reasons[0].explanation).toContain("at least 3");

    const over = evaluateKnockouts(questions, [{ questionId: "yrs", number: 5 }]);
    expect(over.knockedOut).toBe(false);
  });

  it("treats the threshold itself as passing", () => {
    const questions = [
      q({ id: "yrs", kind: "NUMBER", knockout: true, knockoutOperator: "MIN", knockoutValue: "3" }),
    ];
    expect(
      evaluateKnockouts(questions, [{ questionId: "yrs", number: 3 }]).knockedOut,
    ).toBe(false);
  });

  it("never fires on an unanswered question", () => {
    const questions = [
      q({ id: "a", knockout: true, knockoutOperator: "EQUALS", knockoutValue: "Yes" }),
    ];
    expect(evaluateKnockouts(questions, []).knockedOut).toBe(false);
    expect(
      evaluateKnockouts(questions, [{ questionId: "a", text: "" }]).knockedOut,
    ).toBe(false);
  });

  it("does not fire a numeric rule on a non-numeric answer", () => {
    // A data problem must not become a candidate problem.
    const questions = [
      q({ id: "a", knockout: true, knockoutOperator: "MIN", knockoutValue: "3" }),
    ];
    expect(
      evaluateKnockouts(questions, [{ questionId: "a", text: "about four" }]).knockedOut,
    ).toBe(false);
  });

  it("compares text case-insensitively", () => {
    const questions = [
      q({ id: "a", knockout: true, knockoutOperator: "EQUALS", knockoutValue: "Yes" }),
    ];
    expect(
      evaluateKnockouts(questions, [{ questionId: "a", text: "yes" }]).knockedOut,
    ).toBe(false);
    expect(
      evaluateKnockouts(questions, [{ questionId: "a", text: "no" }]).knockedOut,
    ).toBe(true);
  });

  it("reports every rule that fired, not just the first", () => {
    const questions = [
      q({ id: "a", prompt: "A?", knockout: true, knockoutOperator: "EQUALS", knockoutValue: "Yes" }),
      q({ id: "b", prompt: "B?", knockout: true, knockoutOperator: "EQUALS", knockoutValue: "Yes" }),
    ];
    const result = evaluateKnockouts(questions, [
      { questionId: "a", text: "No" },
      { questionId: "b", text: "No" },
    ]);
    expect(result.reasons).toHaveLength(2);
    expect(summarizeKnockout(result)).toContain("2 screening criteria");
  });

  it("ignores questions that have no knockout rule configured", () => {
    const questions = [q({ id: "a", knockout: true, knockoutOperator: null })];
    expect(
      evaluateKnockouts(questions, [{ questionId: "a", text: "anything" }]).knockedOut,
    ).toBe(false);
  });

  it("handles INCLUDES against a multi-select answer", () => {
    const questions = [
      q({
        id: "a",
        kind: "MULTI_CHOICE",
        knockout: true,
        knockoutOperator: "INCLUDES",
        knockoutValue: "Night shift",
      }),
    ];
    expect(
      evaluateKnockouts(questions, [{ questionId: "a", list: ["Day shift"] }]).knockedOut,
    ).toBe(true);
    expect(
      evaluateKnockouts(questions, [
        { questionId: "a", list: ["Day shift", "Night shift"] },
      ]).knockedOut,
    ).toBe(false);
  });
});
