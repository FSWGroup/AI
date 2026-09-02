"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";

interface Payload {
  status: string;
  title: string;
  notes: string | null;
  durationMinutes: number;
  panelists: { name: string; required: boolean }[];
  booked: { start: string; meetingDetail: string | null } | null;
  canReschedule: boolean;
  reschedulesLeft: number;
  slots: { start: string; end: string }[];
}

/**
 * Choosing a time.
 *
 * Times are rendered in the CANDIDATE'S own zone, detected from their
 * browser, and the zone is named on the page. Every scheduling mix-up starts
 * with a time shown without saying whose clock it is on.
 */
export function SchedulePicker({
  token,
  firstName,
  company,
}: {
  token: string;
  firstName: string;
  company: string;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState("UTC");

  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/schedule/${token}`);
    if (res.ok) setData((await res.json()) as Payload);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return <p className="mt-8 text-sm text-navy-400">Loading times…</p>;
  }

  const zoneName = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")?.value;

  const fmtTime = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));

  const fmtDay = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(new Date(iso));

  if (data.status === "CANCELLED") {
    return (
      <Card className="mt-8 p-6">
        <h2 className="text-lg font-semibold text-navy-900">
          This interview has been cancelled
        </h2>
        <p className="mt-2 leading-relaxed text-navy-600">
          If that was not what you intended, contact your recruiting contact at{" "}
          {company} and they will set up a new time.
        </p>
      </Card>
    );
  }

  const days = new Map<string, { start: string; end: string }[]>();
  for (const slot of data.slots) {
    const key = fmtDay(slot.start);
    const list = days.get(key) ?? [];
    list.push(slot);
    days.set(key, list);
  }

  return (
    <div className="mt-8">
      {data.booked && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-navy-900">
            You are booked in
          </h2>
          <p className="mt-2 text-lg font-bold text-fsw-700">
            {fmtDay(data.booked.start)} at {fmtTime(data.booked.start)}
            {zoneName ? ` ${zoneName}` : ""}
          </p>
          {data.booked.meetingDetail && (
            <p className="mt-2 text-sm text-navy-600">
              Where: {data.booked.meetingDetail}
            </p>
          )}
          <p className="mt-3 text-sm text-navy-500">
            {data.canReschedule
              ? `Need a different time? Pick one below — you can move this ${data.reschedulesLeft} more time${data.reschedulesLeft === 1 ? "" : "s"} from this link.`
              : "This link cannot move the interview again. Contact your recruiting contact if you need to."}
          </p>
        </Card>
      )}

      {!data.booked && (
        <>
          <p className="leading-relaxed text-navy-700">
            Hello {firstName} — pick a time that suits you. Times are shown in
            your own time zone
            {zoneName ? ` (${zoneName})` : ""}.
          </p>
          {data.notes && (
            <div className="mt-4 rounded-lg bg-navy-50 p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-navy-700">
                {data.notes}
              </p>
            </div>
          )}
          {data.panelists.length > 0 && (
            <p className="mt-3 text-sm text-navy-500">
              You will be meeting {data.panelists.map((p) => p.name).join(", ")}.
            </p>
          )}
        </>
      )}

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      {(!data.booked || data.canReschedule) && (
        <>
          {data.slots.length === 0 ? (
            <Card className="mt-6 p-6">
              <p className="text-sm text-navy-600">
                There are no times available at the moment. Your recruiting
                contact at {company} has been able to see that too — they will
                be in touch with more.
              </p>
            </Card>
          ) : (
            <div className="mt-6 space-y-5">
              {[...days.entries()].map(([day, slots]) => (
                <div key={day}>
                  <h3 className="text-sm font-bold text-navy-900">{day}</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {slots.map((s) => (
                      <button
                        key={s.start}
                        type="button"
                        onClick={() => setSelected(s.start)}
                        className={
                          selected === s.start
                            ? "rounded-lg bg-fsw-600 px-4 py-2 text-sm font-semibold text-white"
                            : "rounded-lg border border-navy-200 px-4 py-2 text-sm font-semibold text-navy-700 hover:bg-navy-50"
                        }
                      >
                        {fmtTime(s.start)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {selected && (
            <div className="mt-6 rounded-xl border border-navy-200 bg-white p-5">
              <p className="text-sm text-navy-600">You are choosing</p>
              <p className="text-lg font-bold text-navy-900">
                {fmtDay(selected)} at {fmtTime(selected)}
                {zoneName ? ` ${zoneName}` : ""}
              </p>
              <Button
                className="mt-4"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const res = await fetch(`/api/schedule/${token}`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "book",
                        start: selected,
                        timeZone,
                      }),
                    });
                    const out = (await res.json()) as { error?: string };
                    if (!res.ok) {
                      setError(out.error ?? "Could not book that time.");
                      // Reload: if somebody took it, the list has changed.
                      await load();
                      setSelected(null);
                      return;
                    }
                    setSelected(null);
                    await load();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Booking…" : data.booked ? "Move to this time" : "Confirm this time"}
              </Button>
            </div>
          )}
        </>
      )}

      {data.booked && (
        <button
          type="button"
          className="mt-8 text-sm text-navy-500 underline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await fetch(`/api/schedule/${token}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "cancel" }),
              });
              await load();
            } finally {
              setBusy(false);
            }
          }}
        >
          I need to cancel this interview
        </button>
      )}
    </div>
  );
}
