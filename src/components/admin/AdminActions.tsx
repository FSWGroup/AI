"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card, Input, Label, Select, Textarea } from "@/components/ui";

export function AdminActions({
  attemptId,
  status,
  notes,
}: {
  attemptId: string;
  status: string;
  notes: { id: string; body: string; author: string; createdAt: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [invalidateReason, setInvalidateReason] = useState("");
  const [note, setNote] = useState("");
  const [accType, setAccType] = useState("EXTENDED_TIME");
  const [multiplier, setMultiplier] = useState(1.5);
  const [accNote, setAccNote] = useState("");

  async function act(body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ launchUrl?: string; resumeUrl?: string }>(
        `/api/admin/attempts/${attemptId}`,
        { body },
      );
      setMessage(
        res.launchUrl
          ? `Done. Retest launch link (share only with the candidate): ${res.launchUrl}`
          : res.resumeUrl
            ? `Resume link (share only with the candidate; previous links are now invalid): ${res.resumeUrl}`
            : "Done. The action was recorded in the audit log.",
      );
      router.refresh();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {message && (
        <p role="status" className="break-all rounded-lg bg-fsw-50 p-3 text-sm text-fsw-900">
          {message}
        </p>
      )}

      <Card className="p-6">
        <h3 className="text-sm font-bold text-navy-900">Resume link</h3>
        <p className="mt-1 text-xs text-navy-500">
          If the candidate lost their session, issue a fresh secure resume
          link to send them. It restores their exact session (same questions,
          answers, and remaining time) and invalidates any earlier link.
        </p>
        <Button
          className="mt-3"
          variant="secondary"
          disabled={busy || !["NOT_STARTED", "IN_PROGRESS", "INTERRUPTED"].includes(status)}
          onClick={() => void act({ action: "resume_link" })}
        >
          Issue resume link
        </Button>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-bold text-navy-900">Retest</h3>
        <p className="mt-1 text-xs text-navy-500">
          Issues a fresh invitation; this attempt is preserved unchanged and
          reports always identify which attempt they represent.
        </p>
        <Button
          className="mt-3"
          variant="secondary"
          disabled={busy}
          onClick={() => void act({ action: "authorize_retest" })}
        >
          Authorize retest
        </Button>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-bold text-navy-900">Accommodation override</h3>
        <p className="mt-1 text-xs text-navy-500">
          Applies to this attempt only. Never ask the candidate to disclose a
          diagnosis.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="accType">Type</Label>
            <Select id="accType" value={accType} onChange={(e) => setAccType(e.target.value)}>
              <option value="EXTENDED_TIME">Extended time</option>
              <option value="CAMERA_EXEMPT">Camera exemption</option>
              <option value="UNTIMED">Untimed sections</option>
              <option value="ALTERNATE_PRESENTATION">Alternate presentation</option>
              <option value="IN_PERSON_ADMINISTRATION">In-person administration</option>
            </Select>
          </div>
          {accType === "EXTENDED_TIME" && (
            <div>
              <Label htmlFor="mult">Time multiplier</Label>
              <Input
                id="mult"
                type="number"
                step={0.25}
                min={1}
                max={3}
                value={multiplier}
                onChange={(e) => setMultiplier(Number(e.target.value))}
              />
            </div>
          )}
          <div className={accType === "EXTENDED_TIME" ? "" : "sm:col-span-2"}>
            <Label htmlFor="accNote">Note (optional)</Label>
            <Input id="accNote" value={accNote} onChange={(e) => setAccNote(e.target.value)} />
          </div>
        </div>
        <Button
          className="mt-3"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void act({
              action: "accommodation",
              type: accType,
              timeMultiplier: accType === "EXTENDED_TIME" ? multiplier : undefined,
              note: accNote || undefined,
            })
          }
        >
          Grant accommodation
        </Button>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-bold text-navy-900">Recalculate scores</h3>
        <p className="mt-1 text-xs text-navy-500">
          Re-runs scoring with the current model and generates a NEW report
          version. Historical reports are never silently changed.
        </p>
        <Button
          className="mt-3"
          variant="secondary"
          disabled={busy || status !== "COMPLETED"}
          onClick={() => void act({ action: "recalculate" })}
        >
          Recalculate
        </Button>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-bold text-navy-900">Invalidate attempt</h3>
        <div className="mt-3">
          <Label htmlFor="reason">Reason (required, audited)</Label>
          <Input
            id="reason"
            value={invalidateReason}
            onChange={(e) => setInvalidateReason(e.target.value)}
            placeholder="e.g. technical failure confirmed with candidate"
          />
        </div>
        <Button
          className="mt-3"
          variant="danger"
          disabled={busy || invalidateReason.trim().length < 3 || status === "INVALIDATED"}
          onClick={() => void act({ action: "invalidate", reason: invalidateReason })}
        >
          Invalidate
        </Button>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-bold text-navy-900">Notes</h3>
        <div className="mt-3 space-y-3">
          {notes.map((n) => (
            <div key={n.id} className="rounded-lg bg-navy-50 p-3 text-sm">
              <p className="whitespace-pre-wrap text-navy-800">{n.body}</p>
              <p className="mt-1 text-xs text-navy-400">
                {n.author} · {new Date(n.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
          {notes.length === 0 && <p className="text-sm text-navy-400">No notes.</p>}
        </div>
        <Textarea
          className="mt-3"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note (audited)…"
        />
        <Button
          className="mt-2"
          variant="secondary"
          disabled={busy || note.trim().length === 0}
          onClick={() => {
            void act({ action: "add_note", body: note }).then(() => setNote(""));
          }}
        >
          Add note
        </Button>
      </Card>
    </div>
  );
}
