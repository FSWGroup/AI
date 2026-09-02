"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card, Input, Label, Select } from "@/components/ui";

interface Rule {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

interface Exception {
  id: string;
  date: string;
  startMinute: number;
  endMinute: number;
  available: boolean;
  reason: string | null;
}

interface Upcoming {
  id: string;
  title: string;
  candidate: string;
  role: string;
  scheduledAt: string;
  durationMinutes: number;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const fromTime = (value: string) => {
  const [h, m] = value.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Zones the organization is most likely to need, plus whatever is already set. */
const COMMON_ZONES = [
  "Asia/Manila",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Australia/Sydney",
  "Europe/London",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "UTC",
];

export function AvailabilityEditor({
  timeZone: initialZone,
  rules: initialRules,
  exceptions,
  upcoming,
}: {
  timeZone: string;
  rules: Rule[];
  exceptions: Exception[];
  upcoming: Upcoming[];
}) {
  const router = useRouter();
  const [timeZone, setTimeZone] = useState(initialZone);
  const [rules, setRules] = useState<Rule[]>(initialRules);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exDate, setExDate] = useState("");
  const [exReason, setExReason] = useState("");

  const zones = COMMON_ZONES.includes(timeZone)
    ? COMMON_ZONES
    : [timeZone, ...COMMON_ZONES];

  const save = async (extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api("/api/admin/availability", {
        method: "POST",
        body: { timeZone, rules, ...extra },
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card className="mt-6 p-6">
        <Label htmlFor="tz">Your time zone</Label>
        <Select id="tz" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
        <p className="mt-1 text-xs text-navy-500">
          Everything below is in your own time. A candidate on the other side of
          the world sees the same slots in theirs.
        </p>

        <h3 className="mt-6 text-sm font-bold uppercase tracking-wide text-navy-500">
          Your usual week
        </h3>
        <div className="mt-3 space-y-2">
          {DAYS.map((label, day) => {
            const dayRules = rules.filter((r) => r.dayOfWeek === day);
            return (
              <div key={day} className="flex flex-wrap items-center gap-2">
                <span className="w-24 shrink-0 text-sm font-medium text-navy-800">
                  {label}
                </span>
                {dayRules.length === 0 ? (
                  <span className="text-sm text-navy-400">Not available</span>
                ) : (
                  dayRules.map((r, idx) => (
                    <span key={idx} className="flex items-center gap-1">
                      <Input
                        type="time"
                        className="w-28"
                        value={toTime(r.startMinute)}
                        onChange={(e) =>
                          setRules((prev) =>
                            prev.map((x) =>
                              x === r ? { ...x, startMinute: fromTime(e.target.value) } : x,
                            ),
                          )
                        }
                      />
                      <span className="text-navy-400">to</span>
                      <Input
                        type="time"
                        className="w-28"
                        value={toTime(r.endMinute)}
                        onChange={(e) =>
                          setRules((prev) =>
                            prev.map((x) =>
                              x === r ? { ...x, endMinute: fromTime(e.target.value) } : x,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        className="px-1 text-xs font-semibold text-red-700 hover:underline"
                        onClick={() => setRules((prev) => prev.filter((x) => x !== r))}
                      >
                        remove
                      </button>
                    </span>
                  ))
                )}
                <button
                  type="button"
                  className="text-xs font-semibold text-fsw-700 hover:underline"
                  onClick={() =>
                    setRules((prev) => [
                      ...prev,
                      { dayOfWeek: day, startMinute: 9 * 60, endMinute: 17 * 60 },
                    ])
                  }
                >
                  + add a window
                </button>
              </div>
            );
          })}
        </div>

        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex items-center gap-3">
          <Button disabled={busy} onClick={() => save()}>
            {busy ? "Saving…" : "Save"}
          </Button>
          {saved && <span className="text-sm text-emerald-700">Saved.</span>}
        </div>
      </Card>

      <Card className="mt-6 p-6">
        <h3 className="text-sm font-bold text-navy-900">Days off</h3>
        <p className="mt-1 text-sm text-navy-500">
          A one-off block, on top of your usual week. Nothing will be offered to
          a candidate on these days.
        </p>
        {exceptions.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {exceptions.map((e) => (
              <li key={e.id} className="flex items-center gap-3">
                <span className="text-navy-800">
                  {e.date}
                  {e.available ? " (extra availability)" : " (unavailable)"}
                  {e.reason ? ` — ${e.reason}` : ""}
                </span>
                <button
                  type="button"
                  className="text-xs font-semibold text-red-700 hover:underline"
                  onClick={() => save({ removeExceptionId: e.id })}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="exDate">Date</Label>
            <Input
              id="exDate"
              type="date"
              value={exDate}
              onChange={(e) => setExDate(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <Label htmlFor="exReason">Reason (optional)</Label>
            <Input
              id="exReason"
              value={exReason}
              onChange={(e) => setExReason(e.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            disabled={busy || !exDate}
            onClick={async () => {
              await save({
                exception: {
                  date: exDate,
                  startMinute: 0,
                  endMinute: 1440,
                  available: false,
                  reason: exReason || null,
                },
              });
              setExDate("");
              setExReason("");
            }}
          >
            Block the day
          </Button>
        </div>
      </Card>

      <h3 className="mt-8 text-sm font-bold uppercase tracking-wide text-navy-500">
        Your upcoming interviews
      </h3>
      <Card className="mt-3">
        {upcoming.length === 0 ? (
          <p className="p-4 text-sm text-navy-500">Nothing booked.</p>
        ) : (
          <ul className="divide-y divide-navy-50">
            {upcoming.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-4 p-4">
                <div>
                  <p className="font-semibold text-navy-900">
                    {i.candidate} — {i.title}
                  </p>
                  <p className="text-sm text-navy-500">
                    {new Intl.DateTimeFormat("en-US", {
                      timeZone,
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(i.scheduledAt))}{" "}
                    · {i.durationMinutes} min · {i.role}
                  </p>
                </div>
                <a
                  href={`/api/admin/interviews/${i.id}/ics`}
                  className="shrink-0 rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-semibold text-navy-800 hover:bg-navy-50"
                >
                  Add to calendar
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
