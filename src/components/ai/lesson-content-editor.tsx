"use client";

import * as React from "react";
import { Input, Textarea, Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Glyph } from "@/components/icons";
import { BlockEditor } from "@/components/ai/block-editor";
import type { Block } from "@/lib/content/types";
import type { QuizQuestionDraft } from "@/lib/ai/generate";

/**
 * Editable view of one AI-drafted lesson's content, dispatched by lesson
 * type. RICH_TEXT reuses the full block editor; the other AI-authorable
 * types (scenario, checklist, acknowledgement, quiz) get purpose-built mini
 * forms; anything else falls back to raw JSON so nothing is silently locked.
 */
export function LessonContentEditor({
  type,
  content,
  onChange,
}: {
  type: string;
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}) {
  switch (type) {
    case "RICH_TEXT": {
      const blocks = Array.isArray(content.blocks) ? (content.blocks as Block[]) : [];
      return <BlockEditor blocks={blocks} onChange={(next) => onChange({ blocks: next })} />;
    }

    case "SCENARIO": {
      const scenario = typeof content.scenario === "string" ? content.scenario : "";
      const choices = Array.isArray(content.choices)
        ? (content.choices as { id: string; label: string; correct: boolean; feedback: string }[])
        : [];
      return (
        <div className="flex flex-col gap-3">
          <Field label="Scenario" htmlFor="scenario-text">
            <Textarea
              id="scenario-text"
              value={scenario}
              onChange={(e) => onChange({ ...content, scenario: e.target.value })}
              rows={3}
            />
          </Field>
          {choices.map((choice, i) => (
            <div key={choice.id} className="rounded-md border border-[var(--border-subtle)] p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-[0.75rem] font-medium text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={choice.correct}
                    onChange={(e) => {
                      const next = choices.map((c, ci) => (ci === i ? { ...c, correct: e.target.checked } : c));
                      onChange({ ...content, choices: next });
                    }}
                  />
                  Correct choice
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove choice"
                  onClick={() => onChange({ ...content, choices: choices.filter((_, ci) => ci !== i) })}
                >
                  <Glyph name="trash" className="h-4 w-4" />
                </Button>
              </div>
              <Input
                aria-label="Choice label"
                value={choice.label}
                onChange={(e) => {
                  const next = choices.map((c, ci) => (ci === i ? { ...c, label: e.target.value } : c));
                  onChange({ ...content, choices: next });
                }}
                className="mb-2"
                placeholder="What the learner sees"
              />
              <Textarea
                aria-label="Feedback"
                value={choice.feedback}
                onChange={(e) => {
                  const next = choices.map((c, ci) => (ci === i ? { ...c, feedback: e.target.value } : c));
                  onChange({ ...content, choices: next });
                }}
                rows={2}
                placeholder="Feedback shown after this choice"
              />
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange({
                ...content,
                choices: [...choices, { id: crypto.randomUUID(), label: "", correct: false, feedback: "" }],
              })
            }
          >
            <Glyph name="plus" className="h-3.5 w-3.5" />
            Add choice
          </Button>
        </div>
      );
    }

    case "CHECKLIST": {
      const items = Array.isArray(content.items) ? (content.items as { id: string; text: string }[]) : [];
      return (
        <Textarea
          aria-label="Checklist items, one per line"
          value={items.map((i) => i.text).join("\n")}
          onChange={(e) =>
            onChange({
              ...content,
              items: e.target.value.split("\n").map((text, i) => ({ id: items[i]?.id ?? crypto.randomUUID(), text })),
            })
          }
          rows={Math.max(3, items.length)}
        />
      );
    }

    case "ACKNOWLEDGEMENT": {
      const statement = typeof content.statement === "string" ? content.statement : "";
      return (
        <Textarea
          aria-label="Acknowledgement statement"
          value={statement}
          onChange={(e) => onChange({ ...content, statement: e.target.value })}
          rows={3}
        />
      );
    }

    case "QUIZ": {
      const questions = Array.isArray(content.questions) ? (content.questions as QuizQuestionDraft[]) : [];
      return (
        <div className="flex flex-col gap-3">
          {questions.map((q, i) => (
            <div key={i} className="rounded-md border border-[var(--border-subtle)] p-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  {q.type.replace(/_/g, " ")}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove question"
                  onClick={() => onChange({ ...content, questions: questions.filter((_, qi) => qi !== i) })}
                >
                  <Glyph name="trash" className="h-4 w-4" />
                </Button>
              </div>
              <Textarea
                aria-label="Question prompt"
                value={q.prompt}
                onChange={(e) => {
                  const next = questions.map((qq, qi) => (qi === i ? { ...qq, prompt: e.target.value } : qq));
                  onChange({ ...content, questions: next });
                }}
                rows={2}
                className="mb-2"
              />
              <QuestionConfigFields
                question={q}
                onChange={(next) => onChange({ ...content, questions: questions.map((qq, qi) => (qi === i ? next : qq)) })}
              />
            </div>
          ))}
        </div>
      );
    }

    default:
      return (
        <Textarea
          aria-label="Lesson content (JSON)"
          value={JSON.stringify(content, null, 2)}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value) as Record<string, unknown>);
            } catch {
              // Leave the last valid content in place until the JSON is fixed.
            }
          }}
          rows={5}
          className="font-mono text-[0.75rem]"
        />
      );
  }
}

function QuestionConfigFields({
  question,
  onChange,
}: {
  question: QuizQuestionDraft;
  onChange: (question: QuizQuestionDraft) => void;
}) {
  const config = question.config as Record<string, unknown>;

  if (question.type === "MULTIPLE_CHOICE" || question.type === "MULTIPLE_SELECT") {
    const options = Array.isArray(config.options) ? (config.options as string[]) : [];
    return (
      <Textarea
        aria-label="Answer options, one per line"
        value={options.join("\n")}
        onChange={(e) => onChange({ ...question, config: { ...config, options: e.target.value.split("\n") } })}
        rows={Math.max(2, options.length)}
      />
    );
  }
  if (question.type === "TRUE_FALSE") {
    return (
      <label className="flex items-center gap-2 text-[0.8125rem]">
        <input
          type="checkbox"
          checked={config.correct === true}
          onChange={(e) => onChange({ ...question, config: { ...config, correct: e.target.checked } })}
        />
        Correct answer is True
      </label>
    );
  }
  return (
    <Textarea
      aria-label="Answer configuration (JSON)"
      value={JSON.stringify(config, null, 2)}
      onChange={(e) => {
        try {
          onChange({ ...question, config: JSON.parse(e.target.value) as Record<string, unknown> });
        } catch {
          // Ignore until valid JSON.
        }
      }}
      rows={3}
      className="font-mono text-[0.75rem]"
    />
  );
}
