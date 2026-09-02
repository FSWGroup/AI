"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Textarea } from "@/components/ui";

/**
 * The candidate's work-sample screen.
 *
 * The countdown here is display only. The deadline lives on the server, set
 * when the candidate starts, and every save and the submission are checked
 * against it — so a refresh, a closed laptop, or a changed system clock
 * never adds or removes time.
 */
export function WorkSampleRunner({
  token,
  firstName,
  summary,
  successCriteria,
  instructions,
  submissionKind,
  allowedFileTypes,
  timeLimitMinutes,
  dueAt,
  started,
  initialRemaining,
  draftText,
}: {
  token: string;
  firstName: string;
  summary: string | null;
  successCriteria: string | null;
  instructions: string | null;
  submissionKind: "TEXT" | "FILE" | "TEXT_AND_FILE";
  allowedFileTypes: string[];
  timeLimitMinutes: number | null;
  dueAt: string;
  started: boolean;
  initialRemaining: number | null;
  draftText: string;
}) {
  const [isStarted, setIsStarted] = useState(started);
  const [task, setTask] = useState(instructions);
  const [text, setText] = useState(draftText);
  const [remaining, setRemaining] = useState<number | null>(initialRemaining);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const lastSaved = useRef(draftText);

  const wantsText = submissionKind !== "FILE";
  const wantsFile = submissionKind !== "TEXT";

  // Display countdown. The server is the authority; this just ticks down, and
  // every autosave re-syncs it, so a paused or drifting browser clock cannot
  // quietly hand out extra minutes.
  const timed = remaining !== null;
  useEffect(() => {
    if (!timed || !isStarted) return;
    const id = setInterval(() => {
      setRemaining((r) => (r === null ? null : Math.max(0, r - 1)));
    }, 1000);
    return () => clearInterval(id);
  }, [timed, isStarted]);

  const save = useCallback(async () => {
    if (!isStarted || text === lastSaved.current) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/work-sample/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", text }),
      });
      if (res.ok) {
        const data = (await res.json()) as { remainingSeconds: number | null };
        lastSaved.current = text;
        setSavedAt(new Date());
        // Re-sync from the server on every save, so a drifting or paused
        // browser clock cannot quietly hand out extra minutes.
        if (data.remainingSeconds !== null) setRemaining(data.remainingSeconds);
      }
    } finally {
      setSaving(false);
    }
  }, [isStarted, text, token]);

  useEffect(() => {
    if (!isStarted) return;
    const id = setInterval(save, 15_000);
    return () => clearInterval(id);
  }, [isStarted, save]);

  if (done) {
    return (
      <Card className="mt-8 p-6">
        <h2 className="text-lg font-semibold text-navy-900">
          Submitted — thank you
        </h2>
        <p className="mt-2 leading-relaxed text-navy-600">
          Your work has been received. It will be reviewed against a written
          rubric by more than one person, and the reviewers will not see your
          name while they do it.
        </p>
      </Card>
    );
  }

  if (!isStarted) {
    return (
      <Card className="mt-8 p-6">
        <h2 className="text-lg font-semibold text-navy-900">
          Before you start, {firstName}
        </h2>
        {summary && <p className="mt-3 leading-relaxed text-navy-700">{summary}</p>}
        <ul className="mt-4 space-y-2 text-sm text-navy-600">
          <li>
            {timeLimitMinutes
              ? `Once you begin you will have ${timeLimitMinutes} minutes. The clock runs on our server, so closing this page does not stop it.`
              : "There is no time limit on this task. Take the time it needs."}
          </li>
          <li>
            Your work saves automatically as you type, so a dropped connection
            will not lose it.
          </li>
          {wantsFile && (
            <li>
              You will be asked to upload a file
              {allowedFileTypes.length > 0
                ? ` (${allowedFileTypes.join(", ")})`
                : ""}
              . Have it ready before you begin if you can.
            </li>
          )}
          <li>
            The task is available until{" "}
            {new Date(dueAt).toLocaleString("en-US", {
              dateStyle: "long",
              timeStyle: "short",
            })}
            .
          </li>
        </ul>
        {successCriteria && (
          <div className="mt-5 rounded-lg bg-navy-50 p-4">
            <p className="text-sm font-semibold text-navy-900">
              What we are looking for
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-navy-700">
              {successCriteria}
            </p>
          </div>
        )}
        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
        <Button
          className="mt-6"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await fetch(`/api/work-sample/${token}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "start" }),
              });
              const data = (await res.json()) as {
                error?: string;
                instructions?: string;
                remainingSeconds?: number | null;
              };
              if (!res.ok) {
                setError(data.error ?? "Could not start the task.");
                return;
              }
              setTask(data.instructions ?? null);
              setRemaining(data.remainingSeconds ?? null);
              setIsStarted(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Starting…" : timeLimitMinutes ? "Start the clock" : "Begin"}
        </Button>
      </Card>
    );
  }

  const outOfTime = remaining !== null && remaining <= 0;

  return (
    <div className="mt-8">
      {remaining !== null && (
        <div
          className={
            remaining <= 300
              ? "sticky top-0 z-10 rounded-lg bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-900"
              : "sticky top-0 z-10 rounded-lg bg-navy-100 px-4 py-2 text-sm font-semibold text-navy-800"
          }
        >
          {outOfTime
            ? "Time is up. Submit what you have."
            : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} remaining`}
        </div>
      )}

      {task && (
        <Card className="mt-4 p-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-navy-500">
            The task
          </h2>
          <p className="mt-2 whitespace-pre-wrap leading-relaxed text-navy-800">
            {task}
          </p>
          {successCriteria && (
            <div className="mt-5 rounded-lg bg-navy-50 p-4">
              <p className="text-sm font-semibold text-navy-900">
                What we are looking for
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-navy-700">
                {successCriteria}
              </p>
            </div>
          )}
        </Card>
      )}

      {wantsText && (
        <Card className="mt-4 p-6">
          <label
            htmlFor="wsResponse"
            className="text-sm font-bold uppercase tracking-wide text-navy-500"
          >
            Your response
          </label>
          <Textarea
            id="wsResponse"
            rows={16}
            className="mt-2 font-mono text-sm"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={save}
          />
          <p className="mt-2 text-xs text-navy-500">
            {saving
              ? "Saving…"
              : savedAt
                ? `Saved at ${savedAt.toLocaleTimeString()}`
                : "Saves automatically as you work."}
          </p>
        </Card>
      )}

      {wantsFile && (
        <Card className="mt-4 p-6">
          <label
            htmlFor="wsFile"
            className="text-sm font-bold uppercase tracking-wide text-navy-500"
          >
            Your file
          </label>
          <input
            id="wsFile"
            type="file"
            className="mt-2 block w-full text-sm text-navy-700"
            accept={allowedFileTypes.map((t) => `.${t}`).join(",")}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {allowedFileTypes.length > 0 && (
            <p className="mt-2 text-xs text-navy-500">
              Accepted: {allowedFileTypes.join(", ")}
            </p>
          )}
        </Card>
      )}

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const form = new FormData();
              if (wantsText) form.set("text", text);
              if (file) form.set("file", file);
              const res = await fetch(`/api/work-sample/${token}`, {
                method: "POST",
                body: form,
              });
              const data = (await res.json()) as { error?: string };
              if (!res.ok) {
                setError(data.error ?? "Could not submit.");
                return;
              }
              setDone(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Submitting…" : "Submit my work"}
        </Button>
        {wantsText && (
          <Button variant="secondary" disabled={saving} onClick={save}>
            Save draft
          </Button>
        )}
        <span className="text-sm text-navy-500">
          You can submit once. Check it over first.
        </span>
      </div>
    </div>
  );
}
