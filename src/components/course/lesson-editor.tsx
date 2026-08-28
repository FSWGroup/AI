"use client";

import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Glyph } from "@/components/icons";
import { LESSON_TYPE_LABEL, LESSON_TYPES } from "@/components/lesson/lesson-type-label";
import { QuestionEditor } from "@/components/course/question-editor";
import type { BuilderLesson } from "@/components/course/course-builder";
import { updateLessonAction, createLiveSessionAction, listSopsForPicker } from "@/app/(app)/admin/training/[id]/edit/actions";

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id_${Date.now()}_${Math.random()}`;
}

export function LessonEditor({
  courseId,
  lesson,
  onSaved,
}: {
  courseId: string;
  lesson: BuilderLesson;
  onSaved: () => void;
}) {
  const [title, setTitle] = React.useState(lesson.title);
  const [type, setType] = React.useState(lesson.type);
  const [required, setRequired] = React.useState(lesson.required);
  const [estimatedMinutes, setEstimatedMinutes] = React.useState(lesson.estimatedMinutes?.toString() ?? "");
  const [savingMeta, setSavingMeta] = React.useState(false);

  async function saveMeta() {
    setSavingMeta(true);
    const result = await updateLessonAction(courseId, lesson.id, {
      title,
      type,
      required,
      estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
    });
    setSavingMeta(false);
    if (!result.ok) return toast.error(result.error);
    toast.success("Saved.");
    onSaved();
  }

  async function saveContent(content: Record<string, unknown>) {
    const result = await updateLessonAction(courseId, lesson.id, { content });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success("Content saved.");
    onSaved();
    return true;
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Lesson settings</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" htmlFor="lesson-title" required>
              <Input id="lesson-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Type" htmlFor="lesson-type">
              <Select id="lesson-type" value={type} onChange={(e) => setType(e.target.value)}>
                {LESSON_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {LESSON_TYPE_LABEL[t] ?? t}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Estimated minutes" htmlFor="lesson-minutes">
              <Input id="lesson-minutes" type="number" min={0} value={estimatedMinutes} onChange={(e) => setEstimatedMinutes(e.target.value)} />
            </Field>
            <label className="mt-6 flex items-center gap-2 text-[0.875rem] text-[var(--text-primary)]">
              <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="h-4 w-4 accent-[var(--brand-primary)]" />
              Required to complete the course
            </label>
          </div>
          <div>
            <Button size="sm" loading={savingMeta} onClick={saveMeta}>
              Save settings
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Content</CardTitle>
        </CardHeader>
        <CardContent>
          <ContentEditor key={lesson.id} type={type} content={lesson.content ?? {}} lessonId={lesson.id} courseId={courseId} onSave={saveContent} />
        </CardContent>
      </Card>

      {type === "QUIZ" && <QuestionEditor courseId={courseId} lesson={lesson} onSaved={onSaved} />}
    </div>
  );
}

function ContentEditor({
  type,
  content,
  lessonId,
  courseId,
  onSave,
}: {
  type: string;
  content: Record<string, unknown>;
  lessonId: string;
  courseId: string;
  onSave: (content: Record<string, unknown>) => Promise<boolean>;
}) {
  switch (type) {
    case "RICH_TEXT":
    case "FLOWCHART":
      return <BlocksJsonEditor content={content} onSave={onSave} />;
    case "SOP_REF":
      return <SopRefEditor content={content} onSave={onSave} />;
    case "VIDEO":
    case "AI_VIDEO":
    case "SCREEN_RECORDING":
    case "AUDIO":
    case "DOCUMENT":
    case "PRESENTATION":
    case "IMAGE":
      return <MediaEditor content={content} onSave={onSave} />;
    case "CHECKLIST":
      return <ChecklistEditor content={content} onSave={onSave} />;
    case "FLASHCARDS":
      return <FlashcardsEditor content={content} onSave={onSave} />;
    case "SCENARIO":
      return <ScenarioEditor content={content} onSave={onSave} />;
    case "SURVEY":
      return <SurveyEditor content={content} onSave={onSave} />;
    case "ACKNOWLEDGEMENT":
      return <AcknowledgementEditor content={content} onSave={onSave} signatureOnly={false} />;
    case "SIGNATURE":
      return <AcknowledgementEditor content={content} onSave={onSave} signatureOnly />;
    case "MANAGER_SIGNOFF":
    case "PRACTICAL_DEMO":
      return <SignoffEditor content={content} onSave={onSave} />;
    case "ASSIGNMENT_PROJECT":
      return <InstructionsEditor content={content} onSave={onSave} />;
    case "EXTERNAL_LINK":
      return <ExternalLinkEditor content={content} onSave={onSave} />;
    case "DOWNLOAD":
      return <DownloadEditor content={content} onSave={onSave} />;
    case "EMBED":
      return <EmbedEditor content={content} onSave={onSave} />;
    case "LIVE_SESSION":
      return <LiveSessionEditor content={content} courseId={courseId} lessonId={lessonId} onSave={onSave} />;
    case "DISCUSSION":
      return <DiscussionEditor content={content} onSave={onSave} />;
    case "QUIZ":
      return <QuizSettingsEditor content={content} onSave={onSave} />;
    default:
      return <p className="text-[0.8125rem] text-[var(--text-muted)]">No content editor is available for this type.</p>;
  }
}

function SaveRow({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <div>
      <Button size="sm" loading={loading} onClick={onClick}>
        Save content
      </Button>
    </div>
  );
}

function useSaving(onSave: (content: Record<string, unknown>) => Promise<boolean>) {
  const [loading, setLoading] = React.useState(false);
  const save = async (content: Record<string, unknown>) => {
    setLoading(true);
    await onSave(content);
    setLoading(false);
  };
  return { loading, save };
}

function BlocksJsonEditor({
  content,
  onSave,
}: {
  content: Record<string, unknown>;
  onSave: (content: Record<string, unknown>) => Promise<boolean>;
}) {
  const [text, setText] = React.useState(() => JSON.stringify(content.blocks ?? [], null, 2));
  const [error, setError] = React.useState<string | null>(null);
  const { loading, save } = useSaving(onSave);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.75rem] text-[var(--text-muted)]">
        Advanced: edit the block array as JSON. See the block schema (heading, paragraph, list, table, callout, warning,
        checklist, etc.) in the content library docs.
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={16}
        className="font-mono text-[0.75rem]"
        aria-label="Blocks JSON"
      />
      {error && <p className="text-[0.75rem] font-medium text-danger-700">{error}</p>}
      <div>
        <Button
          size="sm"
          loading={loading}
          onClick={async () => {
            try {
              const blocks = JSON.parse(text);
              if (!Array.isArray(blocks)) throw new Error("Blocks must be a JSON array.");
              setError(null);
              await save({ blocks });
            } catch (e) {
              setError(e instanceof Error ? e.message : "Invalid JSON.");
            }
          }}
        >
          Save content
        </Button>
      </div>
    </div>
  );
}

function SopRefEditor({
  content,
  onSave,
}: {
  content: Record<string, unknown>;
  onSave: (content: Record<string, unknown>) => Promise<boolean>;
}) {
  const [sops, setSops] = React.useState<{ id: string; code: string; title: string }[]>([]);
  const [sopId, setSopId] = React.useState((content.sopId as string) ?? "");
  const { loading, save } = useSaving(onSave);

  React.useEffect(() => {
    void listSopsForPicker().then(setSops);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <Field label="SOP" htmlFor="sop-picker" hint="Only published SOPs are listed.">
        <Select id="sop-picker" value={sopId} onChange={(e) => setSopId(e.target.value)}>
          <option value="">Select an SOP…</option>
          {sops.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.title}
            </option>
          ))}
        </Select>
      </Field>
      <SaveRow loading={loading} onClick={() => save({ sopId: sopId || null })} />
    </div>
  );
}

function MediaEditor({
  content,
  onSave,
}: {
  content: Record<string, unknown>;
  onSave: (content: Record<string, unknown>) => Promise<boolean>;
}) {
  const [mediaId, setMediaId] = React.useState((content.mediaId as string) ?? "");
  const [externalUrl, setExternalUrl] = React.useState((content.externalUrl as string) ?? "");
  const { loading, save } = useSaving(onSave);

  return (
    <div className="flex flex-col gap-3">
      <Field label="Media asset ID" htmlFor="media-id" hint="Upload the file in the Media Library, then paste its ID here.">
        <Input id="media-id" value={mediaId} onChange={(e) => setMediaId(e.target.value)} />
      </Field>
      <Field label="External URL" htmlFor="media-url" hint="Optional fallback, or use instead of an uploaded file.">
        <Input id="media-url" value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} />
      </Field>
      <SaveRow loading={loading} onClick={() => save({ mediaId: mediaId || null, externalUrl: externalUrl || null })} />
    </div>
  );
}

function ChecklistEditor({
  content,
  onSave,
}: {
  content: Record<string, unknown>;
  onSave: (content: Record<string, unknown>) => Promise<boolean>;
}) {
  const [requireAll, setRequireAll] = React.useState((content.requireAll as boolean) !== false);
  const [items, setItems] = React.useState<{ id: string; text: string }[]>(
    (content.items as { id: string; text: string }[] | undefined) ?? [],
  );
  const { loading, save } = useSaving(onSave);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-[0.875rem] text-[var(--text-primary)]">
        <input type="checkbox" checked={requireAll} onChange={(e) => setRequireAll(e.target.checked)} className="h-4 w-4 accent-[var(--brand-primary)]" />
        Require every item to complete the lesson
      </label>
      {items.map((item, i) => (
        <div key={item.id} className="flex items-center gap-2">
          <Input
            value={item.text}
            onChange={(e) => setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, text: e.target.value } : it)))}
          />
          <Button variant="ghost" size="sm" onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Remove item">
            <Glyph name="trash" className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start" onClick={() => setItems((prev) => [...prev, { id: newId(), text: "" }])}>
        <Glyph name="plus" className="h-4 w-4" />
        Add item
      </Button>
      <SaveRow loading={loading} onClick={() => save({ requireAll, items: items.filter((i) => i.text.trim()) })} />
    </div>
  );
}

function FlashcardsEditor({
  content,
  onSave,
}: {
  content: Record<string, unknown>;
  onSave: (content: Record<string, unknown>) => Promise<boolean>;
}) {
  const [cards, setCards] = React.useState<{ id: string; front: string; back: string }[]>(
    (content.cards as { id: string; front: string; back: string }[] | undefined) ?? [],
  );
  const { loading, save } = useSaving(onSave);

  return (
    <div className="flex flex-col gap-3">
      {cards.map((card, i) => (
        <div key={card.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <Input placeholder="Front" value={card.front} onChange={(e) => setCards((p) => p.map((c, idx) => (idx === i ? { ...c, front: e.target.value } : c)))} />
          <Input placeholder="Back" value={card.back} onChange={(e) => setCards((p) => p.map((c, idx) => (idx === i ? { ...c, back: e.target.value } : c)))} />
          <Button variant="ghost" size="sm" onClick={() => setCards((p) => p.filter((_, idx) => idx !== i))} aria-label="Remove card">
            <Glyph name="trash" className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start" onClick={() => setCards((p) => [...p, { id: newId(), front: "", back: "" }])}>
        <Glyph name="plus" className="h-4 w-4" />
        Add card
      </Button>
      <SaveRow loading={loading} onClick={() => save({ cards: cards.filter((c) => c.front.trim() || c.back.trim()) })} />
    </div>
  );
}

function ScenarioEditor({
  content,
  onSave,
}: {
  content: Record<string, unknown>;
  onSave: (content: Record<string, unknown>) => Promise<boolean>;
}) {
  const [scenario, setScenario] = React.useState((content.scenario as string) ?? "");
  const [choices, setChoices] = React.useState<{ id: string; label: string; correct?: boolean; feedback?: string }[]>(
    (content.choices as { id: string; label: string; correct?: boolean; feedback?: string }[] | undefined) ?? [],
  );
  const { loading, save } = useSaving(onSave);

  return (
    <div className="flex flex-col gap-3">
      <Field label="Scenario" htmlFor="scenario-text">
        <Textarea id="scenario-text" value={scenario} onChange={(e) => setScenario(e.target.value)} rows={3} />
      </Field>
      {choices.map((choice, i) => (
        <div key={choice.id} className="flex flex-col gap-1.5 rounded-md border border-[var(--border-subtle)] p-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Choice label"
              value={choice.label}
              onChange={(e) => setChoices((p) => p.map((c, idx) => (idx === i ? { ...c, label: e.target.value } : c)))}
            />
            <label className="flex shrink-0 items-center gap-1.5 text-[0.75rem] text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={Boolean(choice.correct)}
                onChange={(e) => setChoices((p) => p.map((c, idx) => (idx === i ? { ...c, correct: e.target.checked } : c)))}
                className="h-4 w-4 accent-[var(--brand-primary)]"
              />
              Correct
            </label>
            <Button variant="ghost" size="sm" onClick={() => setChoices((p) => p.filter((_, idx) => idx !== i))} aria-label="Remove choice">
              <Glyph name="trash" className="h-4 w-4" />
            </Button>
          </div>
          <Textarea
            placeholder="Feedback shown after this choice"
            value={choice.feedback ?? ""}
            onChange={(e) => setChoices((p) => p.map((c, idx) => (idx === i ? { ...c, feedback: e.target.value } : c)))}
            rows={2}
          />
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start" onClick={() => setChoices((p) => [...p, { id: newId(), label: "" }])}>
        <Glyph name="plus" className="h-4 w-4" />
        Add choice
      </Button>
      <SaveRow loading={loading} onClick={() => save({ scenario, choices: choices.filter((c) => c.label.trim()) })} />
    </div>
  );
}

function SurveyEditor({
  content,
  onSave,
}: {
  content: Record<string, unknown>;
  onSave: (content: Record<string, unknown>) => Promise<boolean>;
}) {
  interface SQ {
    id: string;
    prompt: string;
    kind: "text" | "rating" | "choice";
    options?: string;
  }
  const initial = ((content.questions as { id: string; prompt: string; kind: string; options?: string[] }[] | undefined) ?? []).map(
    (q) => ({ id: q.id, prompt: q.prompt, kind: q.kind as SQ["kind"], options: (q.options ?? []).join(", ") }),
  );
  const [questions, setQuestions] = React.useState<SQ[]>(initial);
  const { loading, save } = useSaving(onSave);

  return (
    <div className="flex flex-col gap-3">
      {questions.map((q, i) => (
        <div key={q.id} className="flex flex-col gap-2 rounded-md border border-[var(--border-subtle)] p-3">
          <div className="flex items-center gap-2">
            <Input placeholder="Question" value={q.prompt} onChange={(e) => setQuestions((p) => p.map((x, idx) => (idx === i ? { ...x, prompt: e.target.value } : x)))} />
            <Select value={q.kind} onChange={(e) => setQuestions((p) => p.map((x, idx) => (idx === i ? { ...x, kind: e.target.value as SQ["kind"] } : x)))} className="w-32">
              <option value="text">Text</option>
              <option value="rating">Rating</option>
              <option value="choice">Choice</option>
            </Select>
            <Button variant="ghost" size="sm" onClick={() => setQuestions((p) => p.filter((_, idx) => idx !== i))} aria-label="Remove question">
              <Glyph name="trash" className="h-4 w-4" />
            </Button>
          </div>
          {q.kind === "choice" && (
            <Input
              placeholder="Options, comma separated"
              value={q.options ?? ""}
              onChange={(e) => setQuestions((p) => p.map((x, idx) => (idx === i ? { ...x, options: e.target.value } : x)))}
            />
          )}
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start" onClick={() => setQuestions((p) => [...p, { id: newId(), prompt: "", kind: "text" }])}>
        <Glyph name="plus" className="h-4 w-4" />
        Add question
      </Button>
      <SaveRow
        loading={loading}
        onClick={() =>
          save({
            questions: questions
              .filter((q) => q.prompt.trim())
              .map((q) => ({
                id: q.id,
                prompt: q.prompt,
                kind: q.kind,
                options: q.options ? q.options.split(",").map((o) => o.trim()).filter(Boolean) : undefined,
              })),
          })
        }
      />
    </div>
  );
}

function AcknowledgementEditor({
  content,
  onSave,
  signatureOnly,
}: {
  content: Record<string, unknown>;
  onSave: (content: Record<string, unknown>) => Promise<boolean>;
  signatureOnly: boolean;
}) {
  const [statement, setStatement] = React.useState((content.statement as string) ?? "");
  const [sopCode, setSopCode] = React.useState((content.sopCode as string) ?? "");
  const [requireTypedSignature, setRequireTypedSignature] = React.useState(Boolean(content.requireTypedSignature));
  const { loading, save } = useSaving(onSave);

  return (
    <div className="flex flex-col gap-3">
      <Field label="Statement" htmlFor="ack-statement" required>
        <Textarea id="ack-statement" value={statement} onChange={(e) => setStatement(e.target.value)} rows={4} />
      </Field>
      {!signatureOnly && (
        <>
          <Field label="Related SOP code" htmlFor="ack-sop" hint="Optional — for reference only.">
            <Input id="ack-sop" value={sopCode} onChange={(e) => setSopCode(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-[0.875rem] text-[var(--text-primary)]">
            <input type="checkbox" checked={requireTypedSignature} onChange={(e) => setRequireTypedSignature(e.target.checked)} className="h-4 w-4 accent-[var(--brand-primary)]" />
            Also require a typed signature
          </label>
        </>
      )}
      <SaveRow loading={loading} onClick={() => save({ statement, sopCode: sopCode || undefined, requireTypedSignature })} />
    </div>
  );
}

function SignoffEditor({
  content,
  onSave,
}: {
  content: Record<string, unknown>;
  onSave: (content: Record<string, unknown>) => Promise<boolean>;
}) {
  const [instruction, setInstruction] = React.useState((content.instruction as string) ?? "");
  const [criteria, setCriteria] = React.useState(((content.criteria as string[] | undefined) ?? []).join("\n"));
  const { loading, save } = useSaving(onSave);

  return (
    <div className="flex flex-col gap-3">
      <Field label="Instruction" htmlFor="signoff-instruction">
        <Textarea id="signoff-instruction" value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={3} />
      </Field>
      <Field label="Criteria" htmlFor="signoff-criteria" hint="One per line.">
        <Textarea id="signoff-criteria" value={criteria} onChange={(e) => setCriteria(e.target.value)} rows={4} />
      </Field>
      <SaveRow
        loading={loading}
        onClick={() => save({ instruction, criteria: criteria.split("\n").map((c) => c.trim()).filter(Boolean) })}
      />
    </div>
  );
}

function InstructionsEditor({
  content,
  onSave,
}: {
  content: Record<string, unknown>;
  onSave: (content: Record<string, unknown>) => Promise<boolean>;
}) {
  const [instructions, setInstructions] = React.useState((content.instructions as string) ?? "");
  const { loading, save } = useSaving(onSave);

  return (
    <div className="flex flex-col gap-3">
      <Field label="Instructions" htmlFor="project-instructions">
        <Textarea id="project-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={5} />
      </Field>
      <SaveRow loading={loading} onClick={() => save({ instructions })} />
    </div>
  );
}

function ExternalLinkEditor({
  content,
  onSave,
}: {
  content: Record<string, unknown>;
  onSave: (content: Record<string, unknown>) => Promise<boolean>;
}) {
  const [url, setUrl] = React.useState((content.url as string) ?? "");
  const [label, setLabel] = React.useState((content.label as string) ?? "");
  const { loading, save } = useSaving(onSave);

  return (
    <div className="flex flex-col gap-3">
      <Field label="URL" htmlFor="link-url" required>
        <Input id="link-url" value={url} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      <Field label="Link label" htmlFor="link-label">
        <Input id="link-label" value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <SaveRow loading={loading} onClick={() => save({ url, label: label || undefined })} />
    </div>
  );
}

function DownloadEditor({
  content,
  onSave,
}: {
  content: Record<string, unknown>;
  onSave: (content: Record<string, unknown>) => Promise<boolean>;
}) {
  const [mediaId, setMediaId] = React.useState((content.mediaId as string) ?? "");
  const [label, setLabel] = React.useState((content.label as string) ?? "");
  const { loading, save } = useSaving(onSave);

  return (
    <div className="flex flex-col gap-3">
      <Field label="Media asset ID" htmlFor="download-media">
        <Input id="download-media" value={mediaId} onChange={(e) => setMediaId(e.target.value)} />
      </Field>
      <Field label="Label" htmlFor="download-label">
        <Input id="download-label" value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <SaveRow loading={loading} onClick={() => save({ mediaId: mediaId || null, label: label || undefined })} />
    </div>
  );
}

function EmbedEditor({
  content,
  onSave,
}: {
  content: Record<string, unknown>;
  onSave: (content: Record<string, unknown>) => Promise<boolean>;
}) {
  const [url, setUrl] = React.useState((content.url as string) ?? "");
  const [title, setTitle] = React.useState((content.title as string) ?? "");
  const [height, setHeight] = React.useState(((content.height as number) ?? 420).toString());
  const { loading, save } = useSaving(onSave);

  return (
    <div className="flex flex-col gap-3">
      <Field label="Embed URL" htmlFor="embed-url" required>
        <Input id="embed-url" value={url} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" htmlFor="embed-title">
          <Input id="embed-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Height (px)" htmlFor="embed-height">
          <Input id="embed-height" type="number" min={120} max={1200} value={height} onChange={(e) => setHeight(e.target.value)} />
        </Field>
      </div>
      <SaveRow loading={loading} onClick={() => save({ url, title: title || undefined, height: Number(height) || 420 })} />
    </div>
  );
}

function LiveSessionEditor({
  content,
  courseId,
  lessonId,
  onSave,
}: {
  content: Record<string, unknown>;
  courseId: string;
  lessonId: string;
  onSave: (content: Record<string, unknown>) => Promise<boolean>;
}) {
  const existingId = content.liveSessionId as string | undefined;
  const [title, setTitle] = React.useState("");
  const [startsAt, setStartsAt] = React.useState("");
  const [endsAt, setEndsAt] = React.useState("");
  const [timezone, setTimezone] = React.useState("America/New_York");
  const [locationText, setLocationText] = React.useState("");
  const [capacity, setCapacity] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  return (
    <div className="flex flex-col gap-3">
      {existingId && (
        <p className="text-[0.8125rem] text-[var(--text-secondary)]">
          A session is scheduled for this lesson. Submit below to reschedule it.
        </p>
      )}
      <Field label="Session title" htmlFor="live-title">
        <Input id="live-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts" htmlFor="live-start">
          <Input id="live-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </Field>
        <Field label="Ends" htmlFor="live-end">
          <Input id="live-end" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Timezone" htmlFor="live-tz">
          <Input id="live-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </Field>
        <Field label="Location / link" htmlFor="live-location">
          <Input id="live-location" value={locationText} onChange={(e) => setLocationText(e.target.value)} />
        </Field>
        <Field label="Capacity" htmlFor="live-capacity" hint="Blank = unlimited">
          <Input id="live-capacity" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </Field>
      </div>
      <div>
        <Button
          size="sm"
          loading={loading}
          onClick={async () => {
            if (!title.trim() || !startsAt || !endsAt) {
              toast.error("Title, start, and end are required.");
              return;
            }
            setLoading(true);
            const result = await createLiveSessionAction(courseId, lessonId, {
              title,
              startsAt: new Date(startsAt).toISOString(),
              endsAt: new Date(endsAt).toISOString(),
              timezone,
              locationText: locationText || undefined,
              capacity: capacity ? Number(capacity) : undefined,
            });
            setLoading(false);
            if (!result.ok) return toast.error(result.error);
            toast.success("Session scheduled.");
            await onSave({ liveSessionId: result.data.id });
          }}
        >
          Schedule session
        </Button>
      </div>
    </div>
  );
}

function DiscussionEditor({
  content,
  onSave,
}: {
  content: Record<string, unknown>;
  onSave: (content: Record<string, unknown>) => Promise<boolean>;
}) {
  const [prompt, setPrompt] = React.useState((content.prompt as string) ?? "");
  const { loading, save } = useSaving(onSave);

  return (
    <div className="flex flex-col gap-3">
      <Field label="Discussion prompt" htmlFor="discussion-prompt" hint="Optional — shown above the comment thread.">
        <Textarea id="discussion-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} />
      </Field>
      <SaveRow loading={loading} onClick={() => save({ prompt: prompt || undefined })} />
    </div>
  );
}

function QuizSettingsEditor({
  content,
  onSave,
}: {
  content: Record<string, unknown>;
  onSave: (content: Record<string, unknown>) => Promise<boolean>;
}) {
  const [oneQuestionAtATime, setOneQuestionAtATime] = React.useState((content.oneQuestionAtATime as boolean) !== false);
  const [poolSize, setPoolSize] = React.useState(content.poolSize ? String(content.poolSize) : "");
  const [shuffleQuestions, setShuffleQuestions] = React.useState((content.shuffleQuestions as boolean) !== false);
  const [shuffleAnswers, setShuffleAnswers] = React.useState((content.shuffleAnswers as boolean) !== false);
  const [showExplanations, setShowExplanations] = React.useState((content.showExplanations as boolean) !== false);
  const [reviewPolicy, setReviewPolicy] = React.useState((content.reviewPolicy as string) ?? "immediate");
  const { loading, save } = useSaving(onSave);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-[0.875rem] text-[var(--text-primary)]">
          <input type="checkbox" checked={oneQuestionAtATime} onChange={(e) => setOneQuestionAtATime(e.target.checked)} className="h-4 w-4 accent-[var(--brand-primary)]" />
          One question at a time
        </label>
        <label className="flex items-center gap-2 text-[0.875rem] text-[var(--text-primary)]">
          <input type="checkbox" checked={shuffleQuestions} onChange={(e) => setShuffleQuestions(e.target.checked)} className="h-4 w-4 accent-[var(--brand-primary)]" />
          Shuffle question order
        </label>
        <label className="flex items-center gap-2 text-[0.875rem] text-[var(--text-primary)]">
          <input type="checkbox" checked={shuffleAnswers} onChange={(e) => setShuffleAnswers(e.target.checked)} className="h-4 w-4 accent-[var(--brand-primary)]" />
          Shuffle answer order
        </label>
        <label className="flex items-center gap-2 text-[0.875rem] text-[var(--text-primary)]">
          <input type="checkbox" checked={showExplanations} onChange={(e) => setShowExplanations(e.target.checked)} className="h-4 w-4 accent-[var(--brand-primary)]" />
          Show explanations on review
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Question pool size" htmlFor="quiz-pool" hint="Blank = use every question">
          <Input id="quiz-pool" type="number" min={1} value={poolSize} onChange={(e) => setPoolSize(e.target.value)} />
        </Field>
        <Field label="Review policy" htmlFor="quiz-review">
          <Select id="quiz-review" value={reviewPolicy} onChange={(e) => setReviewPolicy(e.target.value)}>
            <option value="immediate">Show answers immediately</option>
            <option value="after_pass">Show answers only after passing</option>
            <option value="never">Never show answers</option>
          </Select>
        </Field>
      </div>
      <SaveRow
        loading={loading}
        onClick={() =>
          save({
            oneQuestionAtATime,
            poolSize: poolSize ? Number(poolSize) : undefined,
            shuffleQuestions,
            shuffleAnswers,
            showExplanations,
            reviewPolicy,
          })
        }
      />
    </div>
  );
}
