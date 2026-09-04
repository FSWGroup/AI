"use client";

import { api } from "@/lib/client/api";
import { useAction } from "@/lib/client/use-action";
import { Button, ErrorText } from "@/components/ui";

export function WorkSampleActions({
  workSampleId,
  status,
  blocked,
}: {
  workSampleId: string;
  status: string;
  blocked: string[];
}) {
  const { busy, error, run } = useAction();

  const setStatus = async (next: "ACTIVE" | "RETIRED" | "DRAFT") => {
    await run(async () => {
      await api(`/api/admin/work-samples/${workSampleId}`, {
        method: "PATCH",
        body: { status: next },
      });
    }, { fallback: "Could not update." });
  };

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-3">
        {status !== "ACTIVE" && (
          <Button disabled={busy || blocked.length > 0} onClick={() => setStatus("ACTIVE")}>
            {busy ? "Working…" : "Activate"}
          </Button>
        )}
        {status === "ACTIVE" && (
          <Button variant="secondary" disabled={busy} onClick={() => setStatus("RETIRED")}>
            Retire
          </Button>
        )}
        {status === "RETIRED" && (
          <Button variant="secondary" disabled={busy} onClick={() => setStatus("DRAFT")}>
            Back to draft
          </Button>
        )}
        {status !== "ACTIVE" && blocked.length === 0 && (
          <span className="text-sm text-navy-500">
            Activating lets this be sent to candidates.
          </span>
        )}
      </div>

      {blocked.length > 0 && status !== "ACTIVE" && (
        <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">
            This cannot go out until the rubric is finished:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {blocked.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <ErrorText className="mt-2">{error}</ErrorText>}
    </div>
  );
}
