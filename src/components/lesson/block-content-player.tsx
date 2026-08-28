"use client";

import { BlockRenderer } from "@/lib/content/render";
import type { Block } from "@/lib/content/types";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";
import { MarkCompleteButton } from "@/components/lesson/mark-complete-button";
import type { LessonPlayerProps } from "@/components/lesson/types";

/** RICH_TEXT, FLOWCHART, and SOP_REF all render a Block[] body plus a mark-complete action. */
export function BlockContentPlayer({ lesson, progress, extra, onComplete }: LessonPlayerProps) {
  const isSopRef = lesson.type === "SOP_REF";
  const blocks = (isSopRef ? extra?.sopBlocks : lesson.content.blocks) as Block[] | undefined;
  const alreadyComplete = progress?.status === "COMPLETED";

  return (
    <div className="flex flex-col gap-5">
      {isSopRef && (
        <div className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-[0.8125rem] text-[var(--text-secondary)]">
          <Icon name="sop" className="h-4 w-4 shrink-0" />
          <span>
            This lesson is the current published version of{" "}
            <strong className="font-semibold text-[var(--text-primary)]">{extra?.sopTitle ?? "the referenced SOP"}</strong>.
          </span>
        </div>
      )}

      {!blocks || blocks.length === 0 ? (
        <EmptyState
          icon={<Icon name="content" className="h-5 w-5" />}
          title="No content yet"
          description="This lesson doesn't have any content authored yet. Check back later, or contact the course owner."
        />
      ) : (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-6">
          <BlockRenderer blocks={blocks} />
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4">
        {lesson.required ? <Badge tone="navy">Required</Badge> : <Badge tone="neutral">Optional</Badge>}
        <MarkCompleteButton lessonId={lesson.id} alreadyComplete={alreadyComplete} onComplete={onComplete} />
      </div>
    </div>
  );
}
