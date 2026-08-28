"use client";

import type { Block } from "@/lib/content/types";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Glyph } from "@/components/icons";
import { newId } from "@/components/editor/block-defaults";

type Extracted<T extends Block["type"]> = Extract<Block, { type: T }>;

function updateAt<T>(arr: T[], index: number, value: T): T[] {
  const copy = arr.slice();
  copy[index] = value;
  return copy;
}

function removeAt<T>(arr: T[], index: number): T[] {
  return arr.filter((_, i) => i !== index);
}

/** Small "Remove" icon button reused by every array-field row. */
function RemoveRowButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button type="button" variant="ghost" size="icon" onClick={onClick} aria-label={label}>
      <Glyph name="trash" className="h-4 w-4" />
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Text blocks
// ---------------------------------------------------------------------------

function HeadingEditor({ block, onChange }: { block: Extracted<"heading">; onChange: (b: Block) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_1fr]">
      <Field label="Level" htmlFor={`${block.id}-level`}>
        <Select
          value={String(block.level)}
          onChange={(e) => onChange({ ...block, level: Number(e.target.value) as 2 | 3 | 4 })}
        >
          <option value="2">Heading 2</option>
          <option value="3">Heading 3</option>
          <option value="4">Heading 4</option>
        </Select>
      </Field>
      <Field label="Text" htmlFor={`${block.id}-text`}>
        <Input value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} />
      </Field>
    </div>
  );
}

function ParagraphEditor({ block, onChange }: { block: Extracted<"paragraph">; onChange: (b: Block) => void }) {
  return (
    <Field label="Text" htmlFor={`${block.id}-text`} hint="Supports **bold**, *italic*, `code`, and [link text](https://…).">
      <Textarea rows={4} value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} />
    </Field>
  );
}

function ListEditor({ block, onChange }: { block: Extracted<"list">; onChange: (b: Block) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-[0.8125rem] text-[var(--text-primary)]">
        <input
          type="checkbox"
          checked={block.ordered}
          onChange={(e) => onChange({ ...block, ordered: e.target.checked })}
          className="h-4 w-4 accent-[var(--brand-primary)]"
        />
        Numbered (ordered) list
      </label>
      <div className="flex flex-col gap-2">
        {block.items.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={item}
              aria-label={`Item ${index + 1}`}
              onChange={(e) => onChange({ ...block, items: updateAt(block.items, index, e.target.value) })}
            />
            <RemoveRowButton label={`Remove item ${index + 1}`} onClick={() => onChange({ ...block, items: removeAt(block.items, index) })} />
          </div>
        ))}
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={() => onChange({ ...block, items: [...block.items, ""] })}>
        <Glyph name="plus" className="h-3.5 w-3.5" /> Add item
      </Button>
    </div>
  );
}

function TableEditor({ block, onChange }: { block: Extracted<"table">; onChange: (b: Block) => void }) {
  function addColumn() {
    onChange({
      ...block,
      headers: [...block.headers, `Column ${block.headers.length + 1}`],
      rows: block.rows.map((row) => [...row, ""]),
    });
  }
  function removeColumn(colIndex: number) {
    onChange({
      ...block,
      headers: removeAt(block.headers, colIndex),
      rows: block.rows.map((row) => removeAt(row, colIndex)),
    });
  }
  function addRow() {
    onChange({ ...block, rows: [...block.rows, block.headers.map(() => "")] });
  }
  function removeRow(rowIndex: number) {
    onChange({ ...block, rows: removeAt(block.rows, rowIndex) });
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="Caption (optional)" htmlFor={`${block.id}-caption`}>
        <Input value={block.caption ?? ""} onChange={(e) => onChange({ ...block, caption: e.target.value })} />
      </Field>
      <div className="overflow-x-auto rounded-md border border-[var(--border-subtle)]">
        <table className="w-full border-collapse text-[0.8125rem]">
          <thead>
            <tr>
              {block.headers.map((header, colIndex) => (
                <th key={colIndex} className="border-b border-r border-[var(--border-subtle)] p-1.5 last:border-r-0">
                  <div className="flex items-center gap-1">
                    <Input
                      aria-label={`Column ${colIndex + 1} header`}
                      value={header}
                      onChange={(e) => onChange({ ...block, headers: updateAt(block.headers, colIndex, e.target.value) })}
                      className="h-8 text-[0.8125rem] font-semibold"
                    />
                    <RemoveRowButton label={`Remove column ${colIndex + 1}`} onClick={() => removeColumn(colIndex)} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, colIndex) => (
                  <td key={colIndex} className="border-b border-r border-[var(--border-subtle)] p-1.5 last:border-r-0">
                    <Input
                      aria-label={`Row ${rowIndex + 1}, column ${colIndex + 1}`}
                      value={cell}
                      onChange={(e) =>
                        onChange({ ...block, rows: updateAt(block.rows, rowIndex, updateAt(row, colIndex, e.target.value)) })
                      }
                      className="h-8 text-[0.8125rem]"
                    />
                  </td>
                ))}
                <td className="border-b border-[var(--border-subtle)] p-1.5">
                  <RemoveRowButton label={`Remove row ${rowIndex + 1}`} onClick={() => removeRow(rowIndex)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={addColumn}>
          <Glyph name="plus" className="h-3.5 w-3.5" /> Add column
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={addRow}>
          <Glyph name="plus" className="h-3.5 w-3.5" /> Add row
        </Button>
      </div>
    </div>
  );
}

function CalloutEditor({ block, onChange }: { block: Extracted<"callout">; onChange: (b: Block) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Tone" htmlFor={`${block.id}-tone`}>
        <Select value={block.tone} onChange={(e) => onChange({ ...block, tone: e.target.value as typeof block.tone })}>
          <option value="info">Info</option>
          <option value="tip">Tip</option>
          <option value="note">Note</option>
        </Select>
      </Field>
      <Field label="Title (optional)" htmlFor={`${block.id}-title`}>
        <Input value={block.title ?? ""} onChange={(e) => onChange({ ...block, title: e.target.value })} />
      </Field>
      <Field label="Text" htmlFor={`${block.id}-text`}>
        <Textarea rows={3} value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} />
      </Field>
    </div>
  );
}

function WarningEditor({ block, onChange }: { block: Extracted<"warning">; onChange: (b: Block) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Severity" htmlFor={`${block.id}-severity`}>
        <Select value={block.severity} onChange={(e) => onChange({ ...block, severity: e.target.value as typeof block.severity })}>
          <option value="caution">Caution</option>
          <option value="warning">Warning</option>
          <option value="danger">Danger</option>
        </Select>
      </Field>
      <Field label="Title (optional)" htmlFor={`${block.id}-title`}>
        <Input value={block.title ?? ""} onChange={(e) => onChange({ ...block, title: e.target.value })} />
      </Field>
      <Field label="Text" htmlFor={`${block.id}-text`}>
        <Textarea rows={3} value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Media blocks
// ---------------------------------------------------------------------------

function ImageEditor({ block, onChange }: { block: Extracted<"image">; onChange: (b: Block) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Media ID" htmlFor={`${block.id}-media`} hint="The ID of an item already uploaded to the Media Library.">
        <Input value={block.mediaId} onChange={(e) => onChange({ ...block, mediaId: e.target.value })} />
      </Field>
      <Field
        label="Alt text"
        htmlFor={`${block.id}-alt`}
        required
        error={block.altText.trim().length === 0 ? "Alt text is required — describe the image for screen reader users." : undefined}
      >
        <Input value={block.altText} onChange={(e) => onChange({ ...block, altText: e.target.value })} />
      </Field>
      <Field label="Caption (optional)" htmlFor={`${block.id}-caption`}>
        <Input value={block.caption ?? ""} onChange={(e) => onChange({ ...block, caption: e.target.value })} />
      </Field>
    </div>
  );
}

function VideoEditor({ block, onChange }: { block: Extracted<"video">; onChange: (b: Block) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Media ID (optional)" htmlFor={`${block.id}-media`} hint="Use this for an uploaded video, or provide an external URL below.">
        <Input value={block.mediaId ?? ""} onChange={(e) => onChange({ ...block, mediaId: e.target.value || undefined })} />
      </Field>
      <Field label="External URL (optional)" htmlFor={`${block.id}-url`}>
        <Input
          type="url"
          value={block.externalUrl ?? ""}
          onChange={(e) => onChange({ ...block, externalUrl: e.target.value || undefined })}
        />
      </Field>
      <Field label="Title (optional)" htmlFor={`${block.id}-title`}>
        <Input value={block.title ?? ""} onChange={(e) => onChange({ ...block, title: e.target.value })} />
      </Field>
      <Field label="Caption (optional)" htmlFor={`${block.id}-caption`}>
        <Input value={block.caption ?? ""} onChange={(e) => onChange({ ...block, caption: e.target.value })} />
      </Field>
    </div>
  );
}

function FileEditor({ block, onChange }: { block: Extracted<"file">; onChange: (b: Block) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Media ID" htmlFor={`${block.id}-media`} hint="The ID of the file in the Media Library.">
        <Input value={block.mediaId} onChange={(e) => onChange({ ...block, mediaId: e.target.value })} />
      </Field>
      <Field label="Label (optional)" htmlFor={`${block.id}-label`}>
        <Input value={block.label ?? ""} onChange={(e) => onChange({ ...block, label: e.target.value })} />
      </Field>
    </div>
  );
}

function EmbedEditor({ block, onChange }: { block: Extracted<"embed">; onChange: (b: Block) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="URL" htmlFor={`${block.id}-url`}>
        <Input type="url" value={block.url} onChange={(e) => onChange({ ...block, url: e.target.value })} />
      </Field>
      <Field label="Title (optional)" htmlFor={`${block.id}-title`}>
        <Input value={block.title ?? ""} onChange={(e) => onChange({ ...block, title: e.target.value })} />
      </Field>
      <Field label="Height (px)" htmlFor={`${block.id}-height`}>
        <Input
          type="number"
          min={120}
          max={1200}
          value={block.height}
          onChange={(e) => onChange({ ...block, height: Number(e.target.value) || 420 })}
        />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flowchart
// ---------------------------------------------------------------------------

function FlowchartEditor({ block, onChange }: { block: Extracted<"flowchart">; onChange: (b: Block) => void }) {
  function addNode() {
    const id = newId();
    onChange({ ...block, nodes: [...block.nodes, { id, label: "New step", kind: "step" }] });
  }
  function removeNode(index: number) {
    const removedId = block.nodes[index]?.id;
    onChange({
      ...block,
      nodes: removeAt(block.nodes, index),
      edges: removedId ? block.edges.filter((e) => e.from !== removedId && e.to !== removedId) : block.edges,
    });
  }
  function addEdge() {
    const first = block.nodes[0];
    const second = block.nodes[1] ?? block.nodes[0];
    if (!first || !second) return;
    onChange({ ...block, edges: [...block.edges, { from: first.id, to: second.id }] });
  }
  function removeEdge(index: number) {
    onChange({ ...block, edges: removeAt(block.edges, index) });
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="Title (optional)" htmlFor={`${block.id}-title`}>
        <Input value={block.title ?? ""} onChange={(e) => onChange({ ...block, title: e.target.value })} />
      </Field>

      <div>
        <p className="mb-2 text-[0.8125rem] font-semibold text-[var(--text-primary)]">Nodes</p>
        <div className="flex flex-col gap-2">
          {block.nodes.map((node, index) => (
            <div key={node.id} className="flex items-center gap-2">
              <Select
                aria-label={`Node ${index + 1} kind`}
                value={node.kind}
                onChange={(e) => onChange({ ...block, nodes: updateAt(block.nodes, index, { ...node, kind: e.target.value as typeof node.kind }) })}
                className="w-32 shrink-0"
              >
                <option value="start">Start</option>
                <option value="step">Step</option>
                <option value="decision">Decision</option>
                <option value="end">End</option>
              </Select>
              <Input
                aria-label={`Node ${index + 1} label`}
                value={node.label}
                onChange={(e) => onChange({ ...block, nodes: updateAt(block.nodes, index, { ...node, label: e.target.value }) })}
              />
              <RemoveRowButton label={`Remove node ${index + 1}`} onClick={() => removeNode(index)} />
            </div>
          ))}
        </div>
        <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={addNode}>
          <Glyph name="plus" className="h-3.5 w-3.5" /> Add node
        </Button>
      </div>

      <div>
        <p className="mb-2 text-[0.8125rem] font-semibold text-[var(--text-primary)]">Connections</p>
        <div className="flex flex-col gap-2">
          {block.edges.map((edge, index) => (
            <div key={index} className="flex items-center gap-2">
              <Select
                aria-label={`Connection ${index + 1} from`}
                value={edge.from}
                onChange={(e) => onChange({ ...block, edges: updateAt(block.edges, index, { ...edge, from: e.target.value }) })}
              >
                {block.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label || n.id}
                  </option>
                ))}
              </Select>
              <Glyph name="arrow-right" className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
              <Select
                aria-label={`Connection ${index + 1} to`}
                value={edge.to}
                onChange={(e) => onChange({ ...block, edges: updateAt(block.edges, index, { ...edge, to: e.target.value }) })}
              >
                {block.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label || n.id}
                  </option>
                ))}
              </Select>
              <Input
                aria-label={`Connection ${index + 1} label`}
                placeholder="Label (e.g. Yes)"
                value={edge.label ?? ""}
                onChange={(e) => onChange({ ...block, edges: updateAt(block.edges, index, { ...edge, label: e.target.value }) })}
                className="w-32"
              />
              <RemoveRowButton label={`Remove connection ${index + 1}`} onClick={() => removeEdge(index)} />
            </div>
          ))}
        </div>
        <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={addEdge} disabled={block.nodes.length === 0}>
          <Glyph name="plus" className="h-3.5 w-3.5" /> Add connection
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checklist / code / accordion / tabs / related / question / AI explanation
// ---------------------------------------------------------------------------

function ChecklistEditor({ block, onChange }: { block: Extracted<"checklist">; onChange: (b: Block) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Title (optional)" htmlFor={`${block.id}-title`}>
        <Input value={block.title ?? ""} onChange={(e) => onChange({ ...block, title: e.target.value })} />
      </Field>
      <label className="flex items-center gap-2 text-[0.8125rem] text-[var(--text-primary)]">
        <input
          type="checkbox"
          checked={block.requireAll}
          onChange={(e) => onChange({ ...block, requireAll: e.target.checked })}
          className="h-4 w-4 accent-[var(--brand-primary)]"
        />
        Learner must check every item to complete this lesson
      </label>
      <div className="flex flex-col gap-2">
        {block.items.map((item, index) => (
          <div key={item.id} className="flex items-center gap-2">
            <Input
              aria-label={`Checklist item ${index + 1}`}
              value={item.text}
              onChange={(e) => onChange({ ...block, items: updateAt(block.items, index, { ...item, text: e.target.value }) })}
            />
            <RemoveRowButton label={`Remove item ${index + 1}`} onClick={() => onChange({ ...block, items: removeAt(block.items, index) })} />
          </div>
        ))}
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={() => onChange({ ...block, items: [...block.items, { id: newId(), text: "" }] })}>
        <Glyph name="plus" className="h-3.5 w-3.5" /> Add item
      </Button>
    </div>
  );
}

const CODE_LANGUAGES = ["text", "bash", "javascript", "typescript", "python", "sql", "json", "yaml", "html", "css"];

function CodeEditor({ block, onChange }: { block: Extracted<"code">; onChange: (b: Block) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Language" htmlFor={`${block.id}-lang`}>
        <Select value={block.language} onChange={(e) => onChange({ ...block, language: e.target.value })}>
          {CODE_LANGUAGES.map((lang) => (
            <option key={lang} value={lang}>
              {lang}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Code" htmlFor={`${block.id}-code`}>
        <Textarea rows={6} className="font-mono" value={block.code} onChange={(e) => onChange({ ...block, code: e.target.value })} />
      </Field>
    </div>
  );
}

function AccordionEditor({ block, onChange }: { block: Extracted<"accordion">; onChange: (b: Block) => void }) {
  return (
    <div className="flex flex-col gap-3">
      {block.sections.map((section, index) => (
        <div key={section.id} className="rounded-md border border-[var(--border-subtle)] p-3">
          <div className="flex items-center gap-2">
            <Input
              aria-label={`Section ${index + 1} title`}
              value={section.title}
              onChange={(e) => onChange({ ...block, sections: updateAt(block.sections, index, { ...section, title: e.target.value }) })}
            />
            <RemoveRowButton label={`Remove section ${index + 1}`} onClick={() => onChange({ ...block, sections: removeAt(block.sections, index) })} />
          </div>
          <Textarea
            className="mt-2"
            rows={3}
            aria-label={`Section ${index + 1} text`}
            value={section.text}
            onChange={(e) => onChange({ ...block, sections: updateAt(block.sections, index, { ...section, text: e.target.value }) })}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onChange({ ...block, sections: [...block.sections, { id: newId(), title: `Section ${block.sections.length + 1}`, text: "" }] })}
      >
        <Glyph name="plus" className="h-3.5 w-3.5" /> Add section
      </Button>
    </div>
  );
}

function TabsEditor({ block, onChange }: { block: Extracted<"tabs">; onChange: (b: Block) => void }) {
  return (
    <div className="flex flex-col gap-3">
      {block.tabs.map((tab, index) => (
        <div key={tab.id} className="rounded-md border border-[var(--border-subtle)] p-3">
          <div className="flex items-center gap-2">
            <Input
              aria-label={`Tab ${index + 1} label`}
              value={tab.label}
              onChange={(e) => onChange({ ...block, tabs: updateAt(block.tabs, index, { ...tab, label: e.target.value }) })}
            />
            <RemoveRowButton label={`Remove tab ${index + 1}`} onClick={() => onChange({ ...block, tabs: removeAt(block.tabs, index) })} />
          </div>
          <Textarea
            className="mt-2"
            rows={3}
            aria-label={`Tab ${index + 1} content`}
            value={tab.text}
            onChange={(e) => onChange({ ...block, tabs: updateAt(block.tabs, index, { ...tab, text: e.target.value }) })}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onChange({ ...block, tabs: [...block.tabs, { id: newId(), label: `Tab ${block.tabs.length + 1}`, text: "" }] })}
      >
        <Glyph name="plus" className="h-3.5 w-3.5" /> Add tab
      </Button>
    </div>
  );
}

const RELATED_ENTITY_TYPES: Extracted<"related">["items"][number]["entityType"][] = ["SOP", "COURSE", "LEARNING_PATH"];

function RelatedEditor({ block, onChange }: { block: Extracted<"related">; onChange: (b: Block) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Section title (optional)" htmlFor={`${block.id}-title`}>
        <Input value={block.title ?? ""} onChange={(e) => onChange({ ...block, title: e.target.value })} />
      </Field>
      <div className="flex flex-col gap-2">
        {block.items.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <Select
              aria-label={`Related item ${index + 1} type`}
              value={item.entityType}
              onChange={(e) => onChange({ ...block, items: updateAt(block.items, index, { ...item, entityType: e.target.value as typeof item.entityType }) })}
              className="w-40 shrink-0"
            >
              {RELATED_ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === "LEARNING_PATH" ? "Learning path" : t === "COURSE" ? "Course" : "SOP"}
                </option>
              ))}
            </Select>
            <Input
              aria-label={`Related item ${index + 1} ID`}
              placeholder="Entity ID"
              value={item.entityId}
              onChange={(e) => onChange({ ...block, items: updateAt(block.items, index, { ...item, entityId: e.target.value }) })}
              className="w-40"
            />
            <Input
              aria-label={`Related item ${index + 1} label`}
              placeholder="Display label"
              value={item.label}
              onChange={(e) => onChange({ ...block, items: updateAt(block.items, index, { ...item, label: e.target.value }) })}
            />
            <RemoveRowButton label={`Remove related item ${index + 1}`} onClick={() => onChange({ ...block, items: removeAt(block.items, index) })} />
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onChange({ ...block, items: [...block.items, { entityType: "SOP", entityId: "", label: "" }] })}
      >
        <Glyph name="plus" className="h-3.5 w-3.5" /> Add related item
      </Button>
    </div>
  );
}

function QuestionEditor({ block, onChange }: { block: Extracted<"question">; onChange: (b: Block) => void }) {
  function removeOption(index: number) {
    const nextOptions = removeAt(block.options, index);
    const nextCorrect = block.correctIndex === index ? 0 : block.correctIndex > index ? block.correctIndex - 1 : block.correctIndex;
    onChange({ ...block, options: nextOptions, correctIndex: nextCorrect });
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="Prompt" htmlFor={`${block.id}-prompt`}>
        <Textarea rows={2} value={block.prompt} onChange={(e) => onChange({ ...block, prompt: e.target.value })} />
      </Field>
      <div>
        <p className="mb-2 text-[0.8125rem] font-semibold text-[var(--text-primary)]">Options — select the correct one</p>
        <div className="flex flex-col gap-2">
          {block.options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="radio"
                name={`${block.id}-correct`}
                checked={block.correctIndex === index}
                onChange={() => onChange({ ...block, correctIndex: index })}
                aria-label={`Option ${index + 1} is correct`}
                className="h-4 w-4 accent-[var(--brand-primary)]"
              />
              <Input
                aria-label={`Option ${index + 1}`}
                value={option}
                onChange={(e) => onChange({ ...block, options: updateAt(block.options, index, e.target.value) })}
              />
              <RemoveRowButton
                label={`Remove option ${index + 1}`}
                onClick={() => {
                  if (block.options.length > 2) removeOption(index);
                }}
              />
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-2"
          onClick={() => onChange({ ...block, options: [...block.options, ""] })}
        >
          <Glyph name="plus" className="h-3.5 w-3.5" /> Add option
        </Button>
      </div>
      <Field label="Explanation (optional)" htmlFor={`${block.id}-explanation`}>
        <Textarea rows={2} value={block.explanation ?? ""} onChange={(e) => onChange({ ...block, explanation: e.target.value })} />
      </Field>
    </div>
  );
}

function AiExplanationEditor({ block, onChange }: { block: Extracted<"ai_explanation">; onChange: (b: Block) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.75rem] text-[var(--text-muted)]">
        Rendered with a visible "AI-generated" badge so readers always know its origin.
      </p>
      <Field label="Text" htmlFor={`${block.id}-text`}>
        <Textarea rows={4} value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} />
      </Field>
      <Field label="Reviewed by (optional)" htmlFor={`${block.id}-reviewed`}>
        <Input value={block.reviewedBy ?? ""} onChange={(e) => onChange({ ...block, reviewedBy: e.target.value })} />
      </Field>
    </div>
  );
}

function DividerEditor() {
  return <p className="text-[0.8125rem] text-[var(--text-muted)]">Renders a horizontal divider. No settings.</p>;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function BlockFieldEditor({ block, onChange }: { block: Block; onChange: (next: Block) => void }) {
  switch (block.type) {
    case "heading":
      return <HeadingEditor block={block} onChange={onChange} />;
    case "paragraph":
      return <ParagraphEditor block={block} onChange={onChange} />;
    case "list":
      return <ListEditor block={block} onChange={onChange} />;
    case "table":
      return <TableEditor block={block} onChange={onChange} />;
    case "callout":
      return <CalloutEditor block={block} onChange={onChange} />;
    case "warning":
      return <WarningEditor block={block} onChange={onChange} />;
    case "image":
      return <ImageEditor block={block} onChange={onChange} />;
    case "video":
      return <VideoEditor block={block} onChange={onChange} />;
    case "file":
      return <FileEditor block={block} onChange={onChange} />;
    case "embed":
      return <EmbedEditor block={block} onChange={onChange} />;
    case "flowchart":
      return <FlowchartEditor block={block} onChange={onChange} />;
    case "checklist":
      return <ChecklistEditor block={block} onChange={onChange} />;
    case "code":
      return <CodeEditor block={block} onChange={onChange} />;
    case "accordion":
      return <AccordionEditor block={block} onChange={onChange} />;
    case "tabs":
      return <TabsEditor block={block} onChange={onChange} />;
    case "related":
      return <RelatedEditor block={block} onChange={onChange} />;
    case "question":
      return <QuestionEditor block={block} onChange={onChange} />;
    case "ai_explanation":
      return <AiExplanationEditor block={block} onChange={onChange} />;
    case "divider":
      return <DividerEditor />;
  }
}
