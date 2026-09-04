"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Button, Card, Input, Label, Select } from "@/components/ui";

/**
 * Send a candidate a link to pick their own time.
 *
 * Replaces the several-day email exchange that otherwise books one interview
 * — days in which a candidate is also talking to someone else.
 */
export function SelfSchedulePanel({
  applicationId,
  teamUsers,
  kits,
  stages,
  existing,
}: {
  applicationId: string;
  teamUsers: { id: string; name: string }[];
  kits: { id: string; name: string }[];
  stages: { id: string; name: string; kind: string }[];
  existing: {
    id: string;
    reference: string;
    title: string;
    status: string;
    scheduledAt: string | null;
    interviewId: string | null;
  }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("Interview");
  const [duration, setDuration] = useState(45);
  const [daysAhead, setDaysAhead] = useState(14);
  const [minNotice, setMinNotice] = useState(12);
  const [kitId, setKitId] = useState("");
  const [stageId, setStageId] = useState("");
  const [meetingDetail, setMeetingDetail] = useState("");
  const [notes, setNotes] = useState("");
  const [panel, setPanel] = useState<Record<string, "required" | "optional" | "no">>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const requiredCount = Object.values(panel).filter((v) => v === "required").length;

  return (
    <Card className="p-5">
      <h3 className="text-sm font-bold text-navy-900">Self-scheduling</h3>

      {existing.length > 0 && (
        <ul className="mt-3 space-y-2">
          {existing.map((r) => (
            <li key={r.id} className="rounded-lg border border-navy-100 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-navy-900">{r.title}</p>
                  <p className="font-mono text-xs text-navy-500">{r.reference}</p>
                </div>
                <Badge
                  tone={
                    r.status === "BOOKED"
                      ? "green"
                      : r.status === "OPEN"
                        ? "amber"
                        : "neutral"
                  }
                >
                  {r.status.toLowerCase()}
                </Badge>
              </div>
              {r.scheduledAt && (
                <p className="mt-1 text-xs text-navy-600">
                  {new Date(r.scheduledAt).toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              )}
              {r.interviewId && (
                <a
                  href={`/api/admin/interviews/${r.interviewId}/ics`}
                  className="mt-1 inline-block text-xs font-semibold text-fsw-700 hover:underline"
                >
                  Add to calendar
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {link && (
        <div className="mt-3 rounded-lg bg-emerald-50 p-3">
          <p className="text-xs font-semibold text-emerald-900">
            Send this to the candidate:
          </p>
          <input
            readOnly
            className="mt-2 w-full rounded border border-emerald-200 bg-white px-2 py-1 font-mono text-xs text-navy-800"
            value={link}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      )}

      {!open ? (
        <Button variant="secondary" className="mt-4 w-full" onClick={() => setOpen(true)}>
          Send a scheduling link
        </Button>
      ) : (
        <div className="mt-4 border-t border-navy-100 pt-4">
          <Label htmlFor="schTitle">What to call it</Label>
          <Input id="schTitle" value={title} onChange={(e) => setTitle(e.target.value)} />

          <div className="mt-3 grid grid-cols-3 gap-2">
            <div>
              <Label htmlFor="schDur">Minutes</Label>
              <Input
                id="schDur"
                type="number"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="schDays">Days ahead</Label>
              <Input
                id="schDays"
                type="number"
                value={daysAhead}
                onChange={(e) => setDaysAhead(Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="schNotice">Notice (h)</Label>
              <Input
                id="schNotice"
                type="number"
                value={minNotice}
                onChange={(e) => setMinNotice(Number(e.target.value))}
              />
            </div>
          </div>

          <Label htmlFor="schStage" className="mt-3 block">
            Stage
          </Label>
          <Select id="schStage" value={stageId} onChange={(e) => setStageId(e.target.value)}>
            <option value="">None</option>
            {stages
              .filter((s) => s.kind === "INTERVIEW")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Select>

          <Label htmlFor="schKit" className="mt-3 block">
            Interview kit
          </Label>
          <Select id="schKit" value={kitId} onChange={(e) => setKitId(e.target.value)}>
            <option value="">None</option>
            {kits.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </Select>

          <Label htmlFor="schWhere" className="mt-3 block">
            Where (link, room, or number)
          </Label>
          <Input
            id="schWhere"
            value={meetingDetail}
            onChange={(e) => setMeetingDetail(e.target.value)}
          />

          <Label htmlFor="schNotes" className="mt-3 block">
            What the candidate should know
          </Label>
          <Input id="schNotes" value={notes} onChange={(e) => setNotes(e.target.value)} />

          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-navy-400">
            Who is interviewing
          </p>
          <p className="mt-1 text-xs text-navy-500">
            Only times when every <em>required</em> person is free are offered.
          </p>
          <div className="mt-2 space-y-1">
            {teamUsers.length === 0 && (
              <p className="text-sm text-navy-500">
                Nobody is on the hiring team for this role yet. Add the
                interviewers to the requisition first — their working hours and
                busy times are shown to the candidate, and their address goes
                on the invitation, so the panel comes from the recorded team
                rather than from everyone with an account.
              </p>
            )}
            {teamUsers.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-2">
                <span className="text-sm text-navy-800">{u.name}</span>
                <Select
                  className="w-32"
                  value={panel[u.id] ?? "no"}
                  onChange={(e) =>
                    setPanel((p) => ({
                      ...p,
                      [u.id]: e.target.value as "required" | "optional" | "no",
                    }))
                  }
                >
                  <option value="no">Not on it</option>
                  <option value="required">Required</option>
                  <option value="optional">Optional</option>
                </Select>
              </div>
            ))}
          </div>

          {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
          <div className="mt-4 flex gap-2">
            <Button
              className="px-3 py-1.5 text-xs"
              disabled={busy || requiredCount === 0}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const out = await api<{ url: string }>(
                    "/api/admin/scheduling/requests",
                    {
                      method: "POST",
                      body: {
                        applicationId,
                        title,
                        durationMinutes: duration,
                        kitId: kitId || null,
                        stageId: stageId || null,
                        notes: notes || null,
                        meetingDetail: meetingDetail || null,
                        daysAhead,
                        minNoticeHours: minNotice,
                        panelists: Object.entries(panel)
                          .filter(([, v]) => v !== "no")
                          .map(([userId, v]) => ({
                            userId,
                            required: v === "required",
                          })),
                      },
                    },
                  );
                  setLink(out.url);
                  setOpen(false);
                  router.refresh();
                } catch (err) {
                  setError(
                    err instanceof ApiError ? err.message : "Could not create the link.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Creating…" : "Create the link"}
            </Button>
            <Button
              variant="ghost"
              className="px-3 py-1.5 text-xs"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
          {requiredCount === 0 && (
            <p className="mt-2 text-xs text-navy-500">
              Mark at least one person required — without one there is nobody
              whose calendar decides which times can be offered.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
