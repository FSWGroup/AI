"use client";

import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { Glyph, Icon } from "@/components/icons";
import type { LessonPlayerProps, QuizAttemptView, QuizPresentedQuestion, QuizReview, QuizSubmitResult } from "@/components/lesson/types";

type Phase = "loading" | "in_progress" | "submitting" | "result" | "blocked";

export function QuizPlayer(props: LessonPlayerProps) {
  const { lesson, course, startQuizAttempt, submitQuizAttempt, getQuizReview, onComplete, onProgress } = props;
  const [phase, setPhase] = React.useState<Phase>("loading");
  const [attempt, setAttempt] = React.useState<QuizAttemptView | null>(null);
  const [answers, setAnswers] = React.useState<Record<string, unknown>>({});
  const [current, setCurrent] = React.useState(0);
  const [result, setResult] = React.useState<QuizSubmitResult | null>(null);
  const [review, setReview] = React.useState<QuizReview | null>(null);
  const [blockedMessage, setBlockedMessage] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!startQuizAttempt) return;
    setPhase("loading");
    const outcome = await startQuizAttempt(lesson.id);
    if (!outcome.ok || !outcome.data) {
      setBlockedMessage(outcome.error ?? "This quiz isn't available right now.");
      setPhase("blocked");
      return;
    }
    setAttempt(outcome.data);
    setAnswers({});
    setCurrent(0);
    setResult(null);
    setReview(null);
    setPhase("in_progress");
  }, [startQuizAttempt, lesson.id]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (phase === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-[var(--text-muted)]">
        <Spinner /> Loading quiz…
      </div>
    );
  }

  if (phase === "blocked") {
    return (
      <EmptyState
        icon={<Icon name="assignment" className="h-5 w-5" />}
        title="Quiz unavailable"
        description={blockedMessage ?? undefined}
      />
    );
  }

  if (!attempt) return null;

  if (phase === "result" && result) {
    return (
      <QuizResultView
        result={result}
        review={review}
        attempt={attempt}
        courseTitle={course.title}
        onRetry={() => void load()}
        onDone={() => {
          if (result.passed) onComplete();
          else onProgress();
        }}
      />
    );
  }

  const questions = attempt.questions;
  const question = attempt.oneQuestionAtATime ? questions[current] : undefined;

  async function submit() {
    if (!submitQuizAttempt || !attempt) return;
    const unanswered = questions.filter((q) => q.required && answers[q.id] === undefined);
    if (unanswered.length > 0) {
      toast.error(`Answer every question before submitting (${unanswered.length} remaining).`);
      const idx = questions.findIndex((q) => q.id === unanswered[0]?.id);
      if (idx >= 0) setCurrent(idx);
      return;
    }
    setPhase("submitting");
    const outcome = await submitQuizAttempt(attempt.id, answers);
    if (!outcome.ok || !outcome.data) {
      toast.error(outcome.error ?? "Couldn't submit your quiz.");
      setPhase("in_progress");
      return;
    }
    setResult(outcome.data);
    if (getQuizReview) {
      const reviewOutcome = await getQuizReview(attempt.id);
      if (reviewOutcome.ok && reviewOutcome.data) setReview(reviewOutcome.data);
    }
    setPhase("result");
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between text-[0.8125rem] text-[var(--text-muted)]">
        <span>
          Attempt {attempt.attemptNumber}
          {attempt.attemptsRemaining !== null ? ` · ${attempt.attemptsRemaining} remaining after this` : ""}
        </span>
        {course.passingScore !== null && <span>Passing score: {course.passingScore}%</span>}
      </div>

      {attempt.oneQuestionAtATime ? (
        <>
          <ProgressBar value={((current + 1) / questions.length) * 100} label={`Question ${current + 1} of ${questions.length}`} />
          {question && (
            <QuestionCard
              question={question}
              index={current}
              value={answers[question.id]}
              onChange={(value) => setAnswers((prev) => ({ ...prev, [question.id]: value }))}
            />
          )}
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0}>
              <Glyph name="arrow-left" className="h-4 w-4" />
              Previous
            </Button>
            {current < questions.length - 1 ? (
              <Button size="sm" onClick={() => setCurrent((c) => Math.min(questions.length - 1, c + 1))}>
                Next
                <Glyph name="arrow-right" className="h-4 w-4" />
              </Button>
            ) : (
              <Button size="sm" onClick={submit} loading={phase === "submitting"}>
                Submit quiz
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          {questions.map((q, i) => (
            <QuestionCard
              key={q.id}
              question={q}
              index={i}
              value={answers[q.id]}
              onChange={(value) => setAnswers((prev) => ({ ...prev, [q.id]: value }))}
            />
          ))}
          <div>
            <Button onClick={submit} loading={phase === "submitting"}>
              Submit quiz
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-type question inputs
// ---------------------------------------------------------------------------

function QuestionCard({
  question,
  index,
  value,
  onChange,
}: {
  question: QuizPresentedQuestion;
  index: number;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.9375rem] font-medium text-[var(--text-primary)]">
          {index + 1}. {question.prompt}
        </p>
        <Badge tone="neutral">
          {question.points} pt{question.points === 1 ? "" : "s"}
        </Badge>
      </div>
      <QuestionInput question={question} value={value} onChange={onChange} />
    </div>
  );
}

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: QuizPresentedQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const presentation = question.presentation;

  switch (question.type) {
    case "MULTIPLE_CHOICE": {
      const options = (presentation.options as string[]) ?? [];
      const order = (presentation.optionOrder as number[]) ?? options.map((_, i) => i);
      const selectedCanonical = typeof value === "number" ? value : undefined;
      return (
        <div className="flex flex-col gap-2">
          {options.map((label, presentedIndex) => {
            const canonical = order[presentedIndex] ?? presentedIndex;
            const checked = selectedCanonical === canonical;
            return (
              <label
                key={presentedIndex}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-[0.875rem] transition-colors ${
                  checked ? "border-[var(--brand-primary)] bg-[var(--surface-sunken)]" : "border-[var(--border-default)]"
                }`}
              >
                <input
                  type="radio"
                  name={question.id}
                  checked={checked}
                  onChange={() => onChange(canonical)}
                  className="h-4 w-4 accent-[var(--brand-primary)]"
                />
                {label}
              </label>
            );
          })}
        </div>
      );
    }

    case "MULTIPLE_SELECT": {
      const options = (presentation.options as string[]) ?? [];
      const order = (presentation.optionOrder as number[]) ?? options.map((_, i) => i);
      const selected = new Set<number>(Array.isArray(value) ? (value as number[]) : []);
      return (
        <div className="flex flex-col gap-2">
          {options.map((label, presentedIndex) => {
            const canonical = order[presentedIndex] ?? presentedIndex;
            const checked = selected.has(canonical);
            return (
              <label
                key={presentedIndex}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-[0.875rem] transition-colors ${
                  checked ? "border-[var(--brand-primary)] bg-[var(--surface-sunken)]" : "border-[var(--border-default)]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = new Set(selected);
                    if (checked) next.delete(canonical);
                    else next.add(canonical);
                    onChange([...next]);
                  }}
                  className="h-4 w-4 accent-[var(--brand-primary)]"
                />
                {label}
              </label>
            );
          })}
        </div>
      );
    }

    case "TRUE_FALSE":
      return (
        <div className="flex gap-2">
          {[true, false].map((option) => (
            <button
              key={String(option)}
              type="button"
              onClick={() => onChange(option)}
              aria-pressed={value === option}
              className={`rounded-md border px-4 py-2 text-[0.875rem] font-medium transition-colors ${
                value === option
                  ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white"
                  : "border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] hover:bg-[var(--surface-sunken)]"
              }`}
            >
              {option ? "True" : "False"}
            </button>
          ))}
        </div>
      );

    case "FILL_BLANK":
      return (
        <Input
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type your answer"
          aria-label={question.prompt}
        />
      );

    case "SHORT_ANSWER":
      return (
        <Textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          aria-label={question.prompt}
        />
      );

    case "LONG_ANSWER":
      return (
        <div className="flex flex-col gap-1.5">
          <Textarea
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            rows={5}
            aria-label={question.prompt}
          />
          <p className="text-[0.75rem] text-[var(--text-muted)]">This answer is graded manually.</p>
        </div>
      );

    case "MATCHING": {
      const left = (presentation.left as string[]) ?? [];
      const right = (presentation.right as string[]) ?? [];
      const rightOrder = (presentation.rightOrder as number[]) ?? right.map((_, i) => i);
      const currentAnswer = Array.isArray(value) ? (value as number[]) : [];
      return (
        <div className="flex flex-col gap-2">
          {left.map((leftLabel, leftIndex) => {
            const canonicalRight = currentAnswer[leftIndex];
            const presentedSelection = canonicalRight !== undefined ? rightOrder.indexOf(canonicalRight) : -1;
            return (
              <div key={leftIndex} className="flex items-center gap-3">
                <span className="w-1/2 text-[0.875rem] text-[var(--text-primary)]">{leftLabel}</span>
                <select
                  className="h-9.5 w-1/2 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 text-[0.8125rem]"
                  value={presentedSelection}
                  onChange={(e) => {
                    const presentedIdx = Number(e.target.value);
                    const canonical = rightOrder[presentedIdx];
                    const next = [...currentAnswer];
                    next[leftIndex] = canonical ?? -1;
                    onChange(next);
                  }}
                >
                  <option value={-1}>Choose a match…</option>
                  {right.map((rightLabel, presentedIdx) => (
                    <option key={presentedIdx} value={presentedIdx}>
                      {rightLabel}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      );
    }

    case "ORDERING": {
      const items = (presentation.items as string[]) ?? [];
      const itemOrder = (presentation.itemOrder as number[]) ?? items.map((_, i) => i);
      // Local order is a permutation of presented positions (0..n-1); default = presented order.
      const localOrder = Array.isArray(value) && (value as unknown[]).every((v) => typeof v === "number")
        ? (value as number[]).map((canonical) => itemOrder.indexOf(canonical))
        : items.map((_, i) => i);

      const move = (from: number, to: number) => {
        if (to < 0 || to >= localOrder.length) return;
        const next = [...localOrder];
        const [moved] = next.splice(from, 1);
        if (moved === undefined) return;
        next.splice(to, 0, moved);
        onChange(next.map((presentedIdx) => itemOrder[presentedIdx] ?? presentedIdx));
      };

      return (
        <ol className="flex flex-col gap-2">
          {localOrder.map((presentedIdx, rank) => (
            <li
              key={presentedIdx}
              className="flex items-center justify-between gap-3 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-[0.875rem]"
            >
              <span className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[0.6875rem] font-semibold text-[var(--text-secondary)]">
                  {rank + 1}
                </span>
                {items[presentedIdx]}
              </span>
              <span className="flex gap-1">
                <button
                  type="button"
                  aria-label="Move up"
                  onClick={() => move(rank, rank - 1)}
                  disabled={rank === 0}
                  className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] disabled:opacity-40"
                >
                  <Glyph name="chevron-down" className="h-4 w-4 rotate-180" />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  onClick={() => move(rank, rank + 1)}
                  disabled={rank === localOrder.length - 1}
                  className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] disabled:opacity-40"
                >
                  <Glyph name="chevron-down" className="h-4 w-4" />
                </button>
              </span>
            </li>
          ))}
        </ol>
      );
    }

    case "SCENARIO": {
      const choices = (presentation.choices as { id: string; label: string }[]) ?? [];
      return (
        <div className="flex flex-col gap-2">
          {choices.map((choice) => (
            <label
              key={choice.id}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-[0.875rem] transition-colors ${
                value === choice.id ? "border-[var(--brand-primary)] bg-[var(--surface-sunken)]" : "border-[var(--border-default)]"
              }`}
            >
              <input
                type="radio"
                name={question.id}
                checked={value === choice.id}
                onChange={() => onChange(choice.id)}
                className="h-4 w-4 accent-[var(--brand-primary)]"
              />
              {choice.label}
            </label>
          ))}
        </div>
      );
    }

    case "APPLICATION": {
      /*
       * One selection per decision, each rendered as its own labelled group.
       * The application facts sit above them, because the whole point is that
       * the learner reasons from the facts rather than recognising a phrase.
       */
      const parameters =
        (presentation.parameters as { label: string; value: string }[] | undefined) ?? [];
      const dimensions =
        (presentation.dimensions as
          | { id: string; label: string; options: { id: string; label: string }[] }[]
          | undefined) ?? [];
      const selections = (value as Record<string, string> | undefined) ?? {};

      return (
        <div className="flex flex-col gap-4">
          {parameters.length > 0 && (
            <dl className="grid gap-x-6 gap-y-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3 sm:grid-cols-2">
              {parameters.map((parameter) => (
                <div key={`${parameter.label}-${parameter.value}`} className="flex flex-col">
                  <dt className="text-[0.6875rem] font-medium tracking-[0.06em] text-[var(--text-muted)] uppercase">
                    {parameter.label}
                  </dt>
                  <dd className="text-[0.875rem] text-[var(--text-primary)]">{parameter.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {dimensions.map((dimension) => (
            <fieldset key={dimension.id} className="flex flex-col gap-1.5">
              <legend className="mb-1 text-[0.8125rem] font-semibold text-[var(--text-primary)]">
                {dimension.label}
              </legend>
              {dimension.options.map((option) => (
                <label
                  key={option.id}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-[0.875rem] transition-colors ${
                    selections[dimension.id] === option.id
                      ? "border-[var(--brand-primary)] bg-[var(--surface-sunken)]"
                      : "border-[var(--border-default)]"
                  }`}
                >
                  <input
                    type="radio"
                    name={`${question.id}-${dimension.id}`}
                    checked={selections[dimension.id] === option.id}
                    onChange={() => onChange({ ...selections, [dimension.id]: option.id })}
                    className="h-4 w-4 accent-[var(--brand-primary)]"
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      );
    }

    case "FILE_SUBMISSION": {
      const current = (value as { note?: string } | undefined) ?? {};
      return (
        <div className="flex flex-col gap-2">
          {presentation.instructions ? (
            <p className="text-[0.8125rem] text-[var(--text-muted)]">{presentation.instructions as string}</p>
          ) : null}
          <Textarea
            value={current.note ?? ""}
            onChange={(e) => onChange({ ...current, note: e.target.value })}
            rows={3}
            placeholder="Describe what you're submitting (file upload evidence, links, etc.)"
          />
          <p className="text-[0.75rem] text-[var(--text-muted)]">This submission is graded manually.</p>
        </div>
      );
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Result view
// ---------------------------------------------------------------------------

function QuizResultView({
  result,
  review,
  attempt,
  courseTitle,
  onRetry,
  onDone,
}: {
  result: QuizSubmitResult;
  review: QuizReview | null;
  attempt: QuizAttemptView;
  courseTitle: string;
  onRetry: () => void;
  onDone: () => void;
}) {
  const canRetry = !result.passed && !result.hasPendingManualGrading && (attempt.attemptsRemaining ?? 1) > 0;

  React.useEffect(() => {
    onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div
        className={`flex flex-col items-center gap-2 rounded-lg border p-8 text-center ${
          result.hasPendingManualGrading
            ? "border-info-100 bg-info-50"
            : result.passed
              ? "border-success-100 bg-success-50"
              : "border-danger-100 bg-danger-50"
        }`}
      >
        <Icon
          name={result.hasPendingManualGrading ? "assignment" : result.passed ? "certificate" : "report"}
          className="h-8 w-8"
        />
        <p className="text-[1.5rem] font-bold text-[var(--text-primary)]">{Math.round(result.scorePercent)}%</p>
        <p className="text-[0.9375rem] font-medium text-[var(--text-secondary)]">
          {result.hasPendingManualGrading
            ? "Submitted — part of this quiz needs manual grading."
            : result.passed
              ? `You passed ${courseTitle}'s quiz.`
              : "You didn't reach the passing score this time."}
        </p>
        <p className="text-[0.8125rem] text-[var(--text-muted)]">
          {result.pointsEarned} / {result.pointsPossible} points
        </p>
      </div>

      {review && review.responses.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-[0.875rem] font-semibold text-[var(--text-primary)]">Review</h3>
          {review.responses.map((r) => (
            <div
              key={r.questionId}
              className={`rounded-lg border p-4 text-[0.875rem] ${
                r.isCorrect === null
                  ? "border-[var(--border-subtle)] bg-[var(--surface-card)]"
                  : r.isCorrect
                    ? "border-success-100 bg-success-50"
                    : "border-danger-100 bg-danger-50"
              }`}
            >
              <p className="font-medium text-[var(--text-primary)]">{r.prompt}</p>
              {r.isCorrect !== null && (
                <p className="mt-1 text-[0.8125rem] text-[var(--text-secondary)]">
                  {r.pointsEarned ?? 0} / {r.pointsPossible} points
                </p>
              )}
              {r.explanation && <p className="mt-1 text-[0.8125rem] text-[var(--text-secondary)]">{r.explanation}</p>}

              {/*
                A judgment question is marked decision by decision. Getting the
                valve right and the actuation wrong is most of the way there, and
                the reasoning is the part that turns a score into learning.
              */}
              {r.dimensions && r.dimensions.length > 0 && (
                <ul className="mt-3 flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-3">
                  {r.dimensions.map((dimension) => (
                    <li key={dimension.label} className="flex flex-col gap-0.5">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">
                          {dimension.label}
                        </span>
                        <Badge tone={dimension.isCorrect ? "success" : "danger"}>
                          {dimension.isCorrect ? "Right" : "Not this time"}
                        </Badge>
                      </span>
                      <span className="text-[0.8125rem] text-[var(--text-secondary)]">
                        You chose {dimension.chosenLabel ?? "nothing"}
                        {!dimension.isCorrect && dimension.correctLabel
                          ? `; the answer is ${dimension.correctLabel}`
                          : ""}
                        .
                      </span>
                      {dimension.reasoning && (
                        <span className="text-[0.8125rem] text-[var(--text-muted)]">
                          {dimension.reasoning}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {canRetry && (
        <div>
          <Button onClick={onRetry}>Retry quiz</Button>
        </div>
      )}
      {!result.passed && !canRetry && !result.hasPendingManualGrading && (
        <p className="text-[0.8125rem] text-[var(--text-muted)]">
          {attempt.attemptsRemaining === 0
            ? "You've used all of your attempts for this quiz."
            : "A cooldown period applies before you can retry."}
        </p>
      )}
    </div>
  );
}
