"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Button, Card } from "@/components/ui";
import { CONSENT_LABEL, type ConsentStatus } from "@/lib/talent/consent";

const TONE: Record<ConsentStatus, "green" | "amber" | "neutral" | "red"> = {
  OPTED_IN: "green",
  INVITED: "amber",
  NOT_ASKED: "neutral",
  OPTED_OUT: "red",
};

/**
 * Asking a candidate whether they want to be kept in mind.
 *
 * Placed on the application because the moment to ask is when a process ends
 * — that is when you know whether they were close, and it is when they are
 * still thinking about you.
 */
export function KeepInTouchPanel({
  candidateId,
  consentStatus,
  askedAt,
  expiresAt,
}: {
  candidateId: string;
  consentStatus: ConsentStatus | null;
  askedAt: string | null;
  expiresAt: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = consentStatus ?? "NOT_ASKED";

  return (
    <Card className="p-5">
      <h3 className="text-sm font-bold text-navy-900">Keeping in touch</h3>
      <div className="mt-2">
        <Badge tone={TONE[status]}>{CONSENT_LABEL[status]}</Badge>
      </div>

      {status === "OPTED_IN" && (
        <p className="mt-3 text-sm text-navy-600">
          Agreed to hear about future roles
          {expiresAt ? `, until ${expiresAt.slice(0, 10)}` : ""}.
        </p>
      )}
      {status === "INVITED" && (
        <p className="mt-3 text-sm text-navy-600">
          Asked on {askedAt?.slice(0, 10)}. No answer yet — and silence is not
          a yes, so they cannot be contacted about other roles.
        </p>
      )}
      {status === "OPTED_OUT" && (
        <p className="mt-3 text-sm text-navy-600">
          Asked not to be contacted about future roles. That cannot be undone
          from in here.
        </p>
      )}
      {status === "NOT_ASKED" && (
        <p className="mt-3 text-sm text-navy-600">
          Applying is not agreement to be kept on file. If this candidate was
          close, ask them — the end of a process is the moment they are most
          likely to say yes.
        </p>
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
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {(status === "NOT_ASKED" || status === "INVITED") && (
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const out = await api<{ url: string }>("/api/admin/talent/profiles", {
                  method: "POST",
                  body: { action: "invite", candidateId },
                });
                setLink(out.url);
                router.refresh();
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "Could not ask.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Working…" : status === "INVITED" ? "Send the ask again" : "Ask them"}
          </Button>
        )}
        {status !== "OPTED_OUT" && (
          <Button
            variant="ghost"
            className="px-3 py-1.5 text-xs"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api("/api/admin/talent/profiles", {
                  method: "POST",
                  body: {
                    action: "suppress",
                    candidateId,
                    reason: "requested_by_candidate",
                  },
                });
                router.refresh();
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "Could not record it.");
              } finally {
                setBusy(false);
              }
            }}
          >
            They asked not to be contacted
          </Button>
        )}
      </div>
    </Card>
  );
}
