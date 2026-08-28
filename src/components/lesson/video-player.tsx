"use client";

import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";
import { postProgress } from "@/components/lesson/progress-client";
import type { LessonPlayerProps } from "@/components/lesson/types";

const REPORT_INTERVAL_MS = 10_000;

export function VideoPlayer({ lesson, course, progress, extra, onComplete, onProgress }: LessonPlayerProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const resumedRef = React.useRef(false);
  const lastReportedRef = React.useRef(0);
  const [watchedPercent, setWatchedPercent] = React.useState(progress?.videoWatchedPercent ?? 0);
  const [completedNow, setCompletedNow] = React.useState(progress?.status === "COMPLETED");

  const content = lesson.content as { mediaId?: string | null; externalUrl?: string | null };
  const src = content.externalUrl ?? (content.mediaId ? `/api/media/${content.mediaId}` : null);
  const captionsVtt = typeof extra?.sopBlocks === "string" ? undefined : undefined; // reserved
  const captionsDataUrl = (lesson.content as { captionsVttDataUrl?: string }).captionsVttDataUrl;

  const report = React.useCallback(
    async (immediate: boolean) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
      const now = Date.now();
      if (!immediate && now - lastReportedRef.current < REPORT_INTERVAL_MS - 500) return;
      lastReportedRef.current = now;

      try {
        const result = await postProgress(lesson.id, {
          videoPositionSeconds: video.currentTime,
          videoDurationSeconds: video.duration,
        });
        setWatchedPercent(result.videoWatchedPercent ?? 0);
        if (result.status === "COMPLETED" && !completedNow) {
          setCompletedNow(true);
          toast.success("Lesson complete — you've watched enough to move on.");
          onComplete();
        } else {
          onProgress();
        }
      } catch {
        // Silent — periodic reporting shouldn't interrupt playback with errors.
      }
    },
    [lesson.id, completedNow, onComplete, onProgress],
  );

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onLoadedMetadata = () => {
      if (!resumedRef.current && progress?.videoPositionSeconds) {
        video.currentTime = Math.min(progress.videoPositionSeconds, Math.max(0, video.duration - 1));
      }
      resumedRef.current = true;
    };
    const onTimeUpdate = () => {
      void report(false);
    };
    const onPause = () => {
      void report(true);
    };
    const onEnded = () => {
      void report(true);
    };

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  if (!src) {
    return (
      <EmptyState
        icon={<Icon name="video" className="h-5 w-5" />}
        title="No video attached yet"
        description="This lesson doesn't have a video source configured. Check back later, or contact the course owner."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-black">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- track is added conditionally below */}
        <video ref={videoRef} controls className="aspect-video w-full" preload="metadata">
          <source src={src} />
          {captionsDataUrl && <track kind="captions" src={captionsDataUrl} default label="Captions" />}
          Your browser does not support embedded video.
        </video>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4">
        <div className="flex items-center justify-between text-[0.8125rem]">
          <span className="font-medium text-[var(--text-primary)]">
            Watch {course.requiredVideoPercent}% to complete
          </span>
          <span className="text-[var(--text-muted)]">{Math.round(watchedPercent)}% watched</span>
          {completedNow && <Badge tone="success">Completed</Badge>}
        </div>
        <ProgressBar
          value={watchedPercent}
          label={`${Math.round(watchedPercent)}% watched`}
          tone={completedNow ? "success" : "brand"}
        />
      </div>
    </div>
  );
}
