"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress";
import { Glyph, Icon } from "@/components/icons";
import { LessonPlayer } from "@/components/lesson/lesson-player";
import type { LessonPlayerProps, PlayerCourse, PlayerLesson, PlayerProgress, PlayerViewer } from "@/components/lesson/types";
import { LESSON_TYPE_LABEL } from "@/components/lesson/lesson-type-label";

export interface ShellSectionLesson {
  id: string;
  title: string;
  type: string;
  required: boolean;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
}
export interface ShellSection {
  id: string;
  title: string;
  lessons: ShellSectionLesson[];
}

type LessonActions = Pick<
  LessonPlayerProps,
  | "acknowledge"
  | "assessPractical"
  | "submitProject"
  | "registerForSession"
  | "postComment"
  | "startQuizAttempt"
  | "submitQuizAttempt"
  | "getQuizReview"
>;

export function LessonPageShell({
  courseId,
  courseTitle,
  overallPercent,
  sections,
  currentLessonId,
  prevHref,
  nextHref,
  lesson,
  course,
  progress,
  viewer,
  extra,
  actions,
}: {
  courseId: string;
  courseTitle: string;
  overallPercent: number;
  sections: ShellSection[];
  currentLessonId: string;
  prevHref: string | null;
  nextHref: string | null;
  lesson: PlayerLesson;
  course: PlayerCourse;
  progress: PlayerProgress | null;
  viewer: PlayerViewer;
  extra?: LessonPlayerProps["extra"];
  actions: LessonActions;
}) {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [advancing, setAdvancing] = React.useState(false);

  const handleProgress = React.useCallback(() => {
    router.refresh();
  }, [router]);

  const handleComplete = React.useCallback(() => {
    setAdvancing(true);
    router.refresh();
    const target = nextHref ?? `/courses/${courseId}`;
    window.setTimeout(() => {
      if (!nextHref) toast.success("Course complete. Nice work.");
      router.push(target);
    }, 900);
  }, [router, nextHref, courseId]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <ProgressBar value={overallPercent} label={`${overallPercent}% of ${courseTitle} complete`} className="flex-1" />
        <span className="shrink-0 text-[0.8125rem] font-medium text-[var(--text-muted)]">{overallPercent}%</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setDrawerOpen((o) => !o)} aria-expanded={drawerOpen} aria-controls="lesson-drawer">
            <Glyph name="menu" className="h-4 w-4" />
            Lessons
          </Button>
          {prevHref ? (
            <Link href={prevHref}>
              <Button variant="ghost" size="sm">
                <Glyph name="chevron-left" className="h-4 w-4" />
                Previous
              </Button>
            </Link>
          ) : (
            <Button variant="ghost" size="sm" disabled>
              <Glyph name="chevron-left" className="h-4 w-4" />
              Previous
            </Button>
          )}
          {nextHref ? (
            <Link href={nextHref}>
              <Button variant="ghost" size="sm">
                Next
                <Glyph name="chevron-right" className="h-4 w-4" />
              </Button>
            </Link>
          ) : (
            <Button variant="ghost" size="sm" disabled>
              Next
              <Glyph name="chevron-right" className="h-4 w-4" />
            </Button>
          )}
        </div>
        <Link href={`/ask?courseId=${courseId}`}>
          <Button variant="secondary" size="sm">
            <Icon name="ai" className="h-4 w-4" />
            Ask the Training Coach
          </Button>
        </Link>
      </div>

      {drawerOpen && (
        <nav id="lesson-drawer" aria-label="Course lessons" className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-2">
          {sections.map((section) => (
            <div key={section.id} className="mb-1 last:mb-0">
              <p className="px-2 py-1.5 text-[0.75rem] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                {section.title}
              </p>
              <ul className="flex flex-col">
                {section.lessons.map((l) => {
                  const active = l.id === currentLessonId;
                  return (
                    <li key={l.id}>
                      <Link
                        href={`/courses/${courseId}/lessons/${l.id}`}
                        className={`flex items-center justify-between gap-2 rounded-md px-2 py-2 text-[0.8125rem] transition-colors ${
                          active ? "bg-[var(--surface-sunken)] font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {l.status === "COMPLETED" ? (
                            <Glyph name="check" className="h-3.5 w-3.5 shrink-0 text-success-600" />
                          ) : (
                            <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-[var(--border-default)]" aria-hidden="true" />
                          )}
                          <span className="truncate">{l.title}</span>
                        </span>
                        <span className="shrink-0 text-[0.6875rem] text-[var(--text-muted)]">
                          {LESSON_TYPE_LABEL[l.type] ?? l.type}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[1.25rem] font-semibold text-[var(--text-primary)]">{lesson.title}</h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge tone="neutral">{LESSON_TYPE_LABEL[lesson.type] ?? lesson.type}</Badge>
            {lesson.estimatedMinutes && (
              <span className="text-[0.75rem] text-[var(--text-muted)]">{lesson.estimatedMinutes} min</span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-page)] p-1">
        <div className="rounded-md bg-[var(--surface-page)] p-4 sm:p-6" aria-live="polite" aria-busy={advancing}>
          <LessonPlayer
            lesson={lesson}
            course={course}
            progress={progress}
            viewer={viewer}
            extra={extra}
            onComplete={handleComplete}
            onProgress={handleProgress}
            {...actions}
          />
        </div>
      </div>
    </div>
  );
}
