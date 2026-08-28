"use client";

import * as React from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Glyph } from "@/components/icons";
import type { ActionResult } from "@/lib/action-result";

/**
 * Self-enrolment control.
 *
 * The action arrives as a prop rather than an import, so this component carries
 * no dependency on where the action is defined and stays usable from any page
 * that can supply one. The server components that render it pass
 * `selfEnrollAction` from `@/lib/actions/course-enrollment`.
 */
export function SelfEnrollButton({
  courseId,
  courseTitle,
  action,
}: {
  courseId: string;
  /** Named in the accessible label so a list of enroll buttons stays unambiguous. */
  courseTitle?: string;
  action: (courseId: string) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);

  return (
    <Button
      loading={loading}
      aria-label={courseTitle ? `Enroll myself in ${courseTitle}` : undefined}
      onClick={async () => {
        setLoading(true);
        const result = await action(courseId);
        setLoading(false);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success("You're enrolled.");
        router.refresh();
      }}
    >
      <Glyph name="plus" className="h-4 w-4" />
      Enroll myself
    </Button>
  );
}
