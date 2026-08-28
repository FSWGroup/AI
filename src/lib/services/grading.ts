/**
 * Quiz grading — pure logic.
 *
 * Dependency-free by design: no database, no session, no clock. A grading bug
 * writes a wrong score into an immutable completion record that is later used as
 * evidence someone was trained, and there is no fixing that after the fact — so
 * this logic is kept isolated and tested exhaustively against fixtures.
 *
 * Answer shapes are canonical: indices refer to the question config's arrays in
 * their original, unshuffled order. The lesson player maps a shuffled on-screen
 * order back to canonical indices before grading.
 */

import { QuestionType } from "@prisma/client";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface GradeResult {
  /** null = correctness is not yet known (awaiting manual grading). */
  isCorrect: boolean | null;
  pointsEarned: number;
  pointsPossible: number;
  needsManualGrading: boolean;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Grade a single answer against its question config. Pure function: same
 * inputs always produce the same output, no side effects.
 *
 * Answer shapes expected per type (all "canonical" — i.e. indices refer to the
 * question's config arrays in their original, unshuffled order; the lesson
 * player is responsible for mapping a shuffled on-screen order back to these
 * canonical indices before calling submitAttempt):
 *  - MULTIPLE_CHOICE: number (selected option index)
 *  - MULTIPLE_SELECT: number[] (selected option indices)
 *  - TRUE_FALSE: boolean
 *  - FILL_BLANK: string
 *  - SHORT_ANSWER: string
 *  - LONG_ANSWER: string
 *  - MATCHING: number[] where answer[i] is the pairs-index matched to pairs[i].left
 *  - ORDERING: number[], a permutation of 0..items.length-1 in the learner's chosen order
 *  - SCENARIO: string (chosen choice id)
 *  - FILE_SUBMISSION: { mediaId?: string; note?: string }
 *  - APPLICATION: Record<dimensionId, optionId> — one selection per dimension
 */
export function gradeQuestion(type: QuestionType, config: unknown, answer: unknown, points: number): GradeResult {
  const cfg = asRecord(config);
  const pointsPossible = points;

  switch (type) {
    case "MULTIPLE_CHOICE": {
      const correctIndex = typeof cfg.correctIndex === "number" ? cfg.correctIndex : -1;
      const given = typeof answer === "number" ? answer : -1;
      const isCorrect = given === correctIndex && correctIndex >= 0;
      return { isCorrect, pointsEarned: isCorrect ? points : 0, pointsPossible, needsManualGrading: false };
    }

    case "MULTIPLE_SELECT": {
      const correctIndexes = new Set<number>(Array.isArray(cfg.correctIndexes) ? (cfg.correctIndexes as number[]) : []);
      const selected = new Set<number>(Array.isArray(answer) ? (answer as number[]) : []);
      let correctSelected = 0;
      let incorrectSelected = 0;
      for (const idx of selected) {
        if (correctIndexes.has(idx)) correctSelected += 1;
        else incorrectSelected += 1;
      }
      const totalCorrect = correctIndexes.size || 1;
      const ratio = Math.max(0, Math.min(1, (correctSelected - incorrectSelected) / totalCorrect));
      const pointsEarned = round2(points * ratio);
      const isCorrect = correctSelected === correctIndexes.size && incorrectSelected === 0 && correctIndexes.size > 0;
      return { isCorrect, pointsEarned, pointsPossible, needsManualGrading: false };
    }

    case "TRUE_FALSE": {
      const correct = Boolean(cfg.correct);
      // The answer must be an actual boolean. Coercing with Boolean() would
      // turn an unanswered question (undefined) into `false`, silently awarding
      // full marks whenever the correct answer happens to be false.
      if (typeof answer !== "boolean") {
        return { isCorrect: false, pointsEarned: 0, pointsPossible, needsManualGrading: false };
      }
      const isCorrect = correct === answer;
      return { isCorrect, pointsEarned: isCorrect ? points : 0, pointsPossible, needsManualGrading: false };
    }

    case "FILL_BLANK": {
      const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
      const accepted = (Array.isArray(cfg.acceptableAnswers) ? (cfg.acceptableAnswers as string[]) : []).map(normalize);
      const given = normalize(typeof answer === "string" ? answer : "");
      const isCorrect = given.length > 0 && accepted.includes(given);
      return { isCorrect, pointsEarned: isCorrect ? points : 0, pointsPossible, needsManualGrading: false };
    }

    case "SHORT_ANSWER": {
      const keywords = (Array.isArray(cfg.acceptableKeywords) ? (cfg.acceptableKeywords as string[]) : []).map((k) =>
        k.toLowerCase().trim(),
      );
      const text = (typeof answer === "string" ? answer : "").toLowerCase();
      const matched = keywords.filter((k) => k.length > 0 && text.includes(k));
      const threshold =
        typeof cfg.keywordThreshold === "number" && cfg.keywordThreshold > 0 ? cfg.keywordThreshold : 1;
      const manualGrading = Boolean(cfg.manualGrading);

      if (keywords.length > 0 && matched.length >= threshold) {
        return { isCorrect: true, pointsEarned: points, pointsPossible, needsManualGrading: false };
      }
      // With no keywords configured there is nothing to grade against, so defer
      // to a human rather than recording a definitive "incorrect". Marking an
      // ungradeable answer wrong would penalize the learner for an authoring
      // omission, and the result lands in an immutable record.
      if (manualGrading || keywords.length === 0) {
        return { isCorrect: null, pointsEarned: 0, pointsPossible, needsManualGrading: true };
      }
      return { isCorrect: false, pointsEarned: 0, pointsPossible, needsManualGrading: false };
    }

    case "LONG_ANSWER":
      return { isCorrect: null, pointsEarned: 0, pointsPossible, needsManualGrading: true };

    case "MATCHING": {
      const pairs = Array.isArray(cfg.pairs) ? (cfg.pairs as { left: string; right: string }[]) : [];
      const answerArr = Array.isArray(answer) ? (answer as number[]) : [];
      let correctCount = 0;
      pairs.forEach((_, i) => {
        if (answerArr[i] === i) correctCount += 1;
      });
      const total = pairs.length || 1;
      const pointsEarned = round2(points * (correctCount / total));
      const isCorrect = pairs.length > 0 && correctCount === pairs.length;
      return { isCorrect, pointsEarned, pointsPossible, needsManualGrading: false };
    }

    case "ORDERING": {
      const items = Array.isArray(cfg.items) ? (cfg.items as string[]) : [];
      const answerArr = Array.isArray(answer) ? (answer as number[]) : [];
      const n = items.length;
      const totalAdjacent = Math.max(1, n - 1);
      let correctAdjacent = 0;
      for (let i = 0; i < answerArr.length - 1; i += 1) {
        const a = answerArr[i];
        const b = answerArr[i + 1];
        if (typeof a === "number" && typeof b === "number" && a < b) correctAdjacent += 1;
      }
      const pointsEarned = round2(points * (correctAdjacent / totalAdjacent));
      const isCorrect = n > 0 && answerArr.length === n && correctAdjacent === totalAdjacent;
      return { isCorrect, pointsEarned, pointsPossible, needsManualGrading: false };
    }

    case "SCENARIO": {
      const choices = Array.isArray(cfg.choices)
        ? (cfg.choices as { id: string; correct?: boolean }[])
        : [];
      const chosenId = typeof answer === "string" ? answer : undefined;
      const chosen = choices.find((c) => c.id === chosenId);
      const isCorrect = Boolean(chosen?.correct);
      return { isCorrect, pointsEarned: isCorrect ? points : 0, pointsPossible, needsManualGrading: false };
    }

    case "APPLICATION": {
      /*
       * Multi-dimension judgment, scored per dimension with partial credit.
       *
       * The point of this type is that selecting the right valve body but the
       * wrong actuation is not simply "wrong" — it is most of the way there, and
       * a score that says otherwise teaches nothing. Each dimension carries an
       * optional weight so an author can say that body material matters more
       * than, say, a connection type.
       */
      const dimensions = Array.isArray(cfg.dimensions)
        ? (cfg.dimensions as { id?: unknown; correctOptionId?: unknown; weight?: unknown }[])
        : [];

      /*
       * A dimension is only gradeable if it has an id and a declared correct
       * option. Anything else is an authoring gap, and the safe response to an
       * authoring gap is to ask a human — never to award full marks, and never
       * to record a confident "incorrect" the learner cannot argue with.
       */
      const gradeable = dimensions.filter(
        (d): d is { id: string; correctOptionId: string; weight?: unknown } =>
          typeof d.id === "string" &&
          d.id.length > 0 &&
          typeof d.correctOptionId === "string" &&
          d.correctOptionId.length > 0,
      );

      if (gradeable.length === 0 || gradeable.length !== dimensions.length) {
        return { isCorrect: null, pointsEarned: 0, pointsPossible, needsManualGrading: true };
      }

      // A non-positive or non-numeric weight is meaningless; treat it as 1
      // rather than letting it silently erase a dimension from the score.
      const weightOf = (d: { weight?: unknown }): number =>
        typeof d.weight === "number" && Number.isFinite(d.weight) && d.weight > 0 ? d.weight : 1;

      const totalWeight = gradeable.reduce((sum, d) => sum + weightOf(d), 0);
      if (totalWeight <= 0) {
        return { isCorrect: null, pointsEarned: 0, pointsPossible, needsManualGrading: true };
      }

      /*
       * An answer that is not an object earns nothing. It must not be coerced
       * into an empty set of selections that then reads as "every dimension
       * answered wrongly but gradeable" — the distinction matters because an
       * unanswered question and a wrong answer are different facts.
       */
      const given =
        answer && typeof answer === "object" && !Array.isArray(answer)
          ? (answer as Record<string, unknown>)
          : undefined;
      if (!given) {
        return { isCorrect: false, pointsEarned: 0, pointsPossible, needsManualGrading: false };
      }

      let earnedWeight = 0;
      for (const dimension of gradeable) {
        const selected = given[dimension.id];
        if (typeof selected === "string" && selected === dimension.correctOptionId) {
          earnedWeight += weightOf(dimension);
        }
      }

      const fraction = earnedWeight / totalWeight;
      return {
        // Correct means every dimension correct. Partial credit is reflected in
        // the points, not by relaxing what "correct" means.
        isCorrect: fraction === 1,
        pointsEarned: round2(points * fraction),
        pointsPossible,
        needsManualGrading: false,
      };
    }

    case "FILE_SUBMISSION":
      return { isCorrect: null, pointsEarned: 0, pointsPossible, needsManualGrading: true };

    default:
      return { isCorrect: null, pointsEarned: 0, pointsPossible, needsManualGrading: true };
  }
}

export interface GradableQuestion {
  id: string;
  type: QuestionType;
  config: unknown;
  points: number;
}

export interface AttemptGradeSummary {
  pointsEarned: number;
  pointsPossible: number;
  scorePercent: number;
  hasPendingManualGrading: boolean;
  perQuestion: Record<string, GradeResult>;
}

/** Grade a full set of answers against their questions. Also pure. */
export function gradeAttempt(
  questions: GradableQuestion[],
  answers: Record<string, unknown>,
): AttemptGradeSummary {
  let pointsEarned = 0;
  let pointsPossible = 0;
  let hasPendingManualGrading = false;
  const perQuestion: Record<string, GradeResult> = {};

  for (const question of questions) {
    const result = gradeQuestion(question.type, question.config, answers[question.id], question.points);
    perQuestion[question.id] = result;
    pointsPossible += result.pointsPossible;
    pointsEarned += result.pointsEarned;
    if (result.needsManualGrading) hasPendingManualGrading = true;
  }

  const scorePercent = pointsPossible > 0 ? round2((pointsEarned / pointsPossible) * 100) : 0;
  return { pointsEarned: round2(pointsEarned), pointsPossible, scorePercent, hasPendingManualGrading, perQuestion };
}

// ---------------------------------------------------------------------------
// Shuffling helpers
// ---------------------------------------------------------------------------

export function shuffle<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  let state = seed || 1;
  const next = () => {
    // xorshift32 — deterministic given a seed, no external dependency.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}
