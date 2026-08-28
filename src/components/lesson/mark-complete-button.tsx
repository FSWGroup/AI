"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Glyph } from "@/components/icons";
import { postProgress } from "@/components/lesson/progress-client";

export function MarkCompleteButton({
  lessonId,
  alreadyComplete,
  onComplete,
  label = "Mark complete",
}: {
  lessonId: string;
  alreadyComplete: boolean;
  onComplete: () => void;
  label?: string;
}) {
  const [loading, setLoading] = React.useState(false);

  if (alreadyComplete) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-success-700">
        <Glyph name="check" className="h-4 w-4" />
        Completed
      </span>
    );
  }

  return (
    <Button
      loading={loading}
      onClick={async () => {
        setLoading(true);
        try {
          await postProgress(lessonId, { markComplete: true });
          toast.success("Lesson marked complete.");
          onComplete();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Couldn't update your progress.");
        } finally {
          setLoading(false);
        }
      }}
    >
      <Glyph name="check" className="h-4 w-4" />
      {label}
    </Button>
  );
}
