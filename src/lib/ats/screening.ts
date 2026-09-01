/**
 * Screening answers and knockout evaluation.
 *
 * A knockout marks an application for human review. It never rejects anyone,
 * never sends a rejection, and never hides the application from the pipeline.
 *
 * That restraint is the whole design. Automatic rejection on a self-reported
 * questionnaire answer is how ATSs quietly filter out capable people — the
 * candidate who answers "no" to a degree question but has ten years of the
 * actual work, the person whose visa status is more complicated than a
 * yes/no. The rule fires, a recruiter sees why, and a person decides.
 */

import type { ScreeningQuestionKind } from "@prisma/client";

export type KnockoutOperator = "EQUALS" | "NOT_EQUALS" | "MIN" | "MAX" | "INCLUDES";

export interface ScreeningQuestionRule {
  id: string;
  prompt: string;
  kind: ScreeningQuestionKind;
  required: boolean;
  choices: string[];
  knockout: boolean;
  knockoutOperator: string | null;
  knockoutValue: string | null;
}

export interface SubmittedAnswer {
  questionId: string;
  text?: string | null;
  number?: number | null;
  list?: string[];
}

export interface AnswerValidationIssue {
  questionId: string;
  message: string;
}

/** Reject malformed submissions before they reach the database. */
export function validateAnswers(
  questions: ScreeningQuestionRule[],
  answers: SubmittedAnswer[],
): AnswerValidationIssue[] {
  const issues: AnswerValidationIssue[] = [];
  const byId = new Map(answers.map((a) => [a.questionId, a]));

  for (const q of questions) {
    const a = byId.get(q.id);
    const empty =
      !a ||
      (q.kind === "NUMBER"
        ? a.number == null || Number.isNaN(a.number)
        : q.kind === "MULTI_CHOICE"
          ? (a.list ?? []).length === 0
          : (a.text ?? "").trim() === "");

    if (q.required && empty) {
      issues.push({ questionId: q.id, message: "This question is required." });
      continue;
    }
    if (empty || !a) continue;

    if (q.kind === "SINGLE_CHOICE" && !q.choices.includes(a.text ?? "")) {
      issues.push({ questionId: q.id, message: "Choose one of the listed options." });
    }
    if (q.kind === "MULTI_CHOICE") {
      const unknown = (a.list ?? []).filter((v) => !q.choices.includes(v));
      if (unknown.length > 0) {
        issues.push({ questionId: q.id, message: "Choose from the listed options." });
      }
    }
    if (q.kind === "YES_NO" && !["yes", "no"].includes((a.text ?? "").toLowerCase())) {
      issues.push({ questionId: q.id, message: "Answer yes or no." });
    }
    if (q.kind === "NUMBER" && a.number != null && !Number.isFinite(a.number)) {
      issues.push({ questionId: q.id, message: "Enter a number." });
    }
    if (q.kind === "LONG_TEXT" && (a.text ?? "").length > 5000) {
      issues.push({ questionId: q.id, message: "Please keep this under 5000 characters." });
    }
    if (q.kind === "SHORT_TEXT" && (a.text ?? "").length > 500) {
      issues.push({ questionId: q.id, message: "Please keep this under 500 characters." });
    }
  }
  return issues;
}

export interface KnockoutResult {
  knockedOut: boolean;
  /** Every rule that fired, so the recruiter sees all of them, not just one. */
  reasons: { questionId: string; prompt: string; explanation: string }[];
}

/**
 * Evaluate knockout rules. An unanswered optional question never knocks
 * anybody out — silence is not a failed answer.
 */
export function evaluateKnockouts(
  questions: ScreeningQuestionRule[],
  answers: SubmittedAnswer[],
): KnockoutResult {
  const byId = new Map(answers.map((a) => [a.questionId, a]));
  const reasons: KnockoutResult["reasons"] = [];

  for (const q of questions) {
    if (!q.knockout || !q.knockoutOperator || q.knockoutValue == null) continue;
    const a = byId.get(q.id);
    if (!a) continue;

    const op = q.knockoutOperator as KnockoutOperator;
    const expected = q.knockoutValue;
    let fired = false;
    let explanation = "";

    if (op === "MIN" || op === "MAX") {
      const threshold = Number(expected);
      const actual =
        a.number ?? (a.text != null && a.text !== "" ? Number(a.text) : NaN);
      // A non-numeric answer to a numeric rule is a data problem, not a
      // candidate problem: do not fire.
      if (!Number.isFinite(actual) || !Number.isFinite(threshold)) continue;
      if (op === "MIN" && actual < threshold) {
        fired = true;
        explanation = `Answered ${actual}; the role asks for at least ${threshold}.`;
      }
      if (op === "MAX" && actual > threshold) {
        fired = true;
        explanation = `Answered ${actual}; the role asks for at most ${threshold}.`;
      }
    } else if (op === "INCLUDES") {
      const list = a.list ?? (a.text ? [a.text] : []);
      if (!list.some((v) => v.toLowerCase() === expected.toLowerCase())) {
        fired = true;
        explanation = `Did not select "${expected}".`;
      }
    } else {
      const actual = (a.text ?? "").trim();
      if (actual === "") continue;
      const matches = actual.toLowerCase() === expected.toLowerCase();
      if (op === "EQUALS" && !matches) {
        fired = true;
        explanation = `Answered "${actual}"; the role expects "${expected}".`;
      }
      if (op === "NOT_EQUALS" && matches) {
        fired = true;
        explanation = `Answered "${actual}", which the role rules out.`;
      }
    }

    if (fired) {
      reasons.push({ questionId: q.id, prompt: q.prompt, explanation });
    }
  }

  return { knockedOut: reasons.length > 0, reasons };
}

/** One-line summary stored on the application for list views. */
export function summarizeKnockout(result: KnockoutResult): string | null {
  if (!result.knockedOut) return null;
  if (result.reasons.length === 1) return result.reasons[0].explanation;
  return `${result.reasons.length} screening criteria not met — see the application for detail.`;
}
