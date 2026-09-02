"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Button, Card, Select } from "@/components/ui";

interface Assigned {
  id: string;
  reference: string;
  title: string;
  status: string;
  dueAt: string;
  submittedAt: string | null;
  gradesFiled: number;
  gradesRequired: number;
}

const TONE = {
  ASSIGNED: "neutral",
  STARTED: "blue",
  SUBMITTED: "amber",
  GRADED: "green",
  EXPIRED: "neutral",
  WITHDRAWN: "neutral",
} as const;

export function WorkSamplePanel({
  applicationId,
  canManage,
  available,
  assigned,
}: {
  applicationId: string;
  canManage: boolean;
  available: { id: string; title: string }[];
  assigned: Assigned[];
}) {
  const router = useRouter();
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  if (!canManage && assigned.length === 0) return null;

  return (
    <Card className="p-5">
      <h3 className="text-sm font-bold text-navy-900">Work samples</h3>

      {assigned.length > 0 && (
        <ul className="mt-3 space-y-3">
          {assigned.map((a) => (
            <li key={a.id} className="rounded-lg border border-navy-100 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-navy-900">{a.title}</p>
                  <p className="font-mono text-xs text-navy-500">{a.reference}</p>
                </div>
                <Badge tone={TONE[a.status as keyof typeof TONE] ?? "neutral"}>
                  {a.status.toLowerCase()}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-navy-500">
                {a.submittedAt
                  ? `Submitted ${a.submittedAt.slice(0, 10)} · ${a.gradesFiled} of ${a.gradesRequired} grades filed`
                  : `Must start by ${a.dueAt.slice(0, 10)}`}
              </p>
              {a.submittedAt && (
                <Link
                  href={`/admin/work-samples/grade/${a.id}`}
                  className="mt-2 inline-block text-xs font-semibold text-fsw-700 hover:underline"
                >
                  Open for grading
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="mt-4 border-t border-navy-100 pt-4">
          {available.length === 0 ? (
            <p className="text-sm text-navy-500">
              No active work samples for this role.
            </p>
          ) : (
            <>
              <Select value={choice} onChange={(e) => setChoice(e.target.value)}>
                <option value="">Send a work sample…</option>
                {available.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title}
                  </option>
                ))}
              </Select>
              <Button
                className="mt-3 w-full"
                variant="secondary"
                disabled={busy || choice === ""}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  setLink(null);
                  try {
                    const out = await api<{ url: string }>(
                      `/api/admin/work-samples/${choice}/assign`,
                      { method: "POST", body: { applicationId } },
                    );
                    setLink(out.url);
                    setChoice("");
                    router.refresh();
                  } catch (err) {
                    setError(
                      err instanceof ApiError ? err.message : "Could not send it.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Sending…" : "Send"}
              </Button>
            </>
          )}

          {link && (
            <div className="mt-3 rounded-lg bg-emerald-50 p-3">
              <p className="text-xs font-semibold text-emerald-900">
                Send this link to the candidate. It is shown once — the token is
                stored only as a hash, so a lost link is reissued rather than
                looked up.
              </p>
              <input
                readOnly
                className="mt-2 w-full rounded border border-emerald-200 bg-white px-2 py-1 font-mono text-xs text-navy-800"
                value={link}
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
          )}
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        </div>
      )}
    </Card>
  );
}
