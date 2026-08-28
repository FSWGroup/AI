"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Difficulty } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, PromptDialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Glyph, Icon } from "@/components/icons";
import { LESSON_TYPE_LABEL } from "@/components/lesson/lesson-type-label";
import { LessonEditor } from "@/components/course/lesson-editor";
import {
  updateCourseMetaAction,
  addSectionAction,
  updateSectionAction,
  deleteSectionAction,
  reorderSectionsAction,
  addLessonAction,
  deleteLessonAction,
  reorderLessonsAction,
  publishCourseAction,
} from "@/app/(app)/admin/training/[id]/edit/actions";

export interface BuilderQuestion {
  id: string;
  type: string;
  order: number;
  prompt: string;
  config: Record<string, unknown>;
  points: number;
  required: boolean;
  explanation: string | null;
}
export interface BuilderLesson {
  id: string;
  title: string;
  type: string;
  order: number;
  required: boolean;
  estimatedMinutes: number | null;
  content: Record<string, unknown> | null;
  questions: BuilderQuestion[];
}
export interface BuilderSection {
  id: string;
  title: string;
  order: number;
  lessons: BuilderLesson[];
}
export interface BuilderCourse {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  departmentId: string | null;
  difficulty: string;
  estimatedMinutes: number | null;
  passingScore: number | null;
  attemptLimit: number | null;
  recertifyMonths: number | null;
  selfEnrollAllowed: boolean;
  requiredVideoPercent: number;
  status: string;
  sections: BuilderSection[];
  skills: { skillId: string; levelValue: number | null; skill: { name: string } }[];
}

const STATUS_TONE: Record<string, "neutral" | "warning" | "success" | "navy"> = {
  DRAFT: "neutral",
  IN_REVIEW: "warning",
  CHANGES_REQUESTED: "warning",
  APPROVED: "navy",
  PUBLISHED: "success",
  ARCHIVED: "neutral",
};

export function CourseBuilder({
  course,
  departments,
}: {
  course: BuilderCourse;
  departments: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [selectedLessonId, setSelectedLessonId] = React.useState<string | null>(
    course.sections[0]?.lessons[0]?.id ?? null,
  );
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [changeSummary, setChangeSummary] = React.useState("");
  const [publishing, setPublishing] = React.useState(false);
  const [savingMeta, setSavingMeta] = React.useState(false);

  /*
   * Naming and deletion run through the application's own dialogs. They used to
   * call window.prompt and window.confirm, which cannot be styled or labelled,
   * are announced inconsistently, and return null under automation — so "Add
   * section" could silently do nothing.
   */
  type Prompt =
    | { kind: "add-section" }
    | { kind: "rename-section"; sectionId: string; current: string }
    | { kind: "add-lesson"; sectionId: string };
  type Confirm =
    | { kind: "delete-section"; sectionId: string }
    | { kind: "delete-lesson"; lessonId: string };

  const [prompt, setPrompt] = React.useState<Prompt | null>(null);
  const [confirm, setConfirm] = React.useState<Confirm | null>(null);
  const [dialogBusy, setDialogBusy] = React.useState(false);

  const selectedLesson = course.sections
    .flatMap((s) => s.lessons)
    .find((l) => l.id === selectedLessonId);

  /** Runs a prompt's action, keeping the dialog open if the server rejects it. */
  async function submitPrompt(value: string) {
    if (!prompt) return;
    setDialogBusy(true);
    const result = await (prompt.kind === "add-section"
      ? addSectionAction(course.id, value)
      : prompt.kind === "rename-section"
        ? updateSectionAction(course.id, prompt.sectionId, value)
        : addLessonAction(course.id, prompt.sectionId, { title: value, type: "RICH_TEXT" }));
    setDialogBusy(false);

    if (!result.ok) return toast.error(result.error);
    if (prompt.kind === "add-lesson" && "data" in result && result.data) {
      setSelectedLessonId(result.data.id);
    }
    setPrompt(null);
    router.refresh();
  }

  async function submitConfirm() {
    if (!confirm) return;
    setDialogBusy(true);
    const result =
      confirm.kind === "delete-section"
        ? await deleteSectionAction(course.id, confirm.sectionId)
        : await deleteLessonAction(course.id, confirm.lessonId);
    setDialogBusy(false);

    if (!result.ok) return toast.error(result.error);
    if (confirm.kind === "delete-lesson" && selectedLessonId === confirm.lessonId) {
      setSelectedLessonId(null);
    }
    setConfirm(null);
    router.refresh();
  }

  function handleAddSection() {
    setPrompt({ kind: "add-section" });
  }

  function handleRenameSection(sectionId: string, current: string) {
    setPrompt({ kind: "rename-section", sectionId, current });
  }

  function handleDeleteSection(sectionId: string) {
    setConfirm({ kind: "delete-section", sectionId });
  }

  async function handleMoveSection(sectionId: string, direction: -1 | 1) {
    const ids = course.sections.map((s) => s.id);
    const index = ids.indexOf(sectionId);
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= ids.length) return;
    [ids[index], ids[swapWith]] = [ids[swapWith] as string, ids[index] as string];
    const result = await reorderSectionsAction(course.id, ids);
    if (!result.ok) return toast.error(result.error);
    router.refresh();
  }

  function handleAddLesson(sectionId: string) {
    setPrompt({ kind: "add-lesson", sectionId });
  }

  function handleDeleteLesson(lessonId: string) {
    setConfirm({ kind: "delete-lesson", lessonId });
  }

  async function handleMoveLesson(sectionId: string, lessonId: string, direction: -1 | 1) {
    const section = course.sections.find((s) => s.id === sectionId);
    if (!section) return;
    const ids = section.lessons.map((l) => l.id);
    const index = ids.indexOf(lessonId);
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= ids.length) return;
    [ids[index], ids[swapWith]] = [ids[swapWith] as string, ids[index] as string];
    const result = await reorderLessonsAction(course.id, sectionId, ids);
    if (!result.ok) return toast.error(result.error);
    router.refresh();
  }

  async function handlePublish() {
    setPublishing(true);
    const result = await publishCourseAction(course.id, changeSummary);
    setPublishing(false);
    if (!result.ok) return toast.error(result.error);
    toast.success("Course published.");
    setPublishOpen(false);
    setChangeSummary("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONE[course.status] ?? "neutral"}>{course.status}</Badge>
            <span className="text-[0.8125rem] text-[var(--text-muted)]">
              {course.sections.reduce((n, s) => n + s.lessons.length, 0)} lessons across {course.sections.length} sections
            </span>
          </div>
          {publishOpen ? (
            <div className="flex flex-1 items-center gap-2 sm:flex-none">
              <Input
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
                placeholder="What changed in this version?"
                className="w-64"
              />
              <Button size="sm" onClick={handlePublish} loading={publishing}>
                Confirm publish
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPublishOpen(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button onClick={() => setPublishOpen(true)}>
              <Icon name="approval" className="h-4 w-4" />
              Publish
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Course details</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={async (formData: FormData) => {
              setSavingMeta(true);
              const result = await updateCourseMetaAction(course.id, formData);
              setSavingMeta(false);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success("Saved.");
              router.refresh();
            }}
            className="flex flex-col gap-4"
          >
            <Field label="Title" htmlFor="title" required>
              <Input id="title" name="title" defaultValue={course.title} required maxLength={200} />
            </Field>
            <Field label="Description" htmlFor="description">
              <Textarea id="description" name="description" defaultValue={course.description ?? ""} rows={3} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Category" htmlFor="category">
                <Input id="category" name="category" defaultValue={course.category ?? ""} />
              </Field>
              <Field label="Department" htmlFor="departmentId">
                <Select id="departmentId" name="departmentId" defaultValue={course.departmentId ?? ""}>
                  <option value="">None</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Difficulty" htmlFor="difficulty">
                <Select id="difficulty" name="difficulty" defaultValue={course.difficulty}>
                  {Object.values(Difficulty).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Est. minutes" htmlFor="estimatedMinutes">
                <Input id="estimatedMinutes" name="estimatedMinutes" type="number" min={0} defaultValue={course.estimatedMinutes ?? ""} />
              </Field>
              <Field label="Passing score %" htmlFor="passingScore">
                <Input id="passingScore" name="passingScore" type="number" min={0} max={100} defaultValue={course.passingScore ?? ""} />
              </Field>
              <Field label="Attempt limit" htmlFor="attemptLimit" hint="Blank = unlimited">
                <Input id="attemptLimit" name="attemptLimit" type="number" min={1} defaultValue={course.attemptLimit ?? ""} />
              </Field>
              <Field label="Recertify (months)" htmlFor="recertifyMonths" hint="Blank = never expires">
                <Input id="recertifyMonths" name="recertifyMonths" type="number" min={1} defaultValue={course.recertifyMonths ?? ""} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Required video watch %" htmlFor="requiredVideoPercent">
                <Input
                  id="requiredVideoPercent"
                  name="requiredVideoPercent"
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={course.requiredVideoPercent}
                />
              </Field>
              <label className="mt-6 flex items-center gap-2 text-[0.875rem] text-[var(--text-primary)]">
                <input type="checkbox" name="selfEnrollAllowed" defaultChecked={course.selfEnrollAllowed} className="h-4 w-4 accent-[var(--brand-primary)]" />
                Allow self-enrollment from the catalog
              </label>
            </div>
            <div>
              <Button type="submit" loading={savingMeta}>
                Save details
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">Sections & lessons</h2>
            {/* "Section" alone names a noun, not the action it performs. */}
            <Button size="sm" variant="outline" onClick={handleAddSection}>
              <Glyph name="plus" className="h-4 w-4" />
              Add section
            </Button>
          </div>

          {course.sections.length === 0 ? (
            <EmptyState
              icon={<Icon name="content" className="h-5 w-5" />}
              title="No sections yet"
              description="Add a section to start building this course."
            />
          ) : (
            course.sections.map((section, sIndex) => (
              <Card key={section.id}>
                <CardHeader className="flex-row items-center justify-between gap-2 py-3">
                  <button
                    type="button"
                    onClick={() => handleRenameSection(section.id, section.title)}
                    className="min-w-0 truncate text-left text-[0.8125rem] font-semibold text-[var(--text-primary)] hover:underline"
                  >
                    {section.title}
                  </button>
                  <div className="flex shrink-0 gap-1">
                    <IconButton label="Move up" onClick={() => handleMoveSection(section.id, -1)} disabled={sIndex === 0}>
                      <Glyph name="chevron-down" className="h-3.5 w-3.5 rotate-180" />
                    </IconButton>
                    <IconButton label="Move down" onClick={() => handleMoveSection(section.id, 1)} disabled={sIndex === course.sections.length - 1}>
                      <Glyph name="chevron-down" className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton label="Delete section" onClick={() => handleDeleteSection(section.id)}>
                      <Glyph name="trash" className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 !py-2">
                  {section.lessons.map((lesson, lIndex) => (
                    <div
                      key={lesson.id}
                      className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 ${
                        lesson.id === selectedLessonId ? "bg-[var(--surface-sunken)]" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedLessonId(lesson.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span className="truncate text-[0.8125rem] text-[var(--text-primary)]">{lesson.title}</span>
                        <span className="shrink-0 text-[0.6875rem] text-[var(--text-muted)]">
                          {LESSON_TYPE_LABEL[lesson.type] ?? lesson.type}
                        </span>
                      </button>
                      <div className="flex shrink-0 gap-0.5">
                        <IconButton label="Move up" onClick={() => handleMoveLesson(section.id, lesson.id, -1)} disabled={lIndex === 0}>
                          <Glyph name="chevron-down" className="h-3 w-3 rotate-180" />
                        </IconButton>
                        <IconButton label="Move down" onClick={() => handleMoveLesson(section.id, lesson.id, 1)} disabled={lIndex === section.lessons.length - 1}>
                          <Glyph name="chevron-down" className="h-3 w-3" />
                        </IconButton>
                        <IconButton label="Delete lesson" onClick={() => handleDeleteLesson(lesson.id)}>
                          <Glyph name="trash" className="h-3 w-3" />
                        </IconButton>
                      </div>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 justify-start"
                    onClick={() => handleAddLesson(section.id)}
                  >
                    <Glyph name="plus" className="h-3.5 w-3.5" />
                    Add lesson
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <div>
          {selectedLesson ? (
            <LessonEditor key={selectedLesson.id} courseId={course.id} lesson={selectedLesson} onSaved={() => router.refresh()} />
          ) : (
            <EmptyState
              icon={<Icon name="content" className="h-5 w-5" />}
              title="Select a lesson"
              description="Choose a lesson from the list, or add one to a section, to edit its content."
            />
          )}
        </div>
      </div>

      <PromptDialog
        open={prompt !== null}
        onOpenChange={(open) => !open && setPrompt(null)}
        title={
          prompt?.kind === "rename-section"
            ? "Rename section"
            : prompt?.kind === "add-lesson"
              ? "Add a lesson"
              : "Add a section"
        }
        label={prompt?.kind === "add-lesson" ? "Lesson title" : "Section title"}
        description={
          prompt?.kind === "add-lesson"
            ? "It starts as a rich text lesson. You can change the type once it exists."
            : undefined
        }
        initialValue={prompt?.kind === "rename-section" ? prompt.current : ""}
        placeholder={prompt?.kind === "add-lesson" ? "e.g. Isolating the line" : "e.g. Before you start"}
        confirmLabel={prompt?.kind === "rename-section" ? "Rename" : "Add"}
        loading={dialogBusy}
        onConfirm={submitPrompt}
      />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm?.kind === "delete-section" ? "Delete this section?" : "Delete this lesson?"}
        description={
          confirm?.kind === "delete-section"
            ? "Every lesson inside it is deleted too. Published versions of this course keep their own copy, so learner records are unaffected."
            : "Published versions of this course keep their own copy, so learner records are unaffected."
        }
        confirmLabel={confirm?.kind === "delete-section" ? "Delete section" : "Delete lesson"}
        danger
        loading={dialogBusy}
        onConfirm={submitConfirm}
      />
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] disabled:opacity-30"
    >
      {children}
    </button>
  );
}

