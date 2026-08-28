"use client";

import * as React from "react";
import { toast } from "sonner";
import { QuestionType } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Glyph, Icon } from "@/components/icons";
import type { BuilderLesson, BuilderQuestion } from "@/components/course/course-builder";
import {
  addQuestionAction,
  updateQuestionAction,
  deleteQuestionAction,
  reorderQuestionsAction,
} from "@/app/(app)/admin/training/[id]/edit/actions";

const TYPE_LABEL: Record<string, string> = {
  MULTIPLE_CHOICE: "Multiple choice",
  MULTIPLE_SELECT: "Multiple select",
  TRUE_FALSE: "True / False",
  FILL_BLANK: "Fill in the blank",
  SHORT_ANSWER: "Short answer",
  LONG_ANSWER: "Long answer (manual grading)",
  MATCHING: "Matching",
  ORDERING: "Ordering",
  SCENARIO: "Scenario choice",
  FILE_SUBMISSION: "File submission (manual grading)",
};

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id_${Date.now()}_${Math.random()}`;
}

export function QuestionEditor({
  courseId,
  lesson,
  onSaved,
}: {
  courseId: string;
  lesson: BuilderLesson;
  onSaved: () => void;
}) {
  const [editingId, setEditingId] = React.useState<string | "new" | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const questions = lesson.questions;

  async function handleDelete(questionId: string) {
    if (!window.confirm("Delete this question?")) return;
    setBusy(questionId);
    const result = await deleteQuestionAction(courseId, questionId);
    setBusy(null);
    if (!result.ok) return toast.error(result.error);
    onSaved();
  }

  async function handleMove(questionId: string, direction: -1 | 1) {
    const ids = questions.map((q) => q.id);
    const index = ids.indexOf(questionId);
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= ids.length) return;
    [ids[index], ids[swapWith]] = [ids[swapWith] as string, ids[index] as string];
    const result = await reorderQuestionsAction(courseId, lesson.id, ids);
    if (!result.ok) return toast.error(result.error);
    onSaved();
  }

  const editing = editingId === "new" ? null : questions.find((q) => q.id === editingId) ?? null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Questions</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setEditingId("new")}>
          <Glyph name="plus" className="h-4 w-4" />
          Add question
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {questions.length === 0 && editingId !== "new" ? (
          <EmptyState
            icon={<Icon name="assignment" className="h-5 w-5" />}
            title="No questions yet"
            description="Add at least one question before publishing this course."
          />
        ) : (
          questions.map((q, i) => (
            <div key={q.id} className="flex items-start justify-between gap-3 rounded-md border border-[var(--border-subtle)] p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">{TYPE_LABEL[q.type] ?? q.type}</Badge>
                  <span className="text-[0.75rem] text-[var(--text-muted)]">
                    {q.points} pt{q.points === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="mt-1 truncate text-[0.875rem] text-[var(--text-primary)]">{q.prompt}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <IconBtn label="Move up" onClick={() => handleMove(q.id, -1)} disabled={i === 0}>
                  <Glyph name="chevron-down" className="h-3.5 w-3.5 rotate-180" />
                </IconBtn>
                <IconBtn label="Move down" onClick={() => handleMove(q.id, 1)} disabled={i === questions.length - 1}>
                  <Glyph name="chevron-down" className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn label="Edit question" onClick={() => setEditingId(q.id)}>
                  <Glyph name="edit" className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn label="Delete question" onClick={() => handleDelete(q.id)} loading={busy === q.id}>
                  <Glyph name="trash" className="h-3.5 w-3.5" />
                </IconBtn>
              </div>
            </div>
          ))
        )}

        {editingId && (
          <QuestionForm
            courseId={courseId}
            lessonId={lesson.id}
            existing={editing}
            onCancel={() => setEditingId(null)}
            onSaved={() => {
              setEditingId(null);
              onSaved();
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  loading,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled || loading}
      className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function QuestionForm({
  courseId,
  lessonId,
  existing,
  onCancel,
  onSaved,
}: {
  courseId: string;
  lessonId: string;
  existing: BuilderQuestion | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = React.useState<string>(existing?.type ?? "MULTIPLE_CHOICE");
  const [prompt, setPrompt] = React.useState(existing?.prompt ?? "");
  const [points, setPoints] = React.useState(existing?.points?.toString() ?? "1");
  const [explanation, setExplanation] = React.useState(existing?.explanation ?? "");
  const [config, setConfig] = React.useState<Record<string, unknown>>(existing?.config ?? {});
  const [saving, setSaving] = React.useState(false);

  async function submit() {
    if (!prompt.trim()) {
      toast.error("Add a prompt.");
      return;
    }
    setSaving(true);
    const input = { type, prompt: prompt.trim(), points: Number(points) || 1, explanation: explanation || undefined, config };
    const result = existing
      ? await updateQuestionAction(courseId, existing.id, input)
      : await addQuestionAction(courseId, lessonId, input);
    setSaving(false);
    if (!result.ok) return toast.error(result.error);
    toast.success("Question saved.");
    onSaved();
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-[var(--brand-secondary)] bg-[var(--surface-sunken)] p-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_6rem]">
        <Field label="Type" htmlFor="q-type">
          <Select
            id="q-type"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setConfig({});
            }}
            disabled={Boolean(existing)}
          >
            {Object.values(QuestionType).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t] ?? t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Points" htmlFor="q-points">
          <Input id="q-points" type="number" min={1} value={points} onChange={(e) => setPoints(e.target.value)} />
        </Field>
      </div>
      <Field label="Prompt" htmlFor="q-prompt" required>
        <Textarea id="q-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} />
      </Field>

      <ConfigEditor type={type} config={config} onChange={setConfig} />

      <Field label="Explanation" htmlFor="q-explanation" hint="Shown on review, if the quiz allows it.">
        <Textarea id="q-explanation" value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={2} />
      </Field>

      <div className="flex gap-2">
        <Button size="sm" loading={saving} onClick={submit}>
          Save question
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ConfigEditor({
  type,
  config,
  onChange,
}: {
  type: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  switch (type) {
    case "MULTIPLE_CHOICE":
      return <ChoiceConfig config={config} onChange={onChange} multi={false} />;
    case "MULTIPLE_SELECT":
      return <ChoiceConfig config={config} onChange={onChange} multi />;
    case "TRUE_FALSE":
      return (
        <Field label="Correct answer" htmlFor="q-tf">
          <Select
            id="q-tf"
            value={config.correct === true ? "true" : "false"}
            onChange={(e) => onChange({ correct: e.target.value === "true" })}
          >
            <option value="true">True</option>
            <option value="false">False</option>
          </Select>
        </Field>
      );
    case "FILL_BLANK":
      return (
        <Field label="Acceptable answers" htmlFor="q-blank" hint="Comma separated. Case and whitespace are ignored.">
          <Input
            id="q-blank"
            value={((config.acceptableAnswers as string[]) ?? []).join(", ")}
            onChange={(e) => onChange({ acceptableAnswers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
          />
        </Field>
      );
    case "SHORT_ANSWER":
      return (
        <div className="flex flex-col gap-3">
          <Field label="Acceptable keywords" htmlFor="q-keywords" hint="Comma separated.">
            <Input
              id="q-keywords"
              value={((config.acceptableKeywords as string[]) ?? []).join(", ")}
              onChange={(e) =>
                onChange({ ...config, acceptableKeywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
              }
            />
          </Field>
          <label className="flex items-center gap-2 text-[0.8125rem] text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={Boolean(config.manualGrading)}
              onChange={(e) => onChange({ ...config, manualGrading: e.target.checked })}
              className="h-4 w-4 accent-[var(--brand-primary)]"
            />
            Flag for manual grading if no keyword matches
          </label>
        </div>
      );
    case "LONG_ANSWER":
      return <p className="text-[0.8125rem] text-[var(--text-muted)]">This question is always graded manually.</p>;
    case "MATCHING":
      return <MatchingConfig config={config} onChange={onChange} />;
    case "ORDERING":
      return <OrderingConfig config={config} onChange={onChange} />;
    case "SCENARIO":
      return <ScenarioQuestionConfig config={config} onChange={onChange} />;
    case "FILE_SUBMISSION":
      return (
        <Field label="Submission instructions" htmlFor="q-file-instructions">
          <Textarea
            id="q-file-instructions"
            value={(config.instructions as string) ?? ""}
            onChange={(e) => onChange({ instructions: e.target.value })}
            rows={2}
          />
        </Field>
      );
    default:
      return null;
  }
}

function ChoiceConfig({
  config,
  onChange,
  multi,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  multi: boolean;
}) {
  const options = (config.options as string[]) ?? ["", ""];
  const correctIndex = config.correctIndex as number | undefined;
  const correctIndexes = new Set<number>((config.correctIndexes as number[] | undefined) ?? []);

  function setOptions(next: string[]) {
    onChange({ ...config, options: next });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.75rem] font-medium text-[var(--text-secondary)]">Options</p>
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          {multi ? (
            <input
              type="checkbox"
              checked={correctIndexes.has(i)}
              onChange={(e) => {
                const next = new Set(correctIndexes);
                if (e.target.checked) next.add(i);
                else next.delete(i);
                onChange({ ...config, correctIndexes: [...next] });
              }}
              className="h-4 w-4 accent-[var(--brand-primary)]"
              aria-label={`Option ${i + 1} is correct`}
            />
          ) : (
            <input
              type="radio"
              name="correct-option"
              checked={correctIndex === i}
              onChange={() => onChange({ ...config, correctIndex: i })}
              className="h-4 w-4 accent-[var(--brand-primary)]"
              aria-label={`Option ${i + 1} is correct`}
            />
          )}
          <Input
            value={opt}
            onChange={(e) => {
              const next = [...options];
              next[i] = e.target.value;
              setOptions(next);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            aria-label="Remove option"
            onClick={() => {
              setOptions(options.filter((_, idx) => idx !== i));
              if (!multi && correctIndex === i) onChange({ ...config, options: options.filter((_, idx) => idx !== i), correctIndex: undefined });
            }}
          >
            <Glyph name="trash" className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start" onClick={() => setOptions([...options, ""])}>
        <Glyph name="plus" className="h-4 w-4" />
        Add option
      </Button>
    </div>
  );
}

function MatchingConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const pairs = (config.pairs as { left: string; right: string }[]) ?? [];

  function update(next: { left: string; right: string }[]) {
    onChange({ pairs: next });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.75rem] font-medium text-[var(--text-secondary)]">Pairs</p>
      {pairs.map((pair, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input placeholder="Left" value={pair.left} onChange={(e) => update(pairs.map((p, idx) => (idx === i ? { ...p, left: e.target.value } : p)))} />
          <Input placeholder="Right" value={pair.right} onChange={(e) => update(pairs.map((p, idx) => (idx === i ? { ...p, right: e.target.value } : p)))} />
          <Button variant="ghost" size="sm" aria-label="Remove pair" onClick={() => update(pairs.filter((_, idx) => idx !== i))}>
            <Glyph name="trash" className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start" onClick={() => update([...pairs, { left: "", right: "" }])}>
        <Glyph name="plus" className="h-4 w-4" />
        Add pair
      </Button>
    </div>
  );
}

function OrderingConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const items = (config.items as string[]) ?? [];

  function update(next: string[]) {
    onChange({ items: next });
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j] as string, next[i] as string];
    update(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.75rem] font-medium text-[var(--text-secondary)]">Items, in the correct order</p>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-5 shrink-0 text-[0.75rem] text-[var(--text-muted)]">{i + 1}.</span>
          <Input value={item} onChange={(e) => update(items.map((it, idx) => (idx === i ? e.target.value : it)))} />
          <Button variant="ghost" size="sm" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
            <Glyph name="chevron-down" className="h-4 w-4 rotate-180" />
          </Button>
          <Button variant="ghost" size="sm" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === items.length - 1}>
            <Glyph name="chevron-down" className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" aria-label="Remove item" onClick={() => update(items.filter((_, idx) => idx !== i))}>
            <Glyph name="trash" className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start" onClick={() => update([...items, ""])}>
        <Glyph name="plus" className="h-4 w-4" />
        Add item
      </Button>
    </div>
  );
}

function ScenarioQuestionConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const choices = (config.choices as { id: string; label: string; correct?: boolean; feedback?: string }[]) ?? [];

  function update(next: typeof choices) {
    onChange({ choices: next });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.75rem] font-medium text-[var(--text-secondary)]">Choices</p>
      {choices.map((choice, i) => (
        <div key={choice.id} className="flex items-center gap-2">
          <input
            type="radio"
            name="scenario-correct"
            checked={Boolean(choice.correct)}
            onChange={() => update(choices.map((c, idx) => ({ ...c, correct: idx === i })))}
            className="h-4 w-4 accent-[var(--brand-primary)]"
            aria-label={`Choice ${i + 1} is correct`}
          />
          <Input value={choice.label} onChange={(e) => update(choices.map((c, idx) => (idx === i ? { ...c, label: e.target.value } : c)))} />
          <Button variant="ghost" size="sm" aria-label="Remove choice" onClick={() => update(choices.filter((_, idx) => idx !== i))}>
            <Glyph name="trash" className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start" onClick={() => update([...choices, { id: newId(), label: "" }])}>
        <Glyph name="plus" className="h-4 w-4" />
        Add choice
      </Button>
    </div>
  );
}
