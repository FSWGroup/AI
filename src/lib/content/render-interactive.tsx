"use client";

import { useRef, useState } from "react";
import type { Block } from "@/lib/content/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Glyph } from "@/components/icons";
import { renderBlockList, renderInlineText, type RenderBlockListOptions } from "@/lib/content/render-blocks";

type Extracted<T extends Block["type"]> = Extract<Block, { type: T }>;

/**
 * The genuinely interactive block types (checklist, tabs, question) plus the
 * client variant of the block renderer. Kept in its own "use client" module so
 * `render-blocks.tsx` never needs a client dependency and the server
 * BlockRenderer stays a real Server Component.
 */

export function ChecklistBlockView({
  block,
  initialChecked,
  onChange,
}: {
  block: Extracted<"checklist">;
  initialChecked?: string[];
  onChange?: (checkedItemIds: string[]) => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(initialChecked ?? []));

  function toggle(itemId: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      onChange?.([...next]);
      return next;
    });
  }

  const total = block.items.length;
  const doneCount = block.items.filter((item) => checked.has(item.id)).length;
  const allDone = total > 0 && doneCount === total;

  return (
    <div className="not-prose my-4 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4" role="group" aria-label={block.title || "Checklist"}>
      {block.title && <p className="mb-2 text-[0.9375rem] font-semibold text-[var(--text-primary)]">{block.title}</p>}
      <ul className="flex flex-col gap-2.5">
        {block.items.map((item) => {
          const inputId = `checklist-${block.id}-${item.id}`;
          return (
            <li key={item.id} className="flex items-start gap-2.5">
              <input
                id={inputId}
                type="checkbox"
                checked={checked.has(item.id)}
                onChange={() => toggle(item.id)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand-primary)]"
              />
              <label htmlFor={inputId} className="text-[0.875rem] leading-relaxed text-[var(--text-primary)]">
                {renderInlineText(item.text, inputId)}
              </label>
            </li>
          );
        })}
      </ul>
      {total > 0 && (
        <p className="mt-3 text-[0.75rem] text-[var(--text-muted)]" aria-live="polite">
          {allDone
            ? "All items complete."
            : `${doneCount} of ${total} complete${block.requireAll ? " — all items required" : ""}.`}
        </p>
      )}
    </div>
  );
}

export function TabsBlockView({ block }: { block: Extracted<"tabs"> }) {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function focusTab(index: number) {
    setActive(index);
    tabRefs.current[index]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = block.tabs.length;
    if (count === 0) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusTab((index + 1) % count);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusTab((index - 1 + count) % count);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusTab(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusTab(count - 1);
    }
  }

  if (block.tabs.length === 0) return null;

  return (
    <div className="not-prose my-4">
      <div role="tablist" aria-label="Content tabs" className="flex flex-wrap gap-1 border-b border-[var(--border-subtle)]">
        {block.tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            role="tab"
            type="button"
            id={`tab-${block.id}-${tab.id}`}
            aria-selected={index === active}
            aria-controls={`panel-${block.id}-${tab.id}`}
            tabIndex={index === active ? 0 : -1}
            onClick={() => setActive(index)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              "-mb-px rounded-t-md border border-b-0 px-3.5 py-2 text-[0.8125rem] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
              index === active
                ? "border-[var(--border-subtle)] bg-[var(--surface-card)] text-[var(--text-primary)]"
                : "border-transparent bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {block.tabs.map((tab, index) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`panel-${block.id}-${tab.id}`}
          aria-labelledby={`tab-${block.id}-${tab.id}`}
          hidden={index !== active}
          tabIndex={0}
          className="rounded-b-md border border-t-0 border-[var(--border-subtle)] p-4"
        >
          <p className="text-[0.875rem] leading-relaxed text-[var(--text-primary)]">{renderInlineText(tab.text, tab.id)}</p>
        </div>
      ))}
    </div>
  );
}

export function QuestionBlockView({ block }: { block: Extracted<"question"> }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const isCorrect = selected !== null && selected === block.correctIndex;
  const groupLabel = `question-${block.id}`;

  return (
    <div className="not-prose my-4 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4" role="group" aria-labelledby={groupLabel}>
      <p id={groupLabel} className="mb-3 text-[0.9375rem] font-semibold text-[var(--text-primary)]">
        {block.prompt}
      </p>
      <div role="radiogroup" aria-labelledby={groupLabel} className="flex flex-col gap-2">
        {block.options.map((option, index) => {
          const inputId = `${groupLabel}-opt-${index}`;
          return (
            <label
              key={inputId}
              htmlFor={inputId}
              className="flex cursor-pointer items-center gap-2.5 rounded-md border border-[var(--border-subtle)] px-3 py-2 text-[0.875rem] text-[var(--text-primary)] has-[:checked]:border-[var(--brand-secondary)] has-[:checked]:bg-[var(--surface-sunken)]"
            >
              <input
                id={inputId}
                type="radio"
                name={groupLabel}
                checked={selected === index}
                onChange={() => {
                  setSelected(index);
                  setRevealed(false);
                }}
                className="h-4 w-4 accent-[var(--brand-primary)]"
              />
              {option}
            </label>
          );
        })}
      </div>
      <Button size="sm" variant="secondary" className="mt-3" disabled={selected === null} onClick={() => setRevealed(true)}>
        <Glyph name="check" className="h-3.5 w-3.5" />
        Check answer
      </Button>
      {revealed && selected !== null && (
        <p role="status" className={cn("mt-2.5 text-[0.8125rem] font-medium", isCorrect ? "text-success-700" : "text-danger-700")}>
          {isCorrect ? "Correct." : `Not quite — the correct answer is "${block.options[block.correctIndex] ?? "—"}".`}
          {block.explanation && <span className="block font-normal text-[var(--text-secondary)]">{block.explanation}</span>}
        </p>
      )}
    </div>
  );
}

const INTERACTIVE_RENDERERS = {
  Checklist: ChecklistBlockView,
  Tabs: TabsBlockView,
  Question: QuestionBlockView,
};

/**
 * Fully client-rendered block list. Use this from within components that are
 * already client components (e.g. the block editor's live preview) — the
 * server `BlockRenderer` in render.tsx works there too since this module has
 * no server-only dependency, but this export makes the intent explicit.
 */
export function BlockRendererClient({
  blocks,
  className,
  onChecklistChange,
  checklistState,
}: {
  blocks: Block[];
  className?: string;
} & RenderBlockListOptions) {
  if (!blocks || blocks.length === 0) return null;
  return (
    <div className={cn("prose-fsw", className)}>
      {renderBlockList(blocks, INTERACTIVE_RENDERERS, { onChecklistChange, checklistState })}
    </div>
  );
}
