"use client";

import * as React from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Glyph } from "@/components/icons";
import { selfEnrollAction } from "@/app/(app)/courses/[id]/actions";

export function SelfEnrollButton({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);

  return (
    <Button
      loading={loading}
      onClick={async () => {
        setLoading(true);
        const result = await selfEnrollAction(courseId);
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
