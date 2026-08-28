"use client";

import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Glyph, Icon } from "@/components/icons";
import type { LessonPlayerProps } from "@/components/lesson/types";

const STATUS_LABEL: Record<string, string> = {
  REGISTERED: "You're registered",
  ATTENDED: "You attended",
  NO_SHOW: "Marked as no-show",
};

export function LiveSessionPlayer({ lesson, extra, registerForSession, onProgress }: LessonPlayerProps) {
  const session = extra?.liveSession;
  const [submitting, setSubmitting] = React.useState(false);

  if (!session) {
    return (
      <EmptyState
        icon={<Icon name="calendar" className="h-5 w-5" />}
        title="No session scheduled yet"
        description="This lesson doesn't have a live session scheduled yet. Check back later."
      />
    );
  }

  const start = new Date(session.startsAt);
  const end = new Date(session.endsAt);
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: session.timezone,
  }).format(start);
  const timeLabel = `${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: session.timezone }).format(start)} – ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: session.timezone }).format(end)}`;
  const full = session.capacity !== null && session.registeredCount >= session.capacity;

  async function register() {
    if (!registerForSession) return;
    setSubmitting(true);
    try {
      const result = await registerForSession(lesson.id);
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't register for this session.");
        return;
      }
      toast.success("You're registered.");
      onProgress();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-6">
        <h3 className="text-[1rem] font-semibold text-[var(--text-primary)]">{session.title}</h3>
        <div className="flex flex-col gap-1.5 text-[0.875rem] text-[var(--text-secondary)]">
          <span className="flex items-center gap-2">
            <Icon name="calendar" className="h-4 w-4 text-[var(--text-muted)]" />
            {dateLabel}
          </span>
          <span className="flex items-center gap-2">
            <Glyph name="clock" className="h-4 w-4 text-[var(--text-muted)]" />
            {timeLabel}
          </span>
          {session.locationText && (
            <span className="flex items-center gap-2">
              <Icon name="org" className="h-4 w-4 text-[var(--text-muted)]" />
              {session.locationText}
            </span>
          )}
          {session.capacity !== null && (
            <span className="text-[0.8125rem] text-[var(--text-muted)]">
              {session.registeredCount} of {session.capacity} seats filled
            </span>
          )}
        </div>
      </div>

      {session.myStatus ? (
        <Badge tone={session.myStatus === "NO_SHOW" ? "danger" : "success"}>
          {STATUS_LABEL[session.myStatus] ?? session.myStatus}
        </Badge>
      ) : full ? (
        <p className="text-[0.875rem] text-[var(--text-muted)]">This session is full.</p>
      ) : (
        <div>
          <Button onClick={register} loading={submitting}>
            Register
          </Button>
        </div>
      )}
    </div>
  );
}
