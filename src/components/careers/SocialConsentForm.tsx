"use client";

/**
 * The candidate chooses whether to take part and which public profiles to
 * share. Declining is a first-class button, not fine print — a consent form
 * where refusing is hard is not a consent form.
 */

import { useState } from "react";
import { Button, Card, Input, Select } from "@/components/ui";

const NETWORKS = [
  "LinkedIn",
  "X / Twitter",
  "Facebook",
  "Instagram",
  "TikTok",
  "GitHub",
  "Personal website",
  "Other",
];

export function SocialConsentForm({
  token,
  candidateFirstName,
  companyName,
}: {
  token: string;
  candidateFirstName: string;
  companyName: string;
}) {
  const [profiles, setProfiles] = useState<{ network: string; url: string }[]>([
    { network: "LinkedIn", url: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"GIVEN" | "DECLINED" | null>(null);

  async function respond(payload: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/social-check/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { status?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "We could not record your response.");
      setDone(body.status === "GIVEN" ? "GIVEN" : "DECLINED");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (done === "GIVEN") {
    return (
      <Card className="p-8">
        <h2 className="text-lg font-bold text-navy-900">Thank you</h2>
        <p className="mt-3 leading-relaxed text-navy-600">
          We have what you shared. If anything is recorded you will hear about
          it and have a chance to respond before it counts against you.
        </p>
      </Card>
    );
  }
  if (done === "DECLINED") {
    return (
      <Card className="p-8">
        <h2 className="text-lg font-bold text-navy-900">Noted, thank you</h2>
        <p className="mt-3 leading-relaxed text-navy-600">
          You have declined and that is recorded. It does not count against your
          application, and your recruiting contact at {companyName} will
          continue as normal.
        </p>
      </Card>
    );
  }

  const usable = profiles.filter((p) => p.url.trim() !== "");

  return (
    <Card className="p-8">
      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {error}
        </p>
      )}
      <h2 className="text-lg font-bold text-navy-900">
        Your choice, {candidateFirstName}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-navy-600">
        Share the public profiles you are happy for us to look at, or decline.
        We will not search for accounts you do not list here.
      </p>

      <div className="mt-5 space-y-3">
        {profiles.map((p, i) => (
          <div key={i} className="flex flex-wrap gap-2">
            <Select
              className="w-40"
              value={p.network}
              onChange={(e) =>
                setProfiles((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, network: e.target.value } : x)),
                )
              }
              aria-label={`Network ${i + 1}`}
            >
              {NETWORKS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
            <Input
              className="min-w-[16rem] flex-1"
              type="url"
              placeholder="https://…"
              value={p.url}
              onChange={(e) =>
                setProfiles((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)),
                )
              }
              aria-label={`Profile URL ${i + 1}`}
            />
          </div>
        ))}
      </div>
      {profiles.length < 10 && (
        <button
          type="button"
          onClick={() => setProfiles((p) => [...p, { network: "Other", url: "" }])}
          className="mt-2 text-sm font-semibold text-fsw-700 hover:underline"
        >
          Add another
        </button>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          disabled={busy || usable.length === 0}
          onClick={() => void respond({ action: "consent", profiles: usable })}
        >
          Share these and continue
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void respond({ action: "decline" })}
        >
          I would rather not take part
        </Button>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-navy-500">
        Declining is genuinely fine. It is recorded as a decline and nothing
        more.
      </p>
    </Card>
  );
}
