"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Glyph } from "@/components/icons";
import { archiveCourseAction, deleteCourseAction, duplicateCourseAction } from "@/app/(app)/admin/training/actions";

export function CourseRowActions({
  courseId,
  status,
  canArchive,
}: {
  courseId: string;
  status: string;
  canArchive: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<"archive" | "duplicate" | "delete" | null>(null);
  // The application's own dialog, never window.confirm — see components/ui/dialog.
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  async function run(kind: "archive" | "duplicate" | "delete") {
    setBusy(kind);
    try {
      if (kind === "duplicate") {
        const result = await duplicateCourseAction(courseId);
        if (!result.ok) return toast.error(result.error);
        toast.success("Course duplicated.");
        router.push(`/admin/training/${result.data.id}/edit`);
        return;
      }
      if (kind === "archive") {
        const result = await archiveCourseAction(courseId);
        if (!result.ok) return toast.error(result.error);
        toast.success("Course archived.");
        router.refresh();
        return;
      }
      if (kind === "delete") {
        const result = await deleteCourseAction(courseId);
        if (!result.ok) return toast.error(result.error);
        toast.success("Course deleted.");
        setConfirmDelete(false);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="sm" loading={busy === "duplicate"} onClick={() => run("duplicate")} aria-label="Duplicate course">
        <Glyph name="copy" className="h-4 w-4" />
      </Button>
      {canArchive && status !== "ARCHIVED" && (
        <Button variant="ghost" size="sm" loading={busy === "archive"} onClick={() => run("archive")} aria-label="Archive course">
          <Glyph name="lock" className="h-4 w-4" />
        </Button>
      )}
      {canArchive && (
        <Button variant="ghost" size="sm" loading={busy === "delete"} onClick={() => setConfirmDelete(true)} aria-label="Delete course">
          <Glyph name="trash" className="h-4 w-4" />
        </Button>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this course permanently?"
        description="This only succeeds if nobody has completion history against it. If they do, archive it instead — records have to stay referenceable."
        confirmLabel="Delete course"
        danger
        loading={busy === "delete"}
        onConfirm={() => run("delete")}
      />
    </div>
  );
}
