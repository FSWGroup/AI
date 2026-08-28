"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  generateQuizAction,
  saveQuizQuestionsAction,
  searchQuizLessonsAction,
  type QuizLessonOption,
} from "@/app/(app)/admin/ai-studio/actions";
import type { GenerateQuizInput, QuizQuestionDraft, QuizQuestionType } from "@/lib/ai/generate";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Glyph } from "@/components/icons";
import { AiGeneratedBadge } from "@/components/ai/ai-badge";
import { QuestionConfigFields } from "@/components/ai/lesson-content-editor";

const ALL_TYPES: QuizQuestionType[] = [
  "MULTIPLE_CHOICE", "MULTIPLE_SELECT", "TRUE_FALSE", "FILL_BLANK", "SHORT_ANSWER", "MATCHING", "ORDERING",
];

export function QuizDraftFlow({ available }: { available: boolean }) {
  const [sourceText, setSourceText] = React.useState("");
  const [count, setCount] = React.useState(5);
  const [difficulty, setDifficulty] = React.useState<GenerateQuizInput["difficulty"]>("medium");
  const [types, setTypes] = React.useState<QuizQuestionType[]>(["MULTIPLE_CHOICE", "TRUE_FALSE"]);
  const [generating, setGenerating] = React.useState(false);
  const [questions, setQuestions] = React.useState<QuizQuestionDraft[] | null>(null);

  const [lessonQuery, setLessonQuery] = React.useState("");
  const [lessonOptions, setLessonOptions] = React.useState<QuizLessonOption[]>([]);
  const [lessonId, setLessonId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [savedCount, setSavedCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    const handle = setTimeout(async () => {
      if (lessonQuery.trim().length < 2) {
        setLessonOptions([]);
        return;
      }
      const result = await searchQuizLessonsAction(lessonQuery);
      if (result.ok) setLessonOptions(result.data);
    }, 250);
    return () => clearTimeout(handle);
  }, [lessonQuery]);

  function toggleType(type: QuizQuestionType) {
    setTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  }

  async function handleGenerate() {
    if (sourceText.trim().length < 20) {
      toast.error("Paste more source text for the questions to be grounded in.");
      return;
    }
    if (types.length === 0) {
      toast.error("Pick at least one question type.");
      return;
    }
    setGenerating(true);
    try {
      const result = await generateQuizAction({ sourceText, count, difficulty, types });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setQuestions(result.data);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!questions || !lessonId) {
      toast.error("Pick a quiz lesson to save these questions to.");
      return;
    }
    setSaving(true);
    try {
      const result = await saveQuizQuestionsAction({ lessonId, questions });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSavedCount(result.data.count);
      toast.success(`Saved ${result.data.count} draft question(s).`);
    } finally {
      setSaving(false);
    }
  }

  if (savedCount !== null) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-success-50 text-success-700">
            <Glyph name="check" className="h-5 w-5" />
          </div>
          <p className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">
            {savedCount} question{savedCount === 1 ? "" : "s"} saved as drafts
          </p>
          <p className="max-w-sm text-[0.8125rem] text-[var(--text-muted)]">
            They won&apos;t appear to learners until an author accepts them in the lesson editor.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setSavedCount(null);
              setQuestions(null);
              setLessonId(null);
              setLessonQuery("");
            }}
          >
            Generate more
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!questions) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Source material</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!available && (
            <p className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-[0.8125rem] text-warning-800">
              AI text generation isn&apos;t configured — generation will fail until an administrator sets an API key.
            </p>
          )}
          <Field label="Source text" htmlFor="quiz-source" hint="Paste the lesson content or SOP text these questions should test.">
            <Textarea id="quiz-source" value={sourceText} onChange={(e) => setSourceText(e.target.value)} rows={8} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="How many questions" htmlFor="quiz-count">
              <Input
                id="quiz-count"
                type="number"
                min={1}
                max={20}
                value={count}
                onChange={(e) => setCount(Number(e.target.value) || 1)}
              />
            </Field>
            <Field label="Difficulty" htmlFor="quiz-difficulty">
              <Select id="quiz-difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value as GenerateQuizInput["difficulty"])}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </Select>
            </Field>
          </div>
          <Field label="Question types" htmlFor="quiz-types">
            <div className="flex flex-wrap gap-2">
              {ALL_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  className={`rounded-md border px-2.5 py-1.5 text-[0.75rem] font-medium transition-colors ${
                    types.includes(t)
                      ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white"
                      : "border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
                  }`}
                >
                  {t.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </Field>
        </CardContent>
        <CardFooter className="justify-end">
          <Button onClick={handleGenerate} loading={generating}>
            <Glyph name="sparkle" className="h-4 w-4" />
            Generate questions
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <AiGeneratedBadge />
        <Button variant="ghost" size="sm" onClick={() => setQuestions(null)}>
          <Glyph name="arrow-left" className="h-4 w-4" />
          Start over
        </Button>
      </div>

      {questions.map((q, i) => (
        <Card key={i}>
          <CardContent className="flex flex-col gap-2 py-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                {q.type.replace(/_/g, " ")} · {q.points} pt{q.points === 1 ? "" : "s"}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove question"
                onClick={() => setQuestions(questions.filter((_, qi) => qi !== i))}
              >
                <Glyph name="trash" className="h-4 w-4" />
              </Button>
            </div>
            <Textarea
              aria-label="Question prompt"
              value={q.prompt}
              onChange={(e) => setQuestions(questions.map((qq, qi) => (qi === i ? { ...qq, prompt: e.target.value } : qq)))}
              rows={2}
            />
            <QuestionConfigFields question={q} onChange={(next) => setQuestions(questions.map((qq, qi) => (qi === i ? next : qq)))} />
            <Field label="Explanation" htmlFor={`explain-${i}`}>
              <Textarea
                id={`explain-${i}`}
                value={q.explanation}
                onChange={(e) => setQuestions(questions.map((qq, qi) => (qi === i ? { ...qq, explanation: e.target.value } : qq)))}
                rows={2}
              />
            </Field>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Save to a quiz lesson</CardTitle>
        </CardHeader>
        <CardContent>
          <Field label="Search for a quiz lesson" htmlFor="lesson-search">
            <Input id="lesson-search" value={lessonQuery} onChange={(e) => setLessonQuery(e.target.value)} placeholder="Start typing a lesson title…" />
            {lessonOptions.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 rounded-md border border-[var(--border-subtle)] p-1">
                {lessonOptions.map((l) => (
                  <li key={l.lessonId}>
                    <button
                      type="button"
                      onClick={() => {
                        setLessonId(l.lessonId);
                        setLessonQuery(l.lessonTitle);
                        setLessonOptions([]);
                      }}
                      className="w-full rounded px-2 py-1.5 text-left text-[0.8125rem] hover:bg-[var(--surface-sunken)]"
                    >
                      {l.lessonTitle} <span className="text-[var(--text-muted)]">· {l.courseTitle}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {lessonId && <p className="mt-1 text-[0.75rem] text-success-700">Selected.</p>}
          </Field>
        </CardContent>
        <CardFooter className="justify-end">
          <Button onClick={handleSave} loading={saving} disabled={!lessonId}>
            Save as draft questions
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
