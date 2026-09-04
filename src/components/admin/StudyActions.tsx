"use client";

import { api } from "@/lib/client/api";
import { useAction } from "@/lib/client/use-action";
import { Button } from "@/components/ui";

export function StudyActions({
  studyId,
  canManage,
  computed,
}: {
  studyId: string;
  canManage: boolean;
  computed: boolean;
}) {
  const { busy, error, run } = useAction();

  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      {canManage && (
        <Button
          disabled={busy}
          onClick={async () => {
            await run(async () => {
              await api(`/api/admin/validation/studies/${studyId}/run`, { method: "POST" });
            }, { fallback: "Could not run the study." });
          }}
        >
          {busy ? "Computing…" : computed ? "Recompute" : "Run study"}
        </Button>
      )}
      {computed && (
        <a
          href={`/api/admin/validation/studies/${studyId}/report`}
          className="rounded-lg border border-navy-200 px-4 py-2.5 text-sm font-semibold text-navy-800 hover:bg-navy-50"
        >
          Technical report (PDF)
        </a>
      )}
      {error && <span className="text-sm text-red-700">{error}</span>}
    </div>
  );
}
