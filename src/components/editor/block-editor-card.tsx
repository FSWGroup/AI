"use client";

import type { Block } from "@/lib/content/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Glyph } from "@/components/icons";
import { BLOCK_LABELS } from "@/components/editor/block-defaults";
import { BlockFieldEditor } from "@/components/editor/block-field-editor";
import type { BlockIssue } from "@/components/editor/validation";

export function BlockEditorCard({
  block,
  index,
  total,
  issues,
  onChange,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onDeleteRequest,
}: {
  block: Block;
  index: number;
  total: number;
  issues: BlockIssue[];
  onChange: (next: Block) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onDeleteRequest: () => void;
}) {
  const label = BLOCK_LABELS[block.type];
  const hasBlocking = issues.some((issue) => issue.blocking);

  return (
    <div className={cn("rounded-lg border bg-[var(--surface-card)]", hasBlocking ? "border-danger-300" : "border-[var(--border-subtle)]")}>
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Glyph name="drag" className="h-4 w-4 shrink-0 cursor-grab text-[var(--text-muted)]" />
          <Badge tone="neutral">{`${index + 1}. ${label}`}</Badge>
          {hasBlocking && <Badge tone="danger">Needs attention</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label={`Move ${label} block up`} disabled={index === 0} onClick={onMoveUp}>
            <Glyph name="chevron-down" className="h-4 w-4 rotate-180" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Move ${label} block down`} disabled={index === total - 1} onClick={onMoveDown}>
            <Glyph name="chevron-down" className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Duplicate ${label} block`} onClick={onDuplicate}>
            <Glyph name="copy" className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Delete ${label} block`} onClick={onDeleteRequest}>
            <Glyph name="trash" className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="p-4">
        <BlockFieldEditor block={block} onChange={onChange} />
        {issues.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1">
            {issues.map((issue, i) => (
              <li key={i} className={cn("text-[0.75rem]", issue.blocking ? "font-medium text-danger-700" : "text-warning-700")}>
                {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
