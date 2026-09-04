/**
 * Work-sample rubrics and grading.
 *
 * A work sample is the closest this platform gets to watching someone do the
 * job, and that is exactly why the grading controls matter more here than
 * anywhere else. An unblinded, single-grader, rubric-free work sample is an
 * interview that took the candidate four hours instead of forty minutes.
 *
 * Three rules are enforced by the shapes in this file:
 *
 *   The rubric is written before anyone sees the work. Levels are anchored in
 *   words, because "3 out of 4" means whatever the grader had in mind unless
 *   somebody wrote it down first.
 *
 *   Graders work blind — of the candidate's identity, and of each other. A
 *   second grade that was written after reading the first is not a second
 *   opinion.
 *
 *   Two graders who disagree sharply reconcile by talking, not by averaging.
 *   An average of 1 and 4 is 2.5, which describes neither of them and is the
 *   number most likely to be quietly wrong.
 */

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 4;

/** No midpoint: a grader who can pick "3 of 5" for everything has not graded. */
export const LEVEL_LABEL: Record<number, string> = {
  1: "Well below what the job needs",
  2: "Below what the job needs",
  3: "What the job needs",
  4: "Beyond what the job needs",
};

export interface RubricAnchor {
  level: number;
  text: string;
}

export interface CriterionLike {
  id: string;
  name: string;
  description: string | null;
  anchors: RubricAnchor[];
  weight: number;
  orderIndex: number;
}

export interface RatingLike {
  criterionId: string;
  criterionName: string;
  level: number | null;
  note: string | null;
}

export interface GradeLike {
  id: string;
  graderId: string;
  graderName: string;
  status: string;
  comment: string | null;
  submittedAt: Date | null;
  reconciled: boolean;
  ratings: RatingLike[];
}

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

export interface RubricProblem {
  criterionName: string | null;
  message: string;
}

/**
 * Check a rubric before it can be used.
 *
 * Deliberately strict about anchors. A rubric with unanchored levels is the
 * single most common way a "structured" work sample turns back into an
 * impression, because two graders reading "level 3" supply their own
 * definitions and never find out they differed.
 */
export function validateRubric(criteria: CriterionLike[]): RubricProblem[] {
  const problems: RubricProblem[] = [];
  if (criteria.length === 0) {
    problems.push({
      criterionName: null,
      message: "A rubric needs at least one criterion. Without one there is nothing to grade against, and the work sample becomes an impression.",
    });
  }
  if (criteria.length > 8) {
    problems.push({
      criterionName: null,
      message: `${criteria.length} criteria is more than a grader can hold in mind at once. Five or six is usually the limit before the later rows get graded by halo from the earlier ones.`,
    });
  }

  const seen = new Set<string>();
  for (const c of criteria) {
    const key = c.name.trim().toLowerCase();
    if (seen.has(key)) {
      problems.push({
        criterionName: c.name,
        message: "Two criteria have the same name. Graders cannot tell which row they are filling in.",
      });
    }
    seen.add(key);

    if (c.weight <= 0) {
      problems.push({
        criterionName: c.name,
        message: "Weight must be greater than zero. To drop a criterion, remove it rather than zero it out.",
      });
    }

    const levels = new Set(c.anchors.map((a) => a.level));
    for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
      if (!levels.has(level)) {
        problems.push({
          criterionName: c.name,
          message: `Level ${level} has no written anchor. Every level needs one — an unanchored level means each grader supplies their own definition and nobody finds out they differed.`,
        });
      }
    }
    for (const a of c.anchors) {
      if (a.text.trim().length < 10) {
        problems.push({
          criterionName: c.name,
          message: `The anchor for level ${a.level} is too short to distinguish anything. Describe what the work looks like at that level.`,
        });
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Scoring one grade
// ---------------------------------------------------------------------------

export interface GradeScore {
  /** Weighted mean level, 1-4. Null when nothing was assessable. */
  score: number | null;
  /** Criteria the grader could not assess from what was submitted. */
  unassessed: string[];
  assessedCount: number;
}

/**
 * Weighted mean of the levels a grader actually assigned.
 *
 * Criteria left blank are excluded and the remaining weights renormalized,
 * rather than counted as zero. "Could not tell from what was submitted" is a
 * statement about the submission, not a judgement of the candidate, and
 * scoring it as the bottom level would turn one into the other.
 */
export function scoreGrade(
  grade: GradeLike,
  criteria: CriterionLike[],
): GradeScore {
  const weightById = new Map(criteria.map((c) => [c.id, c.weight]));
  let weighted = 0;
  let totalWeight = 0;
  const unassessed: string[] = [];

  for (const r of grade.ratings) {
    const weight = weightById.get(r.criterionId) ?? 1;
    if (r.level === null || r.level === undefined) {
      unassessed.push(r.criterionName);
      continue;
    }
    weighted += r.level * weight;
    totalWeight += weight;
  }

  return {
    score: totalWeight > 0 ? weighted / totalWeight : null,
    unassessed,
    assessedCount: grade.ratings.length - unassessed.length,
  };
}

// ---------------------------------------------------------------------------
// Comparing graders
// ---------------------------------------------------------------------------

/** Levels apart, on any one criterion, that means the graders read the work differently. */
export const DIVERGENT_LEVELS = 2;

/** Difference in overall weighted score that means the same thing. */
export const DIVERGENT_SCORE = 1;

export interface CriterionSpread {
  criterionId: string;
  criterionName: string;
  levels: number[];
  range: number;
  /** True when two graders are DIVERGENT_LEVELS or more apart here. */
  divergent: boolean;
}

export interface GradingSummary {
  submittedCount: number;
  requiredGraders: number;
  /** True when enough independent grades are in. */
  complete: boolean;
  /** Per-grader weighted scores, in submission order. */
  scores: { graderId: string; graderName: string; score: number | null; reconciled: boolean }[];
  /** Mean of the graders' scores. Shown alongside them, never instead. */
  meanScore: number | null;
  /** Largest gap between any two graders' overall scores. */
  scoreRange: number | null;
  criteria: CriterionSpread[];
  /** True when the graders need to talk before this is usable. */
  needsReconciliation: boolean;
  reconciliationReason: string | null;
}

export function summarizeGrades(
  grades: GradeLike[],
  criteria: CriterionLike[],
  requiredGraders: number,
): GradingSummary {
  const submitted = grades
    .filter((g) => g.status === "SUBMITTED" && g.submittedAt !== null)
    .sort((a, b) => (a.submittedAt as Date).getTime() - (b.submittedAt as Date).getTime());

  const scores = submitted.map((g) => ({
    graderId: g.graderId,
    graderName: g.graderName,
    score: scoreGrade(g, criteria).score,
    reconciled: g.reconciled,
  }));

  const numeric = scores.map((s) => s.score).filter((s): s is number => s !== null);
  const meanScore =
    numeric.length > 0 ? numeric.reduce((a, b) => a + b, 0) / numeric.length : null;
  const scoreRange =
    numeric.length >= 2 ? Math.max(...numeric) - Math.min(...numeric) : null;

  const spreads: CriterionSpread[] = criteria
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((c) => {
      const levels = submitted
        .map((g) => g.ratings.find((r) => r.criterionId === c.id)?.level ?? null)
        .filter((l): l is number => l !== null);
      const range = levels.length >= 2 ? Math.max(...levels) - Math.min(...levels) : 0;
      return {
        criterionId: c.id,
        criterionName: c.name,
        levels,
        range,
        divergent: range >= DIVERGENT_LEVELS,
      };
    });

  const divergentCriteria = spreads.filter((s) => s.divergent);
  let reconciliationReason: string | null = null;
  if (divergentCriteria.length > 0) {
    reconciliationReason = `Graders are ${DIVERGENT_LEVELS} or more levels apart on ${divergentCriteria.map((c) => `"${c.criterionName}"`).join(", ")}. Averaging that would produce a number describing neither of them.`;
  } else if (scoreRange !== null && scoreRange >= DIVERGENT_SCORE) {
    reconciliationReason = `Overall scores differ by ${scoreRange.toFixed(1)} of a level. No single criterion explains it, which usually means the graders weighted the work differently.`;
  }

  return {
    submittedCount: submitted.length,
    requiredGraders,
    complete: submitted.length >= requiredGraders,
    scores,
    meanScore,
    scoreRange,
    criteria: spreads,
    needsReconciliation: submitted.length >= 2 && reconciliationReason !== null,
    reconciliationReason,
  };
}

// ---------------------------------------------------------------------------
// The blind
// ---------------------------------------------------------------------------

/**
 * Whether this grader may see the other grades yet.
 *
 * The same rule as the independent review round: you see the others once you
 * have committed your own. A grade written after reading someone else's is
 * not a second opinion, and two of those are not agreement.
 */
export function canSeeOtherGrades(
  graderId: string,
  grades: GradeLike[],
): boolean {
  const own = grades.find((g) => g.graderId === graderId);
  return own?.status === "SUBMITTED";
}

/**
 * The grades a given viewer is allowed to read.
 *
 * The blind follows the ABILITY to grade, not whether a grade row happens to
 * exist yet. Anyone who could grade this submission is under the blind until
 * they have filed — including someone who also holds the oversight
 * permission. Keying off "has a grade row" instead would let exactly the
 * wrong person through: a grader who has not started yet has no row, and
 * would be treated as a bystander at the moment their view is most easily
 * contaminated.
 *
 * Oversight without the ability to grade — a recruiter following the
 * pipeline — reads everything, because there is no view of theirs to
 * contaminate.
 */
export function visibleGrades(
  grades: GradeLike[],
  viewerId: string,
  viewer: { canGrade: boolean; hasOversight: boolean },
): { visible: GradeLike[]; hiddenCount: number } {
  const submitted = grades.filter((g) => g.status === "SUBMITTED");

  if (viewer.canGrade) {
    if (canSeeOtherGrades(viewerId, grades)) {
      return { visible: submitted, hiddenCount: 0 };
    }
    const own = submitted.filter((g) => g.graderId === viewerId);
    return { visible: own, hiddenCount: submitted.length - own.length };
  }

  if (viewer.hasOversight) return { visible: submitted, hiddenCount: 0 };
  return { visible: [], hiddenCount: submitted.length };
}

// ---------------------------------------------------------------------------
// Submitting a grade
// ---------------------------------------------------------------------------

export interface GradeSubmission {
  ratings: { criterionId: string; level: number | null; note: string | null }[];
  comment: string | null;
}

export function validateGradeSubmission(
  submission: GradeSubmission,
  criteria: CriterionLike[],
): string[] {
  const errors: string[] = [];
  const byId = new Map(criteria.map((c) => [c.id, c]));

  for (const c of criteria) {
    if (!submission.ratings.some((r) => r.criterionId === c.id)) {
      errors.push(`"${c.name}" has no rating. Mark it "could not assess" if the submission did not show it.`);
    }
  }
  for (const r of submission.ratings) {
    const criterion = byId.get(r.criterionId);
    if (!criterion) {
      errors.push("A rating refers to a criterion that is not in this rubric.");
      continue;
    }
    if (r.level !== null && (r.level < MIN_LEVEL || r.level > MAX_LEVEL)) {
      errors.push(`"${criterion.name}" has a level outside ${MIN_LEVEL}-${MAX_LEVEL}.`);
    }
  }
  if (!submission.comment || submission.comment.trim().length < 20) {
    errors.push(
      "Write what you saw in the work that led to these levels. A score with no reasoning cannot be reconciled with another grader's, and cannot be explained to the candidate.",
    );
  }
  const allUnassessed =
    submission.ratings.length > 0 && submission.ratings.every((r) => r.level === null);
  if (allUnassessed) {
    errors.push(
      "Every criterion is marked unassessable. If the submission genuinely shows nothing, say so in the comment and raise it — do not file an empty grade.",
    );
  }
  return errors;
}

// ---------------------------------------------------------------------------
// The candidate's side
// ---------------------------------------------------------------------------

/** Seconds left on the server clock. Null for an untimed sample. */
export function remainingSeconds(
  assignment: { startedAt: Date | null; expiresAt: Date | null },
  now: Date = new Date(),
): number | null {
  if (!assignment.expiresAt) return null;
  return Math.max(
    0,
    Math.floor((assignment.expiresAt.getTime() - now.getTime()) / 1000),
  );
}

export type AssignmentGate =
  | { ok: true }
  | { ok: false; reason: string };

export function canStart(
  assignment: {
    status: string;
    dueAt: Date;
  },
  now: Date = new Date(),
): AssignmentGate {
  if (assignment.status === "SUBMITTED" || assignment.status === "GRADED") {
    return { ok: false, reason: "This work sample has already been submitted." };
  }
  if (assignment.status === "WITHDRAWN") {
    return { ok: false, reason: "This work sample is no longer active." };
  }
  if (assignment.status === "EXPIRED" || assignment.dueAt < now) {
    return {
      ok: false,
      reason: "The window to start this work sample has closed. Contact the recruiter if you need it reopened.",
    };
  }
  return { ok: true };
}

/**
 * Whether an already-started assignment may be reopened.
 *
 * Not the same question as `canStart`. `dueAt` is the deadline to BEGIN, so
 * once someone has begun it stops applying — a page reload twenty minutes
 * into a task that was started an hour before the due date is a resume, and
 * the `expiresAt` clock, not `dueAt`, is what governs from then on. Only the
 * terminal states close it.
 */
export function canResume(assignment: { status: string }): AssignmentGate {
  if (assignment.status === "SUBMITTED" || assignment.status === "GRADED") {
    return { ok: false, reason: "This work sample has already been submitted." };
  }
  if (assignment.status === "WITHDRAWN") {
    return { ok: false, reason: "This work sample is no longer active." };
  }
  if (assignment.status === "EXPIRED") {
    return {
      ok: false,
      reason: "The window to start this work sample has closed. Contact the recruiter if you need it reopened.",
    };
  }
  return { ok: true };
}

export function canSubmit(
  assignment: { status: string; expiresAt: Date | null },
  now: Date = new Date(),
): AssignmentGate {
  if (assignment.status !== "STARTED") {
    return { ok: false, reason: "This work sample is not open for submission." };
  }
  // A grace window: a submission that lands seconds after the deadline is a
  // slow network, not an extra attempt. The clock is still enforced.
  if (assignment.expiresAt && now.getTime() > assignment.expiresAt.getTime() + 30_000) {
    return { ok: false, reason: "The time limit for this work sample has passed." };
  }
  return { ok: true };
}

export interface SubmissionInput {
  text: string | null;
  hasFile: boolean;
}

export function validateCandidateSubmission(
  input: SubmissionInput,
  kind: "TEXT" | "FILE" | "TEXT_AND_FILE",
): string[] {
  const errors: string[] = [];
  const hasText = (input.text ?? "").trim().length > 0;
  if (kind !== "FILE" && !hasText) {
    errors.push("Your written response is empty.");
  }
  if (kind !== "TEXT" && !input.hasFile) {
    errors.push("This task asks for a file, and none has been uploaded.");
  }
  return errors;
}

/**
 * Extensions are compared lower case and without the dot.
 *
 * An empty allowlist is a refusal, not a wildcard. The route that creates a
 * file-taking work sample already insists on a list, with the reason written
 * out — "accepting anything means accepting an executable" — and returning
 * true here for the empty case was the hole that sentence describes, reachable
 * through any TEXT sample, which is never asked for a list at all.
 */
export function fileTypeAllowed(fileName: string, allowed: string[]): boolean {
  if (allowed.length === 0) return false;
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return allowed.map((a) => a.toLowerCase().replace(/^\./, "")).includes(ext);
}

/**
 * The status to SHOW for an assignment.
 *
 * Expiry is derived at read time rather than written by a scheduled job.
 * `canStart` already refuses a late start from the due date itself, so a job
 * would only be maintaining a display field — and a display field maintained
 * by a cron is a display field that is wrong whenever the cron did not run.
 *
 * Nobody is rejected by this either way. The assignment stops accepting a
 * start; the application stays exactly where it is, and a recruiter decides
 * what that means.
 */
export function effectiveAssignmentStatus(
  assignment: { status: string; dueAt: Date },
  now: Date = new Date(),
): string {
  if (assignment.status === "ASSIGNED" && assignment.dueAt < now) return "EXPIRED";
  return assignment.status;
}
