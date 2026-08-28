"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Glyph } from "@/components/icons";
import type { Block, BlockType } from "@/lib/content/types";

/**
 * A lightweight, fully-editable view of the FSW block content model. This is
 * not the full authoring editor (that lives with the SOP/course authoring
 * surfaces other agents own) — it exists so an AI-drafted SOP or quick
 * reference can be reviewed and changed in every field before it is ever
 * saved, per the platform's "everything is a draft until a human approves
 * it" rule.
 */

const ADDABLE_TYPES: { value: BlockType; label: string }[] = [
  { value: "heading", label: "Heading" },
  { value: "paragraph", label: "Paragraph" },
  { value: "list", label: "List" },
  { value: "table", label: "Table" },
  { value: "callout", label: "Callout" },
  { value: "warning", label: "Warning" },
  { value: "checklist", label: "Checklist" },
  { value: "code", label: "Code" },
  { value: "divider", label: "Divider" },
];

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

function emptyBlock(type: BlockType): Block {
  switch (type) {
    case "heading":
      return { id: uid(), type: "heading", level: 3, text: "" };
    case "paragraph":
      return { id: uid(), type: "paragraph", text: "" };
    case "list":
      return { id: uid(), type: "list", ordered: false, items: [""] };
    case "table":
      return { id: uid(), type: "table", headers: ["Column 1", "Column 2"], rows: [["", ""]] };
    case "callout":
      return { id: uid(), type: "callout", tone: "info", title: "", text: "" };
    case "warning":
      return { id: uid(), type: "warning", severity: "warning", title: "", text: "" };
    case "checklist":
      return { id: uid(), type: "checklist", title: "", items: [{ id: uid(), text: "" }], requireAll: true };
    case "code":
      return { id: uid(), type: "code", language: "text", code: "" };
    case "divider":
      return { id: uid(), type: "divider" };
    default:
      return { id: uid(), type: "paragraph", text: "" };
  }
}

const BLOCK_LABELS: Record<string, string> = {
  heading: "Heading",
  paragraph: "Paragraph",
  list: "List",
  table: "Table",
  callout: "Callout",
  warning: "Warning",
  checklist: "Checklist",
  code: "Code",
  divider: "Divider",
};

export function BlockEditor({ blocks, onChange }: { blocks: Block[]; onChange: (blocks: Block[]) => void }) {
  function update(index: number, next: Block) {
    onChange(blocks.map((b, i) => (i === index ? next : b)));
  }
  function remove(index: number) {
    onChange(blocks.filter((_, i) => i !== index));
  }
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const a = next[index]!;
    const b = next[target]!;
    next[index] = b;
    next[target] = a;
    onChange(next);
  }
  function add(type: BlockType) {
    onChange([...blocks, emptyBlock(type)]);
  }

  return (
    <div className="flex flex-col gap-3">
      {blocks.length === 0 && (
        <p className="rounded-md border border-dashed border-[var(--border-default)] px-4 py-6 text-center text-[0.8125rem] text-[var(--text-muted)]">
          No content blocks yet. Add one below.
        </p>
      )}

      {blocks.map((block, index) => (
        <Card key={block.id} className="p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {BLOCK_LABELS[block.type] ?? block.type}
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Move block up"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <Glyph name="chevron-down" className="h-4 w-4 rotate-180" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Move block down"
                disabled={index === blocks.length - 1}
                onClick={() => move(index, 1)}
              >
                <Glyph name="chevron-down" className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label="Delete block" onClick={() => remove(index)}>
                <Glyph name="trash" className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <BlockFields block={block} onChange={(next) => update(index, next)} />
        </Card>
      ))}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="text-[0.8125rem] text-[var(--text-muted)]">Add block:</span>
        {ADDABLE_TYPES.map((t) => (
          <Button key={t.value} type="button" variant="outline" size="sm" onClick={() => add(t.value)}>
            <Glyph name="plus" className="h-3.5 w-3.5" />
            {t.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function BlockFields({ block, onChange }: { block: Block; onChange: (block: Block) => void }) {
  switch (block.type) {
    case "heading":
      return (
        <div className="flex gap-2">
          <Select
            aria-label="Heading level"
            value={String(block.level)}
            onChange={(e) => onChange({ ...block, level: Number(e.target.value) as 2 | 3 | 4 })}
            className="w-28"
          >
            <option value="2">Heading 2</option>
            <option value="3">Heading 3</option>
            <option value="4">Heading 4</option>
          </Select>
          <Input
            aria-label="Heading text"
            value={block.text}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
            className="flex-1"
          />
        </div>
      );

    case "paragraph":
      return (
        <Textarea
          aria-label="Paragraph text"
          value={block.text}
          onChange={(e) => onChange({ ...block, text: e.target.value })}
          rows={3}
        />
      );

    case "list":
      return (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[0.8125rem] text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={block.ordered}
              onChange={(e) => onChange({ ...block, ordered: e.target.checked })}
            />
            Numbered list
          </label>
          <Textarea
            aria-label="List items, one per line"
            value={block.items.join("\n")}
            onChange={(e) => onChange({ ...block, items: e.target.value.split("\n") })}
            rows={Math.max(3, block.items.length)}
            placeholder="One item per line"
          />
        </div>
      );

    case "table":
      return (
        <div className="flex flex-col gap-2">
          <Field label="Column headers (comma-separated)" htmlFor={`${block.id}-headers`}>
            <Input
              id={`${block.id}-headers`}
              value={block.headers.join(", ")}
              onChange={(e) => onChange({ ...block, headers: e.target.value.split(",").map((h) => h.trim()) })}
            />
          </Field>
          <Field label="Rows (one row per line, cells comma-separated)" htmlFor={`${block.id}-rows`}>
            <Textarea
              id={`${block.id}-rows`}
              value={block.rows.map((row) => row.join(", ")).join("\n")}
              onChange={(e) =>
                onChange({
                  ...block,
                  rows: e.target.value.split("\n").map((row) => row.split(",").map((cell) => cell.trim())),
                })
              }
              rows={Math.max(3, block.rows.length)}
            />
          </Field>
        </div>
      );

    case "callout":
      return (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Select
              aria-label="Callout tone"
              value={block.tone}
              onChange={(e) => onChange({ ...block, tone: e.target.value as typeof block.tone })}
              className="w-32"
            >
              <option value="info">Info</option>
              <option value="tip">Tip</option>
              <option value="note">Note</option>
            </Select>
            <Input
              aria-label="Callout title (optional)"
              value={block.title ?? ""}
              onChange={(e) => onChange({ ...block, title: e.target.value })}
              placeholder="Title (optional)"
              className="flex-1"
            />
          </div>
          <Textarea
            aria-label="Callout text"
            value={block.text}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
            rows={2}
          />
        </div>
      );

    case "warning":
      return (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Select
              aria-label="Warning severity"
              value={block.severity}
              onChange={(e) => onChange({ ...block, severity: e.target.value as typeof block.severity })}
              className="w-32"
            >
              <option value="caution">Caution</option>
              <option value="warning">Warning</option>
              <option value="danger">Danger</option>
            </Select>
            <Input
              aria-label="Warning title (optional)"
              value={block.title ?? ""}
              onChange={(e) => onChange({ ...block, title: e.target.value })}
              placeholder="Title (optional)"
              className="flex-1"
            />
          </div>
          <Textarea
            aria-label="Warning text"
            value={block.text}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
            rows={2}
          />
        </div>
      );

    case "checklist":
      return (
        <div className="flex flex-col gap-2">
          <Input
            aria-label="Checklist title (optional)"
            value={block.title ?? ""}
            onChange={(e) => onChange({ ...block, title: e.target.value })}
            placeholder="Title (optional)"
          />
          <Textarea
            aria-label="Checklist items, one per line"
            value={block.items.map((i) => i.text).join("\n")}
            onChange={(e) =>
              onChange({
                ...block,
                items: e.target.value.split("\n").map((text, i) => ({ id: block.items[i]?.id ?? uid(), text })),
              })
            }
            rows={Math.max(3, block.items.length)}
          />
        </div>
      );

    case "code":
      return (
        <div className="flex flex-col gap-2">
          <Input
            aria-label="Code language"
            value={block.language}
            onChange={(e) => onChange({ ...block, language: e.target.value })}
            placeholder="Language"
            className="w-40"
          />
          <Textarea
            aria-label="Code"
            value={block.code}
            onChange={(e) => onChange({ ...block, code: e.target.value })}
            rows={4}
            className="font-mono text-[0.8125rem]"
          />
        </div>
      );

    case "divider":
      return <p className="text-[0.8125rem] text-[var(--text-muted)]">A horizontal divider — nothing to edit.</p>;

    default:
      // Less common AI-drafted block types (image, video, flowchart, etc.) —
      // still fully editable as raw JSON so nothing is silently dropped.
      return <RawJsonFallback block={block} onChange={onChange} />;
  }
}

function RawJsonFallback({ block, onChange }: { block: Block; onChange: (block: Block) => void }) {
  const [text, setText] = React.useState(() => JSON.stringify(block, null, 2));
  const [error, setError] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[0.75rem] text-[var(--text-muted)]">
        This block type doesn&apos;t have a simple editor yet — edit its raw content below.
      </p>
      <Textarea
        aria-label="Block JSON"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const parsed = JSON.parse(e.target.value) as Block;
            setError(null);
            onChange(parsed);
          } catch {
            setError("Invalid JSON — changes won't be saved until this is fixed.");
          }
        }}
        rows={6}
        className="font-mono text-[0.75rem]"
      />
      {error && <p className="text-[0.75rem] font-medium text-danger-700">{error}</p>}
    </div>
  );
}
