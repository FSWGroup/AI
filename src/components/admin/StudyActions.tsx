"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
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
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      {canManage && (
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api(`/api/admin/validation/studies/${studyId}/run`, { method: "POST" });
              router.refresh();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Could not run the study.");
            } finally {
              setBusy(false);
            }
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
