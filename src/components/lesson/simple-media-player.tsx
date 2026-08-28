"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Glyph, Icon } from "@/components/icons";
import { postProgress } from "@/components/lesson/progress-client";
import { MarkCompleteButton } from "@/components/lesson/mark-complete-button";
import type { LessonPlayerProps } from "@/components/lesson/types";

/**
 * Shared shell for the passive media lesson types: AUDIO, DOCUMENT,
 * PRESENTATION, IMAGE, EMBED, EXTERNAL_LINK, DOWNLOAD. Each has its own
 * viewer, but all share the same "required badge + mark complete" footer, so
 * one file keeps that consistent instead of drifting per type.
 */
export function SimpleMediaPlayer(props: LessonPlayerProps) {
  const { lesson, progress, onComplete } = props;
  const alreadyComplete = progress?.status === "COMPLETED";

  return (
    <div className="flex flex-col gap-5">
      <Viewer {...props} />
      <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4">
        {lesson.required ? <Badge tone="navy">Required</Badge> : <Badge tone="neutral">Optional</Badge>}
        <MarkCompleteButton lessonId={lesson.id} alreadyComplete={alreadyComplete} onComplete={onComplete} />
      </div>
    </div>
  );
}

function Viewer(props: LessonPlayerProps) {
  const { lesson } = props;
  switch (lesson.type) {
    case "AUDIO":
      return <AudioViewer {...props} />;
    case "DOCUMENT":
    case "PRESENTATION":
      return <DocumentViewer {...props} />;
    case "IMAGE":
      return <ImageViewer {...props} />;
    case "EMBED":
      return <EmbedViewer {...props} />;
    case "EXTERNAL_LINK":
      return <ExternalLinkViewer {...props} />;
    case "DOWNLOAD":
      return <DownloadViewer {...props} />;
    default:
      return null;
  }
}

function mediaUrl(mediaId: string | null | undefined): string | null {
  return mediaId ? `/api/media/${mediaId}` : null;
}

function AudioViewer({ lesson, onComplete, onProgress }: LessonPlayerProps) {
  const content = lesson.content as { mediaId?: string | null; externalUrl?: string | null };
  const src = content.externalUrl ?? mediaUrl(content.mediaId);
  if (!src) {
    return (
      <EmptyState
        icon={<Icon name="media" className="h-5 w-5" />}
        title="No audio attached yet"
        description="This lesson doesn't have an audio source configured yet."
      />
    );
  }
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-6">
      <audio
        controls
        src={src}
        className="w-full"
        onEnded={() => {
          void postProgress(lesson.id, { markComplete: true })
            .then(() => onComplete())
            .catch(() => onProgress());
        }}
      >
        Your browser does not support embedded audio.
      </audio>
    </div>
  );
}

function DocumentViewer({ lesson }: LessonPlayerProps) {
  const content = lesson.content as { mediaId?: string | null; externalUrl?: string | null };
  const src = content.externalUrl ?? mediaUrl(content.mediaId);
  if (!src) {
    return (
      <EmptyState
        icon={<Icon name="content" className="h-5 w-5" />}
        title="No document attached yet"
        description="This lesson doesn't have a file configured yet."
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)]">
      <iframe src={src} title={lesson.title} className="h-[70vh] w-full border-0" />
    </div>
  );
}

function ImageViewer({ lesson }: LessonPlayerProps) {
  const content = lesson.content as { mediaId?: string | null; externalUrl?: string | null };
  const src = content.externalUrl ?? mediaUrl(content.mediaId);
  if (!src) {
    return (
      <EmptyState
        icon={<Icon name="media" className="h-5 w-5" />}
        title="No image attached yet"
        description="This lesson doesn't have an image configured yet."
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- private media served from an authenticated route, not eligible for next/image optimization.
  return (
    <div className="flex justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-4">
      <img src={src} alt={lesson.title} className="max-h-[70vh] w-auto rounded-md" />
    </div>
  );
}

function EmbedViewer({ lesson }: LessonPlayerProps) {
  const content = lesson.content as { url?: string; height?: number };
  if (!content.url) {
    return (
      <EmptyState
        icon={<Icon name="content" className="h-5 w-5" />}
        title="Nothing embedded yet"
        description="This lesson doesn't have an embed URL configured yet."
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
      <iframe
        src={content.url}
        title={lesson.title}
        style={{ height: content.height ?? 420 }}
        className="w-full border-0"
        allow="fullscreen"
      />
    </div>
  );
}

function ExternalLinkViewer({ lesson, progress }: LessonPlayerProps) {
  const content = lesson.content as { url?: string; label?: string };
  const [opened, setOpened] = React.useState(false);

  if (!content.url) {
    return (
      <EmptyState
        icon={<Icon name="content" className="h-5 w-5" />}
        title="No link configured yet"
        description="This lesson doesn't have an external link configured yet."
      />
    );
  }

  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-6">
      <p className="text-[0.875rem] text-[var(--text-secondary)]">
        This lesson points to an external resource. Open it, then come back and mark it complete.
      </p>
      <a
        href={content.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-[0.875rem] font-medium text-[var(--brand-secondary)] hover:underline"
        onClick={() => setOpened(true)}
      >
        {content.label ?? content.url}
        <Glyph name="external" className="h-3.5 w-3.5" />
      </a>
      {opened && progress?.status !== "COMPLETED" && (
        <p className="text-[0.75rem] text-[var(--text-muted)]">
          Opened. When you're done reviewing it, mark this lesson complete below.
        </p>
      )}
    </div>
  );
}

function DownloadViewer({ lesson }: LessonPlayerProps) {
  const content = lesson.content as { mediaId?: string | null; label?: string };
  const src = mediaUrl(content.mediaId);
  if (!src) {
    return (
      <EmptyState
        icon={<Icon name="content" className="h-5 w-5" />}
        title="No file attached yet"
        description="This lesson doesn't have a downloadable file configured yet."
      />
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-sunken)] text-[var(--text-muted)]">
          <Icon name="content" className="h-5 w-5" />
        </span>
        <div>
          <p className="text-[0.875rem] font-medium text-[var(--text-primary)]">{content.label ?? lesson.title}</p>
          <p className="text-[0.75rem] text-[var(--text-muted)]">Download and review this file.</p>
        </div>
      </div>
      <a href={src} target="_blank" rel="noopener noreferrer">
        <Button variant="outline" size="sm">
          <Glyph name="download" className="h-4 w-4" />
          Download
        </Button>
      </a>
    </div>
  );
}
