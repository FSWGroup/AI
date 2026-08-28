"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { Glyph, Icon } from "@/components/icons";
import type { LessonPlayerProps } from "@/components/lesson/types";

interface ProjectContent {
  instructions: string;
}

export function AssignmentProjectPlayer({ lesson, progress, onComplete, submitProject }: LessonPlayerProps) {
  const content = lesson.content as ProjectContent;
  const [file, setFile] = React.useState<File | null>(null);
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const previousSubmission = (progress?.checklistState as { submission?: { note?: string } } | null)?.submission;
  const alreadyDone = progress?.status === "COMPLETED";

  async function uploadFile(toUpload: File): Promise<string | undefined> {
    const form = new FormData();
    form.append("file", toUpload);
    const response = await fetch("/api/media/upload", { method: "POST", body: form });
    if (!response.ok) throw new Error("Upload failed. Please try again.");
    const json = (await response.json().catch(() => ({}))) as { id?: string; mediaId?: string; data?: { id?: string } };
    return json.id ?? json.mediaId ?? json.data?.id;
  }

  async function submit() {
    if (!submitProject) return;
    if (!file && !note.trim()) {
      toast.error("Attach a file or add a note before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      let mediaId: string | undefined;
      if (file) {
        mediaId = await uploadFile(file);
      }
      const result = await submitProject({ mediaId, note: note.trim() || undefined });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't submit your work.");
        return;
      }
      toast.success("Submitted.");
      onComplete();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't submit your work.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-6">
        <p className="text-[0.9375rem] leading-relaxed text-[var(--text-primary)]">{content.instructions}</p>
      </div>

      {alreadyDone ? (
        <div className="flex items-center gap-2 rounded-lg border border-success-100 bg-success-50 p-4 text-success-700">
          <Icon name="approval" className="h-5 w-5" />
          <div>
            <p className="text-[0.875rem] font-semibold">Submitted</p>
            {previousSubmission?.note && <p className="text-[0.8125rem] text-success-700/90">{previousSubmission.note}</p>}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-5">
          <Field label="Attach a file" htmlFor="project-file" hint="Optional if you're adding a note instead.">
            <input
              id="project-file"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-[0.8125rem] text-[var(--text-secondary)] file:mr-3 file:rounded-md file:border file:border-[var(--border-default)] file:bg-[var(--surface-sunken)] file:px-3 file:py-1.5 file:text-[0.8125rem] file:font-medium"
            />
          </Field>
          <Field label="Notes" htmlFor="project-note" hint="Describe what you're submitting.">
            <Textarea id="project-note" value={note} onChange={(e) => setNote(e.target.value)} rows={4} />
          </Field>
          <div>
            <Button onClick={submit} loading={submitting}>
              <Glyph name="upload" className="h-4 w-4" />
              Submit
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
