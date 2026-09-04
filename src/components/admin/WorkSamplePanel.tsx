"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { useAction } from "@/lib/client/use-action";
import { Badge, Button, Card, ErrorText, Select } from "@/components/ui";
import { OneTimeLink } from "./OneTimeLink";

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
  const { busy, error, run } = useAction();
  const [choice, setChoice] = useState("");
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
                  setLink(null);
                  await run(async () => {
                    const out = await api<{ url: string }>(
                      `/api/admin/work-samples/${choice}/assign`,
                      { method: "POST", body: { applicationId } },
                    );
                    setLink(out.url);
                    setChoice("");
                  }, { fallback: "Could not send it." });
                }}
              >
                {busy ? "Sending…" : "Send"}
              </Button>
            </>
          )}

          {link && <OneTimeLink url={link} />}
          {error && <ErrorText className="mt-2">{error}</ErrorText>}
        </div>
      )}
    </Card>
  );
}
