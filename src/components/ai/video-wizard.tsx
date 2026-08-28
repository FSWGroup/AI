"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createVideoJobAction,
  searchSopsForVideoAction,
  searchCoursesForVideoAction,
  type ContentOption,
} from "@/app/(app)/admin/video-studio/actions";
import { VIDEO_MODES, VIDEO_MODE_LABELS, VIDEO_MODE_DESCRIPTIONS, ASPECT_RATIOS, type VideoMode, type VideoSourceType } from "@/lib/video/types";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Glyph } from "@/components/icons";

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English", es: "Spanish", fil: "Filipino (Tagalog)", tl: "Filipino (Tagalog)",
  vi: "Vietnamese", zh: "Mandarin Chinese", fr: "French", pt: "Portuguese",
};

export function VideoWizard({
  available,
  videoRenderAvailable,
  avatarAvailable,
  ttsVoices,
  languages,
  initialSopId,
  initialCourseId,
}: {
  available: boolean;
  videoRenderAvailable: boolean;
  avatarAvailable: boolean;
  ttsVoices: { id: string; label: string; language: string }[];
  languages: string[];
  initialSopId: string | null;
  initialCourseId: string | null;
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [mode, setMode] = React.useState<VideoMode>("EXPLAINER");
  const [sourceType, setSourceType] = React.useState<VideoSourceType>(
    initialSopId ? "SOP" : initialCourseId ? "COURSE" : "PROMPT",
  );
  const [prompt, setPrompt] = React.useState("");
  const [sourceText, setSourceText] = React.useState("");
  const [sopQuery, setSopQuery] = React.useState("");
  const [sopOptions, setSopOptions] = React.useState<ContentOption[]>([]);
  const [sopId, setSopId] = React.useState<string | null>(initialSopId);
  const [courseQuery, setCourseQuery] = React.useState("");
  const [courseOptions, setCourseOptions] = React.useState<ContentOption[]>([]);
  const [courseId, setCourseId] = React.useState<string | null>(initialCourseId);
  const [voice, setVoice] = React.useState(ttsVoices[0]?.id ?? "");
  const [language, setLanguage] = React.useState(languages[0] ?? "en");
  const [aspectRatio, setAspectRatio] = React.useState<(typeof ASPECT_RATIOS)[number]>("16:9");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (sourceType !== "SOP") return;
    const handle = setTimeout(async () => {
      const result = await searchSopsForVideoAction(sopQuery);
      if (result.ok) setSopOptions(result.data);
    }, 250);
    return () => clearTimeout(handle);
  }, [sopQuery, sourceType]);

  React.useEffect(() => {
    if (sourceType !== "COURSE") return;
    const handle = setTimeout(async () => {
      const result = await searchCoursesForVideoAction(courseQuery);
      if (result.ok) setCourseOptions(result.data);
    }, 250);
    return () => clearTimeout(handle);
  }, [courseQuery, sourceType]);

  async function handleSubmit() {
    if (!title.trim()) {
      toast.error("Give this video a title.");
      return;
    }
    if (sourceType === "PROMPT" && prompt.trim().length < 10) {
      toast.error("Describe what the video should cover.");
      return;
    }
    if (sourceType === "SOP" && !sopId) {
      toast.error("Pick an SOP.");
      return;
    }
    if (sourceType === "COURSE" && !courseId) {
      toast.error("Pick a course.");
      return;
    }
    if ((sourceType === "DOCUMENT" || sourceType === "TRANSCRIPT") && sourceText.trim().length < 20) {
      toast.error("Paste some source text first.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await createVideoJobAction({
        title,
        mode,
        sourceType,
        prompt: sourceType === "PROMPT" ? prompt : undefined,
        sourceText: sourceType === "DOCUMENT" || sourceType === "TRANSCRIPT" ? sourceText : undefined,
        sourceSopId: sourceType === "SOP" ? (sopId ?? undefined) : undefined,
        sourceCourseId: sourceType === "COURSE" ? (courseId ?? undefined) : undefined,
        voice: voice || undefined,
        language,
        aspectRatio,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Generating the plan — you'll review it next.");
      router.push(`/admin/video-studio/${result.data.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create a video</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!available && (
          <p className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-[0.8125rem] text-warning-800">
            AI text generation isn&apos;t configured — the plan can&apos;t be generated until an administrator sets an
            API key.
          </p>
        )}
        {!videoRenderAvailable && (
          <p className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-[0.8125rem] text-warning-800">
            The local renderer isn&apos;t available on this host — you can still plan a video, but rendering will fail
            until ffmpeg is configured.
          </p>
        )}

        <Field label="Title" htmlFor="video-title" required>
          <Input id="video-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lockout/Tagout Basics" />
        </Field>

        <Field label="Mode" htmlFor="video-mode">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {VIDEO_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-md border p-3 text-left transition-colors ${
                  mode === m
                    ? "border-[var(--brand-primary)] bg-[var(--surface-sunken)]"
                    : "border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-sunken)]"
                }`}
              >
                <p className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">
                  {VIDEO_MODE_LABELS[m]}
                  {m === "AVATAR" && !avatarAvailable && (
                    <span className="ml-1.5 font-normal text-[var(--text-muted)]">(renders locally — no avatar API configured)</span>
                  )}
                </p>
                <p className="mt-0.5 text-[0.75rem] text-[var(--text-muted)]">{VIDEO_MODE_DESCRIPTIONS[m]}</p>
              </button>
            ))}
          </div>
        </Field>

        <Field label="Source" htmlFor="video-source-type">
          <Select id="video-source-type" value={sourceType} onChange={(e) => setSourceType(e.target.value as VideoSourceType)}>
            <option value="PROMPT">A prompt</option>
            <option value="SOP">An existing SOP</option>
            <option value="COURSE">An existing course</option>
            <option value="DOCUMENT">Pasted document text</option>
            <option value="TRANSCRIPT">A transcript</option>
          </Select>
        </Field>

        {sourceType === "PROMPT" && (
          <Field label="What should this video cover?" htmlFor="video-prompt">
            <Textarea id="video-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} />
          </Field>
        )}

        {sourceType === "SOP" && (
          <Field label="Search for an SOP" htmlFor="video-sop-search">
            <Input id="video-sop-search" value={sopQuery} onChange={(e) => setSopQuery(e.target.value)} placeholder="Start typing a title…" />
            {sopOptions.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 rounded-md border border-[var(--border-subtle)] p-1">
                {sopOptions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => { setSopId(s.id); setSopQuery(s.title); setSopOptions([]); }}
                      className="w-full rounded px-2 py-1.5 text-left text-[0.8125rem] hover:bg-[var(--surface-sunken)]"
                    >
                      {s.title} {s.subtitle && <span className="text-[var(--text-muted)]">· {s.subtitle}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {sopId && <p className="mt-1 text-[0.75rem] text-success-700">Selected.</p>}
          </Field>
        )}

        {sourceType === "COURSE" && (
          <Field label="Search for a course" htmlFor="video-course-search">
            <Input id="video-course-search" value={courseQuery} onChange={(e) => setCourseQuery(e.target.value)} placeholder="Start typing a title…" />
            {courseOptions.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 rounded-md border border-[var(--border-subtle)] p-1">
                {courseOptions.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => { setCourseId(c.id); setCourseQuery(c.title); setCourseOptions([]); }}
                      className="w-full rounded px-2 py-1.5 text-left text-[0.8125rem] hover:bg-[var(--surface-sunken)]"
                    >
                      {c.title} {c.subtitle && <span className="text-[var(--text-muted)]">· {c.subtitle}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {courseId && <p className="mt-1 text-[0.75rem] text-success-700">Selected.</p>}
          </Field>
        )}

        {(sourceType === "DOCUMENT" || sourceType === "TRANSCRIPT") && (
          <Field
            label={sourceType === "DOCUMENT" ? "Document text" : "Transcript text"}
            htmlFor="video-source-text"
            hint="For PDF/DOCX, paste the extracted text."
          >
            <Textarea id="video-source-text" value={sourceText} onChange={(e) => setSourceText(e.target.value)} rows={6} />
          </Field>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={mode === "AVATAR" && avatarAvailable ? "Avatar / voice ID" : "Voice"} htmlFor="video-voice">
            {mode === "AVATAR" && avatarAvailable ? (
              <Input
                id="video-voice"
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                placeholder="Avatar ID from your provider dashboard"
              />
            ) : ttsVoices.length > 0 ? (
              <Select id="video-voice" value={voice} onChange={(e) => setVoice(e.target.value)}>
                {ttsVoices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="pt-2 text-[0.75rem] text-[var(--text-muted)]">
                No narration voice configured — this video will render with on-screen text and captions only.
              </p>
            )}
          </Field>
          <Field label="Language" htmlFor="video-language">
            <Select id="video-language" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {(languages.includes("en") ? languages : ["en", ...languages]).map((code) => (
                <option key={code} value={code}>
                  {LANGUAGE_LABELS[code] ?? code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Aspect ratio" htmlFor="video-aspect">
            <Select id="video-aspect" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as (typeof ASPECT_RATIOS)[number])}>
              {ASPECT_RATIOS.map((r) => (
                <option key={r} value={r}>
                  {r} {r === "16:9" ? "(widescreen)" : r === "9:16" ? "(mobile/vertical)" : "(square)"}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={handleSubmit} loading={submitting}>
          <Glyph name="sparkle" className="h-4 w-4" />
          Generate plan
        </Button>
      </CardFooter>
    </Card>
  );
}
