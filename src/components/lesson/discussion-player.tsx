"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";
import { initials } from "@/lib/utils";
import { MarkCompleteButton } from "@/components/lesson/mark-complete-button";
import type { LessonPlayerProps } from "@/components/lesson/types";

export function DiscussionPlayer({ lesson, progress, viewer: _viewer, extra, onComplete, onProgress, postComment }: LessonPlayerProps) {
  const comments = extra?.comments ?? [];
  const [body, setBody] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const prompt = (lesson.content as { prompt?: string }).prompt;
  const alreadyComplete = progress?.status === "COMPLETED";

  async function submit() {
    if (!postComment || !body.trim()) return;
    setSubmitting(true);
    try {
      const result = await postComment({ lessonId: lesson.id, body: body.trim() });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't post your comment.");
        return;
      }
      setBody("");
      onProgress();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {prompt && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-6">
          <p className="text-[0.9375rem] leading-relaxed text-[var(--text-primary)]">{prompt}</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {comments.length === 0 ? (
          <EmptyState
            icon={<Icon name="ai" className="h-5 w-5" />}
            title="No comments yet"
            description="Be the first to share your thoughts."
          />
        ) : (
          comments
            .filter((c) => !c.parentId)
            .map((c) => (
              <div key={c.id} className="flex gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[0.75rem] font-semibold text-[var(--text-secondary)]">
                  {initials(c.authorName)}
                </span>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{c.authorName}</span>
                    <span className="text-[0.75rem] text-[var(--text-muted)]">
                      {new Date(c.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-[0.875rem] text-[var(--text-secondary)]">{c.body}</p>
                </div>
              </div>
            ))
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Share your thoughts…"
          aria-label="Write a comment"
        />
        <div className="flex items-center justify-between">
          <Button size="sm" onClick={submit} loading={submitting} disabled={!body.trim()}>
            Post comment
          </Button>
          <MarkCompleteButton lessonId={lesson.id} alreadyComplete={alreadyComplete} onComplete={onComplete} />
        </div>
      </div>
    </div>
  );
}
