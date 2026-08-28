"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteAnnouncementAction } from "@/app/(app)/admin/announcements/actions";

export function DeleteAnnouncementButton({ id }: { id: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  const onDelete = async () => {
    setDeleting(true);
    try {
      const result = await deleteAnnouncementAction(id);
      if (result.ok) {
        toast.success("Announcement deleted.");
        router.push("/admin/announcements");
      } else {
        toast.error(result.error);
      }
    } finally {
      setDeleting(false);
    }
  };

  if (!confirming) {
    return (
      <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
        Delete
      </Button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-[0.8125rem] text-[var(--text-secondary)]">Delete permanently?</span>
      <Button variant="danger" size="sm" loading={deleting} onClick={onDelete}>
        Confirm
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </span>
  );
}
