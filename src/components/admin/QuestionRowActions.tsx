"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Button } from "@/components/ui";

const NEXT_ACTIONS: Record<string, { status: string; label: string }[]> = {
  DRAFT: [{ status: "REVIEW", label: "Submit for review" }],
  REVIEW: [
    { status: "APPROVED", label: "Approve" },
    { status: "DRAFT", label: "Back to draft" },
  ],
  APPROVED: [{ status: "RETIRED", label: "Retire" }],
  RETIRED: [],
};

export function QuestionRowActions({
  questionId,
  status,
}: {
  questionId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex shrink-0 gap-2">
      {(NEXT_ACTIONS[status] ?? []).map((a) => (
        <Button
          key={a.status}
          variant={a.status === "APPROVED" ? "primary" : "secondary"}
          className="px-3 py-1.5 text-xs"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void api(`/api/admin/questions/${questionId}`, {
              method: "PATCH",
              body: { action: "set_status", status: a.status },
            })
              .then(() => router.refresh())
              .catch((err) =>
                alert(err instanceof ApiError ? err.message : "Failed."),
              )
              .finally(() => setBusy(false));
          }}
        >
          {a.label}
        </Button>
      ))}
    </div>
  );
}
