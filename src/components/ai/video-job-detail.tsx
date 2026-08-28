"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  getVideoJobAction,
  updateVideoPlanAction,
  queueRenderAction,
  regenerateVideoPlanAction,
  retryVideoJobAction,
  publishVideoIntoSopAction,
  publishVideoIntoCourseAction,
  listCourseSectionsAction,
  searchSopsForVideoAction,
  searchCoursesForVideoAction,
  type ContentOption,
  type CourseSectionOption,
} from "@/app/(app)/admin/video-studio/actions";
import type { VideoOutdatedInfo } from "@/lib/video/render";
import type { VideoPlan, VideoScene, VideoKnowledgeCheck } from "@/lib/video/types";
import { VIDEO_MODE_LABELS, type VideoMode } from "@/lib/video/types";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress";
import { Glyph } from "@/components/icons";
import { formatBytes, formatDuration } from "@/lib/utils";

const STAGES = [
  "QUEUED", "GENERATING_SCRIPT", "AWAITING_REVIEW", "GENERATING_AUDIO", "CREATING_SCENES", "RENDERING", "UPLOADING", "COMPLETE",
];
const STAGE_LABELS: Record<string, string> = {
  QUEUED: "Queued",
  GENERATING_SCRIPT: "Writing script",
  AWAITING_REVIEW: "Your review",
  GENERATING_AUDIO: "Narration",
  CREATING_SCENES: "Scenes",
  RENDERING: "Rendering",
  UPLOADING: "Uploading",
  COMPLETE: "Complete",
};
const ACTIVE_STATUSES = new Set(["QUEUED", "GENERATING_SCRIPT", "GENERATING_AUDIO", "CREATING_SCENES", "RENDERING", "UPLOADING"]);

interface JobState {
  id: string;
  title: string;
  mode: string;
  status: string;
  progress: number;
  error: string | null;
  plan: VideoPlan | null;
  outputMediaId: string | null;
  sourceSopId: string | null;
  sourceCourseId: string | null;
}

interface MediaState {
  id: string;
  durationSeconds: number | null;
  captionsVtt: string | null;
  chapters: { title: string; startSeconds: number }[];
  sizeBytes: number;
}

function StatusTimeline({ status }: { status: string }) {
  if (status === "FAILED" || status === "CANCELED") {
    return <Badge tone={status === "FAILED" ? "danger" : "neutral"}>{status === "FAILED" ? "Failed" : "Canceled"}</Badge>;
  }
  const currentIndex = STAGES.indexOf(status);
  return (
    <ol className="flex flex-wrap items-center gap-1.5">
      {STAGES.map((stage, i) => {
        const done = currentIndex > i;
        const current = currentIndex === i;
        return (
          <li key={stage} className="flex items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.6875rem] font-medium ${
                current
                  ? "bg-[var(--brand-primary)] text-white"
                  : done
                    ? "bg-success-50 text-success-700"
                    : "bg-[var(--surface-sunken)] text-[var(--text-muted)]"
              }`}
            >
              {done && <Glyph name="check" className="h-3 w-3" />}
              {STAGE_LABELS[stage]}
            </span>
            {i < STAGES.length - 1 && <Glyph name="chevron-right" className="h-3 w-3 text-[var(--text-muted)]" />}
          </li>
        );
      })}
    </ol>
  );
}

function updateScene(plan: VideoPlan, index: number, next: Partial<VideoScene>): VideoPlan {
  const scenes = plan.scenes.map((s, i) => (i === index ? { ...s, ...next } : s));
  return { ...plan, scenes };
}

export function VideoJobDetail({
  job: initialJob,
  media: initialMedia,
  outdated,
  aiTextAvailable,
  videoRenderAvailable,
}: {
  job: JobState;
  media: MediaState | null;
  outdated: VideoOutdatedInfo | null;
  aiTextAvailable: boolean;
  videoRenderAvailable: boolean;
}) {
  const router = useRouter();
  const [job, setJob] = React.useState(initialJob);
  const [plan, setPlan] = React.useState<VideoPlan | null>(initialJob.plan);
  const [savingPlan, setSavingPlan] = React.useState(false);
  const [queuing, setQueuing] = React.useState(false);
  const [regenerating, setRegenerating] = React.useState(false);
  const [retrying, setRetrying] = React.useState(false);

  const planLoadedRef = React.useRef(Boolean(initialJob.plan));

  React.useEffect(() => {
    if (!ACTIVE_STATUSES.has(job.status)) return;
    const interval = setInterval(async () => {
      const result = await getVideoJobAction(job.id);
      if (!result.ok) return;
      setJob(result.data);
      if (!planLoadedRef.current && result.data.plan) {
        setPlan(result.data.plan);
        planLoadedRef.current = true;
      }
      if (result.data.status === "COMPLETE" || result.data.status === "FAILED") {
        router.refresh();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [job.status, job.id, router]);

  async function handleSavePlan() {
    if (!plan) return;
    setSavingPlan(true);
    try {
      const result = await updateVideoPlanAction(job.id, plan);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Plan saved.");
    } finally {
      setSavingPlan(false);
    }
  }

  async function handleQueueRender() {
    if (plan) {
      const saveResult = await updateVideoPlanAction(job.id, plan);
      if (!saveResult.ok) {
        toast.error(saveResult.error);
        return;
      }
    }
    setQueuing(true);
    try {
      const result = await queueRenderAction(job.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Render queued.");
      setJob({ ...job, status: "GENERATING_AUDIO", progress: 5 });
    } finally {
      setQueuing(false);
    }
  }

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const result = await regenerateVideoPlanAction(job.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      planLoadedRef.current = false;
      setPlan(null);
      setJob({ ...job, status: "QUEUED", progress: 0, error: null });
      toast.success("Regenerating the plan.");
    } finally {
      setRegenerating(false);
    }
  }

  async function handleRetry() {
    setRetrying(true);
    try {
      const result = await retryVideoJobAction(job.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Retrying.");
      const refreshed = await getVideoJobAction(job.id);
      if (refreshed.ok) setJob(refreshed.data);
    } finally {
      setRetrying(false);
    }
  }

  const captionsDataUrl = initialMedia?.captionsVtt
    ? `data:text/vtt;charset=utf-8,${encodeURIComponent(initialMedia.captionsVtt)}`
    : null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusTimeline status={job.status} />
            <Badge tone="neutral">{VIDEO_MODE_LABELS[job.mode as VideoMode] ?? job.mode}</Badge>
          </div>
          {ACTIVE_STATUSES.has(job.status) && (
            <ProgressBar value={job.progress} label={`${STAGE_LABELS[job.status] ?? job.status} progress`} />
          )}
          {job.status === "FAILED" && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-danger-200 bg-danger-50 px-3 py-2.5">
              <p className="text-[0.8125rem] text-danger-800">{job.error ?? "The render failed."}</p>
              <Button size="sm" variant="outline" loading={retrying} onClick={handleRetry}>
                Retry
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {(job.status === "AWAITING_REVIEW" || (job.status === "FAILED" && plan)) && plan && (
        <PlanEditor
          plan={plan}
          onChange={setPlan}
          onSave={handleSavePlan}
          onQueueRender={handleQueueRender}
          savingPlan={savingPlan}
          queuing={queuing}
          aiTextAvailable={aiTextAvailable}
          videoRenderAvailable={videoRenderAvailable}
        />
      )}

      {job.status === "COMPLETE" && initialMedia && (
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {outdated?.outdated && (
              <p className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-[0.8125rem] text-warning-800">
                Generated from {outdated.sourceSopTitle ?? "its source SOP"} version {outdated.recordedVersion} — the
                current published version is {outdated.currentVersion}. This video may be outdated.
              </p>
            )}
            <video controls className="w-full max-w-xl rounded-md bg-black" src={`/api/media/${initialMedia.id}`}>
              {captionsDataUrl && <track kind="captions" srcLang="en" label="Captions" src={captionsDataUrl} default />}
            </video>
            <p className="text-[0.75rem] text-[var(--text-muted)]">
              {formatDuration(initialMedia.durationSeconds)} · {formatBytes(initialMedia.sizeBytes)}
            </p>
            {initialMedia.chapters.length > 0 && (
              <div>
                <p className="mb-1 text-[0.75rem] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Chapters</p>
                <ul className="flex flex-col gap-0.5">
                  {initialMedia.chapters.map((c, i) => (
                    <li key={i} className="text-[0.8125rem] text-[var(--text-secondary)]">
                      {formatDuration(c.startSeconds)} — {c.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {job.status === "COMPLETE" && job.outputMediaId && <PublishActions videoJobId={job.id} />}

      <Card className="border-[var(--border-subtle)] bg-[var(--surface-sunken)]">
        <CardContent className="flex items-center justify-between gap-3 py-3">
          <p className="text-[0.8125rem] text-[var(--text-secondary)]">
            Not happy with the plan or the result? Regenerate it from the same source.
          </p>
          <Button
            variant="outline"
            size="sm"
            loading={regenerating}
            disabled={job.status === "RENDERING" || job.status === "UPLOADING"}
            onClick={handleRegenerate}
          >
            Regenerate
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function PlanEditor({
  plan,
  onChange,
  onSave,
  onQueueRender,
  savingPlan,
  queuing,
  aiTextAvailable,
  videoRenderAvailable,
}: {
  plan: VideoPlan;
  onChange: (plan: VideoPlan) => void;
  onSave: () => void;
  onQueueRender: () => void;
  savingPlan: boolean;
  queuing: boolean;
  aiTextAvailable: boolean;
  videoRenderAvailable: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Plan</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!videoRenderAvailable && (
            <p className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-[0.8125rem] text-warning-800">
              The local renderer isn&apos;t available on this host — you can edit the plan, but queuing the render will
              fail until ffmpeg is configured.
            </p>
          )}
          <Field label="Description" htmlFor="plan-description">
            <Textarea
              id="plan-description"
              value={plan.description}
              onChange={(e) => onChange({ ...plan, description: e.target.value })}
              rows={2}
            />
          </Field>
          <Field label="Learning objectives" htmlFor="plan-objectives" hint="One per line">
            <Textarea
              id="plan-objectives"
              value={plan.objectives.join("\n")}
              onChange={(e) => onChange({ ...plan, objectives: e.target.value.split("\n").filter(Boolean) })}
              rows={3}
            />
          </Field>
          <Field label="Full script" htmlFor="plan-script" hint="For reference — editing scene narration below is what actually drives the video.">
            <Textarea id="plan-script" value={plan.script} onChange={(e) => onChange({ ...plan, script: e.target.value })} rows={4} />
          </Field>
        </CardContent>
      </Card>

      {plan.scenes.map((scene, i) => (
        <Card key={i}>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Scene {i + 1}</CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove scene"
                onClick={() => onChange({ ...plan, scenes: plan.scenes.filter((_, si) => si !== i).map((s, si) => ({ ...s, index: si })) })}
              >
                <Glyph name="trash" className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Field label="Title" htmlFor={`scene-title-${i}`}>
              <Input id={`scene-title-${i}`} value={scene.title} onChange={(e) => onChange(updateScene(plan, i, { title: e.target.value }))} />
            </Field>
            <Field label="Narration" htmlFor={`scene-narration-${i}`}>
              <Textarea
                id={`scene-narration-${i}`}
                value={scene.narration}
                onChange={(e) => onChange(updateScene(plan, i, { narration: e.target.value }))}
                rows={3}
              />
            </Field>
            <Field label="On-screen text" htmlFor={`scene-text-${i}`} hint="One line per bullet">
              <Textarea
                id={`scene-text-${i}`}
                value={scene.onScreenText.join("\n")}
                onChange={(e) => onChange(updateScene(plan, i, { onScreenText: e.target.value.split("\n").filter(Boolean) }))}
                rows={3}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Visual style" htmlFor={`scene-style-${i}`}>
                <Input
                  id={`scene-style-${i}`}
                  value={scene.visualStyle ?? ""}
                  onChange={(e) => onChange(updateScene(plan, i, { visualStyle: e.target.value }))}
                />
              </Field>
              <Field label="Estimated seconds" htmlFor={`scene-seconds-${i}`}>
                <Input
                  id={`scene-seconds-${i}`}
                  type="number"
                  value={scene.estimatedSeconds}
                  onChange={(e) => onChange(updateScene(plan, i, { estimatedSeconds: Number(e.target.value) || 1 }))}
                />
              </Field>
            </div>
          </CardContent>
        </Card>
      ))}

      <Button
        type="button"
        variant="outline"
        onClick={() =>
          onChange({
            ...plan,
            scenes: [
              ...plan.scenes,
              { index: plan.scenes.length, title: "New scene", narration: "", onScreenText: [], estimatedSeconds: 5 },
            ],
          })
        }
      >
        <Glyph name="plus" className="h-3.5 w-3.5" />
        Add scene
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Knowledge checks</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {plan.knowledgeChecks.map((kc, i) => (
            <KnowledgeCheckEditor
              key={i}
              check={kc}
              onChange={(next) =>
                onChange({ ...plan, knowledgeChecks: plan.knowledgeChecks.map((k, ki) => (ki === i ? next : k)) })
              }
              onRemove={() => onChange({ ...plan, knowledgeChecks: plan.knowledgeChecks.filter((_, ki) => ki !== i) })}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange({
                ...plan,
                knowledgeChecks: [...plan.knowledgeChecks, { question: "", options: ["", ""], correctIndex: 0 }],
              })
            }
          >
            <Glyph name="plus" className="h-3.5 w-3.5" />
            Add knowledge check
          </Button>
        </CardContent>
      </Card>

      <CardFooter className="justify-end gap-2 px-0">
        <Button variant="outline" loading={savingPlan} onClick={onSave}>
          Save changes
        </Button>
        <Button onClick={onQueueRender} loading={queuing} disabled={!aiTextAvailable && false}>
          Queue render
        </Button>
      </CardFooter>
    </div>
  );
}

function KnowledgeCheckEditor({
  check,
  onChange,
  onRemove,
}: {
  check: VideoKnowledgeCheck;
  onChange: (check: VideoKnowledgeCheck) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-md border border-[var(--border-subtle)] p-3">
      <div className="mb-2 flex items-center justify-end">
        <Button type="button" variant="ghost" size="icon" aria-label="Remove knowledge check" onClick={onRemove}>
          <Glyph name="trash" className="h-4 w-4" />
        </Button>
      </div>
      <Textarea
        aria-label="Question"
        value={check.question}
        onChange={(e) => onChange({ ...check, question: e.target.value })}
        rows={2}
        className="mb-2"
      />
      <Textarea
        aria-label="Options, one per line"
        value={check.options.join("\n")}
        onChange={(e) => onChange({ ...check, options: e.target.value.split("\n") })}
        rows={Math.max(2, check.options.length)}
        className="mb-2"
      />
      <Field label="Correct option index (0-based)" htmlFor="kc-correct">
        <Input
          id="kc-correct"
          type="number"
          min={0}
          value={check.correctIndex}
          onChange={(e) => onChange({ ...check, correctIndex: Number(e.target.value) || 0 })}
        />
      </Field>
    </div>
  );
}

function PublishActions({ videoJobId }: { videoJobId: string }) {
  const [target, setTarget] = React.useState<"sop" | "course" | null>(null);
  const [query, setQuery] = React.useState("");
  const [sopOptions, setSopOptions] = React.useState<ContentOption[]>([]);
  const [courseOptions, setCourseOptions] = React.useState<ContentOption[]>([]);
  const [selectedCourseId, setSelectedCourseId] = React.useState<string | null>(null);
  const [sections, setSections] = React.useState<CourseSectionOption[]>([]);
  const [publishing, setPublishing] = React.useState(false);
  const [publishedTo, setPublishedTo] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (target !== "sop") return;
    const handle = setTimeout(async () => {
      const result = await searchSopsForVideoAction(query);
      if (result.ok) setSopOptions(result.data);
    }, 250);
    return () => clearTimeout(handle);
  }, [query, target]);

  React.useEffect(() => {
    if (target !== "course") return;
    const handle = setTimeout(async () => {
      const result = await searchCoursesForVideoAction(query);
      if (result.ok) setCourseOptions(result.data);
    }, 250);
    return () => clearTimeout(handle);
  }, [query, target]);

  async function pickCourse(course: ContentOption) {
    setSelectedCourseId(course.id);
    setQuery(course.title);
    setCourseOptions([]);
    const result = await listCourseSectionsAction(course.id);
    if (result.ok) setSections(result.data);
  }

  async function publishSop(sopId: string, title: string) {
    setPublishing(true);
    try {
      const result = await publishVideoIntoSopAction(videoJobId, sopId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPublishedTo(`SOP: ${title}`);
      toast.success("Video attached to the SOP draft content.");
    } finally {
      setPublishing(false);
    }
  }

  async function publishCourse(sectionId: string, sectionTitle: string) {
    setPublishing(true);
    try {
      const result = await publishVideoIntoCourseAction(videoJobId, sectionId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPublishedTo(`Course section: ${sectionTitle}`);
      toast.success("Video added as a new lesson.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Publish into SOP or course</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {publishedTo && (
          <p className="rounded-md border border-success-100 bg-success-50 px-3 py-2 text-[0.8125rem] text-success-700">
            Added to {publishedTo}.
          </p>
        )}
        <div className="flex gap-2">
          <Button variant={target === "sop" ? "primary" : "outline"} size="sm" onClick={() => { setTarget("sop"); setQuery(""); }}>
            Into an SOP
          </Button>
          <Button variant={target === "course" ? "primary" : "outline"} size="sm" onClick={() => { setTarget("course"); setQuery(""); setSelectedCourseId(null); setSections([]); }}>
            Into a course
          </Button>
        </div>

        {target === "sop" && (
          <Field label="Search SOPs" htmlFor="publish-sop-search">
            <Input id="publish-sop-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Start typing a title…" />
            {sopOptions.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 rounded-md border border-[var(--border-subtle)] p-1">
                {sopOptions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      disabled={publishing}
                      onClick={() => publishSop(s.id, s.title)}
                      className="w-full rounded px-2 py-1.5 text-left text-[0.8125rem] hover:bg-[var(--surface-sunken)]"
                    >
                      {s.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Field>
        )}

        {target === "course" && (
          <>
            <Field label="Search courses" htmlFor="publish-course-search">
              <Input id="publish-course-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Start typing a title…" />
              {courseOptions.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 rounded-md border border-[var(--border-subtle)] p-1">
                  {courseOptions.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => pickCourse(c)}
                        className="w-full rounded px-2 py-1.5 text-left text-[0.8125rem] hover:bg-[var(--surface-sunken)]"
                      >
                        {c.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Field>
            {selectedCourseId && sections.length > 0 && (
              <Field label="Add as a new lesson at the end of" htmlFor="publish-section">
                <ul className="flex flex-col gap-1 rounded-md border border-[var(--border-subtle)] p-1">
                  {sections.map((s) => (
                    <li key={s.sectionId}>
                      <button
                        type="button"
                        disabled={publishing}
                        onClick={() => publishCourse(s.sectionId, s.sectionTitle)}
                        className="w-full rounded px-2 py-1.5 text-left text-[0.8125rem] hover:bg-[var(--surface-sunken)]"
                      >
                        {s.sectionTitle}
                      </button>
                    </li>
                  ))}
                </ul>
              </Field>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
