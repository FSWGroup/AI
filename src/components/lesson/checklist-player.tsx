"use client";

import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { Glyph, Icon } from "@/components/icons";
import { postProgress } from "@/components/lesson/progress-client";
import type { LessonPlayerProps } from "@/components/lesson/types";

interface ChecklistItem {
  id: string;
  text: string;
}

export function ChecklistPlayer({ lesson, progress, onComplete, onProgress }: LessonPlayerProps) {
  const content = lesson.content as { requireAll?: boolean; items?: ChecklistItem[] };
  const items = content.items ?? [];
  const requireAll = content.requireAll !== false;

  const [state, setState] = React.useState<Record<string, boolean>>(
    () => ((progress?.checklistState as Record<string, boolean> | null) ?? {}),
  );
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const completed = progress?.status === "COMPLETED";

  const checkedCount = items.filter((item) => state[item.id]).length;

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="assignment" className="h-5 w-5" />}
        title="No checklist items yet"
        description="This checklist doesn't have any items configured yet."
      />
    );
  }

  async function toggle(item: ChecklistItem) {
    const nextChecked = !state[item.id];
    setPendingId(item.id);
    setState((prev) => ({ ...prev, [item.id]: nextChecked }));
    try {
      const result = await postProgress(lesson.id, { checklistItemId: item.id, checklistChecked: nextChecked });
      if (result.status === "COMPLETED" && !completed) {
        toast.success("All items checked — lesson complete.");
        onComplete();
      } else {
        onProgress();
      }
    } catch (error) {
      setState((prev) => ({ ...prev, [item.id]: !nextChecked }));
      toast.error(error instanceof Error ? error.message : "Couldn't save that item.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[0.8125rem] font-medium text-[var(--text-secondary)]">
          {requireAll ? "Check every item to complete this lesson." : "Work through this checklist."}
        </p>
        {completed && <Badge tone="success">Completed</Badge>}
      </div>

      <ProgressBar value={(checkedCount / items.length) * 100} label={`${checkedCount} of ${items.length} checked`} />

      <ul className="flex flex-col gap-1.5">
        {items.map((item) => {
          const checked = Boolean(state[item.id]);
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => toggle(item)}
                disabled={pendingId === item.id}
                aria-pressed={checked}
                className="flex w-full items-center gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-3 text-left text-[0.875rem] transition-colors hover:border-[var(--border-default)] disabled:opacity-70"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                    checked
                      ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white"
                      : "border-[var(--border-default)] bg-[var(--surface-card)]"
                  }`}
                >
                  {checked && <Glyph name="check" className="h-3.5 w-3.5" />}
                </span>
                <span className={checked ? "text-[var(--text-muted)] line-through" : "text-[var(--text-primary)]"}>
                  {item.text}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
