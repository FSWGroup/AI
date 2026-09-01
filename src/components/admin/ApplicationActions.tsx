"use client";

/**
 * Moving, rejecting, reopening and annotating an application.
 *
 * Rejection asks for a reason every time. That is partly reporting — you
 * cannot improve a funnel you cannot explain — and partly the discipline of
 * making someone name the ground for a decision that affects a real person.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card, Select, Textarea } from "@/components/ui";

export function ApplicationActions({
  applicationId,
  status,
  currentStageId,
  stages,
  reasons,
  canManage,
}: {
  applicationId: string;
  status: string;
  currentStageId: string | null;
  stages: { id: string; name: string; kind: string }[];
  reasons: { id: string; label: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [newNote, setNewNote] = useState("");

  async function post(body: Record<string, unknown>, ok: string): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ effects?: string[] }>(
        `/api/admin/applications/${applicationId}`,
        { body },
      );
      const extra = res.effects?.includes("ISSUE_ASSESSMENT")
        ? " Send them the assessment from the Assessments area."
        : "";
      setMessage(ok + extra);
      setRejecting(false);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) {
    return (
      <Card className="p-6">
        <h2 className="text-sm font-bold text-navy-900">Actions</h2>
        <p className="mt-2 text-sm text-navy-500">
          You have read-only access to this pipeline.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h2 className="text-sm font-bold text-navy-900">Actions</h2>
      {message && (
        <p role="status" className="mt-3 rounded-lg bg-fsw-50 p-2.5 text-sm text-fsw-900">
          {message}
        </p>
      )}

      {status === "ACTIVE" && (
        <div className="mt-4 space-y-3">
          <div>
            <label
              htmlFor="move-stage"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-navy-500"
            >
              Move to stage
            </label>
            <Select
              id="move-stage"
              disabled={busy}
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  void post(
                    { action: "move_stage", stageId: e.target.value },
                    "Moved.",
                  );
                }
              }}
            >
              <option value="">Choose a stage…</option>
              {stages
                .filter((s) => s.id !== currentStageId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </div>

          {!rejecting ? (
            <Button variant="ghost" disabled={busy} onClick={() => setRejecting(true)}>
              Reject
            </Button>
          ) : (
            <div className="rounded-xl border border-navy-100 p-3">
              <label
                htmlFor="reject-reason"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-navy-500"
              >
                Reason
              </label>
              <Select
                id="reject-reason"
                value={reasonId}
                onChange={(e) => setReasonId(e.target.value)}
              >
                <option value="">Choose a reason…</option>
                {reasons.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
              <Textarea
                className="mt-2 text-sm"
                rows={3}
                placeholder="Optional note for the record"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label="Rejection note"
              />
              <div className="mt-3 flex gap-2">
                <Button
                  disabled={busy || !reasonId}
                  onClick={() =>
                    void post(
                      { action: "reject", reasonId, note: note || null },
                      "Rejected.",
                    )
                  }
                >
                  Confirm rejection
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {(status === "REJECTED" || status === "WITHDRAWN") && (
        <Button
          className="mt-4"
          disabled={busy}
          onClick={() => void post({ action: "reopen" }, "Back in the pipeline.")}
        >
          Reopen application
        </Button>
      )}

      <div className="mt-5 border-t border-navy-100 pt-4">
        <label
          htmlFor="new-note"
          className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-navy-500"
        >
          Add a note
        </label>
        <Textarea
          id="new-note"
          rows={3}
          className="text-sm"
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
        />
        <Button
          className="mt-2"
          variant="ghost"
          disabled={busy || newNote.trim() === ""}
          onClick={() =>
            void post({ action: "add_note", body: newNote }, "Note added.").then(() =>
              setNewNote(""),
            )
          }
        >
          Save note
        </Button>
      </div>
    </Card>
  );
}
