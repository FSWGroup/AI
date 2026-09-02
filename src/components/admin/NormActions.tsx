"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Button } from "@/components/ui";
import { MIN_N_NORM_ACTIVE } from "@/lib/validation/gates";

export function GenerateNormsButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          try {
            const out = await api<{ created: number; skipped: unknown[] }>(
              "/api/admin/validation/norms",
              { method: "POST", body: { population: "APPLICANTS" } },
            );
            setMessage(
              `${out.created} draft table${out.created === 1 ? "" : "s"} created. ${out.skipped.length} dimension${out.skipped.length === 1 ? "" : "s"} did not have enough data.`,
            );
            router.refresh();
          } catch (err) {
            setMessage(err instanceof ApiError ? err.message : "Could not generate tables.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Generating…" : "Generate draft tables"}
      </Button>
      <span className="text-sm text-navy-500">
        Drafts only. Nothing bands anyone until you activate it.
      </span>
      {message && <span className="text-sm text-navy-700">{message}</span>}
    </div>
  );
}

export function NormActions({
  normTableId,
  status,
  sampleSize,
}: {
  normTableId: string;
  status: string;
  sampleSize: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const act = async (action: "activate" | "retire") => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/validation/norms/${normTableId}`, {
        method: "POST",
        body: { action },
      });
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the table.");
    } finally {
      setBusy(false);
    }
  };

  if (status === "RETIRED") return null;

  if (status === "ACTIVE") {
    return (
      <div>
        <button
          type="button"
          disabled={busy}
          onClick={() => act("retire")}
          className="text-xs font-semibold text-navy-600 hover:underline"
        >
          Retire
        </button>
        {error && <span className="block text-xs text-red-700">{error}</span>}
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
        <p className="text-xs text-amber-900">
          Activating this table changes what this dimension&apos;s band means on
          every report generated from now on. Anyone holding an older report
          will see a different number for the same person. Reports already
          issued are not rewritten.
        </p>
        {sampleSize < MIN_N_NORM_ACTIVE && (
          <p className="mt-1 text-xs font-semibold text-amber-900">
            This table was built from {sampleSize} cases and will be refused.
          </p>
        )}
        <div className="mt-2 flex gap-2">
          <Button className="px-3 py-1 text-xs" disabled={busy} onClick={() => act("activate")}>
            {busy ? "Activating…" : "Activate"}
          </Button>
          <Button
            variant="ghost"
            className="px-3 py-1 text-xs"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </div>
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="text-xs font-semibold text-fsw-700 hover:underline"
    >
      Activate
    </button>
  );
}
