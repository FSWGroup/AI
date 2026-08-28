import type { Block } from "@/lib/content/types";
import { cn } from "@/lib/utils";
import { renderBlockList, type RenderBlockListOptions } from "@/lib/content/render-blocks";
import { ChecklistBlockView, QuestionBlockView, TabsBlockView } from "@/lib/content/render-interactive";

/**
 * Server-renderable block renderer — the single component that turns a
 * `Block[]` (SOP body, lesson body, AI draft preview) into markup.
 *
 * `BlockRenderer` itself has no "use client" directive, so when it is
 * rendered from a real Server Component (the SOP reader page) it ships zero
 * client JS beyond the small interactive islands (checklist, tabs, question).
 * When imported from an already-client component (the block editor's live
 * preview) it behaves like an ordinary component — nothing here depends on a
 * server-only API. `BlockRendererClient` (re-exported below, defined in
 * render-interactive.tsx) is available for callers that want an explicitly
 * client-first entry point.
 */

export interface BlockRendererProps extends RenderBlockListOptions {
  blocks: Block[];
  className?: string;
}

const INTERACTIVE_RENDERERS = {
  Checklist: ChecklistBlockView,
  Tabs: TabsBlockView,
  Question: QuestionBlockView,
};

export function BlockRenderer({ blocks, className, onChecklistChange, checklistState }: BlockRendererProps) {
  if (!blocks || blocks.length === 0) return null;
  return (
    <div className={cn("prose-fsw", className)}>
      {renderBlockList(blocks, INTERACTIVE_RENDERERS, { onChecklistChange, checklistState })}
    </div>
  );
}

export { BlockRendererClient } from "@/lib/content/render-interactive";
export { renderInlineText } from "@/lib/content/render-blocks";
