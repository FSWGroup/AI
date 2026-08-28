"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  generateCourseOutlineAction,
  generateCourseFromOutlineAction,
  saveCourseDraftAction,
  searchSopsAction,
  type ContentOption,
} from "@/app/(app)/admin/ai-studio/actions";
import type { CourseOutline, CourseDraft } from "@/lib/ai/generate";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Glyph } from "@/components/icons";
import { AiGeneratedBadge } from "@/components/ai/ai-badge";
import { LessonContentEditor } from "@/components/ai/lesson-content-editor";

type SourceMode = "prompt" | "sop" | "document";
type Step = "source" | "outline" | "full";

export function CourseDraftFlow({ available, initialSopId }: { available: boolean; initialSopId: string | null }) {
  const [step, setStep] = React.useState<Step>("source");
  const [sourceMode, setSourceMode] = React.useState<SourceMode>(initialSopId ? "sop" : "prompt");
  const [prompt, setPrompt] = React.useState("");
  const [documentText, setDocumentText] = React.useState("");
  const [sopQuery, setSopQuery] = React.useState("");
  const [sopOptions, setSopOptions] = React.useState<ContentOption[]>([]);
  const [sopId, setSopId] = React.useState<string | null>(initialSopId);
  const [generatingOutline, setGeneratingOutline] = React.useState(false);
  const [generatingFull, setGeneratingFull] = React.useState(false);
  const [outline, setOutline] = React.useState<CourseOutline | null>(null);
  const [fullDraft, setFullDraft] = React.useState<CourseDraft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState<{ id: string; href: string } | null>(null);

  React.useEffect(() => {
    if (sourceMode !== "sop") return;
    const handle = setTimeout(async () => {
      const result = await searchSopsAction(sopQuery);
      if (result.ok) setSopOptions(result.data);
    }, 250);
    return () => clearTimeout(handle);
  }, [sopQuery, sourceMode]);

  async function handleGenerateOutline() {
    if (sourceMode === "prompt" && prompt.trim().length < 10) {
      toast.error("Describe the course you want in a bit more detail.");
      return;
    }
    if (sourceMode === "sop" && !sopId) {
      toast.error("Pick an SOP to build the course from.");
      return;
    }
    if (sourceMode === "document" && documentText.trim().length < 20) {
      toast.error("Paste some document text first.");
      return;
    }

    setGeneratingOutline(true);
    try {
      const result = await generateCourseOutlineAction({
        prompt: sourceMode === "prompt" ? prompt : undefined,
        sopId: sourceMode === "sop" ? (sopId ?? undefined) : undefined,
        documentText: sourceMode === "document" ? documentText : undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOutline(result.data);
      setStep("outline");
    } finally {
      setGeneratingOutline(false);
    }
  }

  async function handleGenerateFull() {
    if (!outline) return;
    setGeneratingFull(true);
    try {
      const result = await generateCourseFromOutlineAction(outline);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setFullDraft(result.data);
      setStep("full");
    } finally {
      setGeneratingFull(false);
    }
  }

  async function handleSave() {
    if (!fullDraft) return;
    setSaving(true);
    try {
      const result = await saveCourseDraftAction(fullDraft);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSaved(result.data);
      toast.success("Saved as a draft course.");
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-success-50 text-success-700">
            <Glyph name="check" className="h-5 w-5" />
          </div>
          <p className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">Draft course saved</p>
          <p className="max-w-sm text-[0.8125rem] text-[var(--text-muted)]">
            It&apos;s saved as a draft — nothing is published or visible to learners yet.
          </p>
          <div className="mt-2 flex gap-2">
            <Link
              href={saved.href}
              className="inline-flex h-9.5 items-center justify-center rounded-md bg-[var(--brand-primary)] px-4 text-sm font-medium text-white hover:bg-[var(--brand-primary-hover)]"
            >
              Continue editing
            </Link>
            {fullDraft?.suggestedVideoConcept && (
              <Link
                href={`/admin/video-studio/new?fromCourse=${saved.id}`}
                className="inline-flex h-9.5 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-4 text-sm font-medium hover:bg-[var(--surface-sunken)]"
              >
                Create the suggested video
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (step === "source") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Source material</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!available && (
            <p className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-[0.8125rem] text-warning-800">
              AI text generation isn&apos;t configured — generation will fail until an administrator sets an API key.
            </p>
          )}
          <Field label="Build from" htmlFor="source-mode">
            <Select id="source-mode" value={sourceMode} onChange={(e) => setSourceMode(e.target.value as SourceMode)}>
              <option value="prompt">A prompt</option>
              <option value="sop">An existing SOP</option>
              <option value="document">Pasted document text</option>
            </Select>
          </Field>

          {sourceMode === "prompt" && (
            <Field label="Describe the course" htmlFor="course-prompt">
              <Textarea
                id="course-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                placeholder="e.g. A course teaching new warehouse staff how to safely operate a forklift"
              />
            </Field>
          )}

          {sourceMode === "sop" && (
            <Field label="Search for an SOP" htmlFor="sop-search">
              <Input id="sop-search" value={sopQuery} onChange={(e) => setSopQuery(e.target.value)} placeholder="Start typing a title…" />
              {sopOptions.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 rounded-md border border-[var(--border-subtle)] p-1">
                  {sopOptions.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSopId(s.id);
                          setSopQuery(s.title);
                          setSopOptions([]);
                        }}
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

          {sourceMode === "document" && (
            <Field label="Document text" htmlFor="doc-text" hint="For PDF/DOCX, paste the extracted text.">
              <Textarea id="doc-text" value={documentText} onChange={(e) => setDocumentText(e.target.value)} rows={8} />
            </Field>
          )}
        </CardContent>
        <CardFooter className="justify-end">
          <Button onClick={handleGenerateOutline} loading={generatingOutline}>
            <Glyph name="sparkle" className="h-4 w-4" />
            Generate outline
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (step === "outline" && outline) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <AiGeneratedBadge />
          <Button variant="ghost" size="sm" onClick={() => setStep("source")}>
            <Glyph name="arrow-left" className="h-4 w-4" />
            Back to source
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Outline</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label="Title" htmlFor="outline-title" required>
              <Input id="outline-title" value={outline.title} onChange={(e) => setOutline({ ...outline, title: e.target.value })} />
            </Field>
            <Field label="Description" htmlFor="outline-desc">
              <Textarea
                id="outline-desc"
                value={outline.description}
                onChange={(e) => setOutline({ ...outline, description: e.target.value })}
                rows={2}
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Category" htmlFor="outline-category">
                <Input id="outline-category" value={outline.category} onChange={(e) => setOutline({ ...outline, category: e.target.value })} />
              </Field>
              <Field label="Difficulty" htmlFor="outline-difficulty">
                <Select
                  id="outline-difficulty"
                  value={outline.difficulty}
                  onChange={(e) => setOutline({ ...outline, difficulty: e.target.value as CourseOutline["difficulty"] })}
                >
                  <option value="INTRO">Intro</option>
                  <option value="BEGINNER">Beginner</option>
                  <option value="INTERMEDIATE">Intermediate</option>
                  <option value="ADVANCED">Advanced</option>
                </Select>
              </Field>
              <Field label="Estimated minutes" htmlFor="outline-minutes">
                <Input
                  id="outline-minutes"
                  type="number"
                  value={outline.estimatedMinutes}
                  onChange={(e) => setOutline({ ...outline, estimatedMinutes: Number(e.target.value) || 0 })}
                />
              </Field>
            </div>
            <Field label="Learning objectives" htmlFor="outline-objectives" hint="One per line">
              <Textarea
                id="outline-objectives"
                value={outline.learningObjectives.join("\n")}
                onChange={(e) => setOutline({ ...outline, learningObjectives: e.target.value.split("\n").filter(Boolean) })}
                rows={3}
              />
            </Field>
          </CardContent>
        </Card>

        {outline.sections.map((section, sIndex) => (
          <Card key={sIndex}>
            <CardHeader className="flex-row items-center justify-between">
              <Input
                aria-label="Section title"
                value={section.title}
                onChange={(e) => {
                  const sections = [...outline.sections];
                  sections[sIndex] = { ...section, title: e.target.value };
                  setOutline({ ...outline, sections });
                }}
                className="max-w-sm font-semibold"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove section"
                onClick={() => setOutline({ ...outline, sections: outline.sections.filter((_, i) => i !== sIndex) })}
              >
                <Glyph name="trash" className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {section.lessons.map((lesson, lIndex) => (
                <div key={lIndex} className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] p-2">
                  <Input
                    aria-label="Lesson title"
                    value={lesson.title}
                    onChange={(e) => {
                      const sections = [...outline.sections];
                      const lessons = [...section.lessons];
                      lessons[lIndex] = { ...lesson, title: e.target.value };
                      sections[sIndex] = { ...section, lessons };
                      setOutline({ ...outline, sections });
                    }}
                    className="flex-1"
                  />
                  <Select
                    aria-label="Lesson type"
                    value={lesson.type}
                    onChange={(e) => {
                      const sections = [...outline.sections];
                      const lessons = [...section.lessons];
                      lessons[lIndex] = { ...lesson, type: e.target.value };
                      sections[sIndex] = { ...section, lessons };
                      setOutline({ ...outline, sections });
                    }}
                    className="w-40"
                  >
                    {["RICH_TEXT", "SOP_REF", "VIDEO", "QUIZ", "CHECKLIST", "SCENARIO", "ACKNOWLEDGEMENT"].map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, " ")}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove lesson"
                    onClick={() => {
                      const sections = [...outline.sections];
                      sections[sIndex] = { ...section, lessons: section.lessons.filter((_, i) => i !== lIndex) };
                      setOutline({ ...outline, sections });
                    }}
                  >
                    <Glyph name="trash" className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const sections = [...outline.sections];
                  sections[sIndex] = {
                    ...section,
                    lessons: [...section.lessons, { title: "New lesson", type: "RICH_TEXT", estimatedMinutes: 5, summary: "" }],
                  };
                  setOutline({ ...outline, sections });
                }}
              >
                <Glyph name="plus" className="h-3.5 w-3.5" />
                Add lesson
              </Button>
            </CardContent>
          </Card>
        ))}

        <Button
          type="button"
          variant="outline"
          onClick={() => setOutline({ ...outline, sections: [...outline.sections, { title: "New section", lessons: [] }] })}
        >
          <Glyph name="plus" className="h-3.5 w-3.5" />
          Add section
        </Button>

        <div className="flex justify-end pb-8">
          <Button onClick={handleGenerateFull} loading={generatingFull}>
            <Glyph name="sparkle" className="h-4 w-4" />
            Generate full lesson content
          </Button>
        </div>
      </div>
    );
  }

  if (step === "full" && fullDraft) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <AiGeneratedBadge />
          <Button variant="ghost" size="sm" onClick={() => setStep("outline")}>
            <Glyph name="arrow-left" className="h-4 w-4" />
            Back to outline
          </Button>
        </div>

        {fullDraft.suggestedVideoConcept && (
          <Card className="border-[var(--border-subtle)] bg-[var(--surface-sunken)]">
            <CardContent className="py-3.5">
              <p className="mb-1 text-[0.75rem] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Suggested video
              </p>
              <p className="text-[0.8125rem] text-[var(--text-secondary)]">{fullDraft.suggestedVideoConcept}</p>
            </CardContent>
          </Card>
        )}

        {fullDraft.sections.map((section, sIndex) => (
          <Card key={sIndex}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {section.lessons.map((lesson, lIndex) => (
                <div key={lIndex} className="rounded-md border border-[var(--border-subtle)] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{lesson.title}</span>
                    <span className="text-[0.6875rem] uppercase tracking-wide text-[var(--text-muted)]">
                      {lesson.type.replace(/_/g, " ")}
                    </span>
                  </div>
                  <LessonContentEditor
                    type={lesson.type}
                    content={lesson.content}
                    onChange={(content) => {
                      const sections = [...fullDraft.sections];
                      const lessons = [...section.lessons];
                      lessons[lIndex] = { ...lesson, content };
                      sections[sIndex] = { ...section, lessons };
                      setFullDraft({ ...fullDraft, sections });
                    }}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}

        <div className="flex justify-end gap-2 pb-8">
          <Button variant="outline" onClick={() => setStep("outline")}>
            Back
          </Button>
          <Button onClick={handleSave} loading={saving}>
            Save as draft
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
