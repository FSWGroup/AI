"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { listVideoJobsAction, retryVideoJobAction, type VideoJobSummary } from "@/app/(app)/admin/video-studio/actions";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, Glyph } from "@/components/icons";
import { VIDEO_MODE_LABELS, type VideoMode } from "@/lib/video/types";

const STATUS_LABELS: Record<string, string> = {
  QUEUED: "Queued",
  GENERATING_SCRIPT: "Writing script",
  AWAITING_REVIEW: "Awaiting your review",
  GENERATING_AUDIO: "Generating narration",
  CREATING_SCENES: "Building scenes",
  RENDERING: "Rendering",
  UPLOADING: "Uploading",
  COMPLETE: "Complete",
  FAILED: "Failed",
  CANCELED: "Canceled",
};

const STATUS_TONE: Record<string, BadgeTone> = {
  QUEUED: "neutral",
  GENERATING_SCRIPT: "info",
  AWAITING_REVIEW: "blue",
  GENERATING_AUDIO: "info",
  CREATING_SCENES: "info",
  RENDERING: "info",
  UPLOADING: "info",
  COMPLETE: "success",
  FAILED: "danger",
  CANCELED: "neutral",
};

const ACTIVE_STATUSES = new Set(["QUEUED", "GENERATING_SCRIPT", "GENERATING_AUDIO", "CREATING_SCENES", "RENDERING", "UPLOADING"]);

export function VideoJobList({ initialJobs }: { initialJobs: VideoJobSummary[] }) {
  const [jobs, setJobs] = React.useState(initialJobs);
  const [retryingId, setRetryingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const hasActive = jobs.some((j) => ACTIVE_STATUSES.has(j.status));
    if (!hasActive) return;
    const interval = setInterval(async () => {
      const result = await listVideoJobsAction();
      if (result.ok) setJobs(result.data);
    }, 4000);
    return () => clearInterval(interval);
  }, [jobs]);

  async function handleRetry(id: string) {
    setRetryingId(id);
    try {
      const result = await retryVideoJobAction(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Retrying.");
      const refreshed = await listVideoJobsAction();
      if (refreshed.ok) setJobs(refreshed.data);
    } finally {
      setRetryingId(null);
    }
  }

  if (jobs.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="video" className="h-5 w-5" />}
        title="No videos yet"
        description="Generate your first AI training video from a prompt, an SOP, a course, or a document."
        actions={
          <Link
            href="/admin/video-studio/new"
            className="inline-flex h-9.5 items-center justify-center rounded-md bg-[var(--brand-primary)] px-4 text-sm font-medium text-white hover:bg-[var(--brand-primary-hover)]"
          >
            New video
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {jobs.map((job) => (
        <Card key={job.id} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Link href={`/admin/video-studio/${job.id}`} className="truncate font-medium text-[var(--text-primary)] hover:underline">
                  {job.title}
                </Link>
                <Badge tone={STATUS_TONE[job.status] ?? "neutral"}>{STATUS_LABELS[job.status] ?? job.status}</Badge>
              </div>
              <p className="mt-0.5 text-[0.75rem] text-[var(--text-muted)]">
                {VIDEO_MODE_LABELS[job.mode as VideoMode] ?? job.mode} · {new Date(job.createdAt).toLocaleString()}
              </p>
              {ACTIVE_STATUSES.has(job.status) && (
                <div className="mt-2 max-w-sm">
                  <ProgressBar value={job.progress} label={`${STATUS_LABELS[job.status]} progress`} size="sm" />
                </div>
              )}
              {job.status === "FAILED" && job.error && (
                <p className="mt-1 text-[0.75rem] text-danger-700">{job.error}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {job.status === "FAILED" && (
                <Button size="sm" variant="outline" loading={retryingId === job.id} onClick={() => handleRetry(job.id)}>
                  <Glyph name="arrow-right" className="h-3.5 w-3.5 rotate-180" />
                  Retry
                </Button>
              )}
              <Link
                href={`/admin/video-studio/${job.id}`}
                className="inline-flex h-8 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-[0.8125rem] font-medium hover:bg-[var(--surface-sunken)]"
              >
                {job.status === "AWAITING_REVIEW" ? "Review plan" : job.status === "COMPLETE" ? "View" : "Open"}
              </Link>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
