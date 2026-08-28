"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";
import { postProgress } from "@/components/lesson/progress-client";
import type { LessonPlayerProps } from "@/components/lesson/types";

interface SurveyQuestion {
  id: string;
  prompt: string;
  kind: "text" | "rating" | "choice";
  options?: string[];
}

export function SurveyPlayer({ lesson, progress, onComplete }: LessonPlayerProps) {
  const questions = ((lesson.content as { questions?: SurveyQuestion[] }).questions ?? []) as SurveyQuestion[];
  const previousAnswers = (progress?.checklistState as { surveyAnswers?: Record<string, unknown> } | null)
    ?.surveyAnswers;
  const [answers, setAnswers] = React.useState<Record<string, unknown>>(previousAnswers ?? {});
  const [submitting, setSubmitting] = React.useState(false);
  const alreadySubmitted = progress?.status === "COMPLETED";

  if (questions.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="report" className="h-5 w-5" />}
        title="No survey questions yet"
        description="This survey doesn't have any questions configured yet."
      />
    );
  }

  async function submit() {
    setSubmitting(true);
    try {
      await postProgress(lesson.id, { surveyAnswers: answers, markComplete: true });
      toast.success("Thanks — your response was recorded.");
      onComplete();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't submit your response.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {questions.map((q) => (
        <fieldset key={q.id} className="flex flex-col gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4">
          <legend className="px-1 text-[0.875rem] font-medium text-[var(--text-primary)]">{q.prompt}</legend>
          {q.kind === "text" && (
            <Textarea
              value={typeof answers[q.id] === "string" ? (answers[q.id] as string) : ""}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
              disabled={alreadySubmitted}
              rows={3}
            />
          )}
          {q.kind === "rating" && (
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={alreadySubmitted}
                  onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: n }))}
                  aria-pressed={answers[q.id] === n}
                  className={`h-9 w-9 rounded-md border text-[0.875rem] font-medium transition-colors ${
                    answers[q.id] === n
                      ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white"
                      : "border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] hover:bg-[var(--surface-sunken)]"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          {q.kind === "choice" && (
            <div className="flex flex-col gap-1.5">
              {(q.options ?? []).map((option) => (
                <label key={option} className="flex items-center gap-2 text-[0.875rem] text-[var(--text-primary)]">
                  <input
                    type="radio"
                    name={q.id}
                    disabled={alreadySubmitted}
                    checked={answers[q.id] === option}
                    onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: option }))}
                    className="h-4 w-4 accent-[var(--brand-primary)]"
                  />
                  {option}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      ))}

      {alreadySubmitted ? (
        <p className="text-[0.8125rem] font-medium text-success-700">Thanks — your response has been recorded.</p>
      ) : (
        <Button onClick={submit} loading={submitting}>
          Submit response
        </Button>
      )}
    </div>
  );
}
