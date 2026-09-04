"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { useAction } from "@/lib/client/use-action";
import { Badge, Button, Card, ErrorText } from "@/components/ui";
import { OneTimeLink } from "./OneTimeLink";
import {
  CONSENT_LABEL,
  CONSENT_TONE,
  type ConsentStatus,
} from "@/lib/talent/consent";

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
  const { busy, error, run } = useAction();
  const [link, setLink] = useState<string | null>(null);
  const status = consentStatus ?? "NOT_ASKED";

  return (
    <Card className="p-5">
      <h3 className="text-sm font-bold text-navy-900">Keeping in touch</h3>
      <div className="mt-2">
        <Badge tone={CONSENT_TONE[status]}>{CONSENT_LABEL[status]}</Badge>
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

      {link && <OneTimeLink url={link} />}
      {error && <ErrorText className="mt-3">{error}</ErrorText>}

      <div className="mt-4 flex flex-wrap gap-2">
        {(status === "NOT_ASKED" || status === "INVITED") && (
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            disabled={busy}
            onClick={async () => {
              await run(async () => {
                const out = await api<{ url: string }>("/api/admin/talent/profiles", {
                  method: "POST",
                  body: { action: "invite", candidateId },
                });
                setLink(out.url);
              }, { fallback: "Could not ask." });
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
              await run(async () => {
                await api("/api/admin/talent/profiles", {
                  method: "POST",
                  body: {
                    action: "suppress",
                    candidateId,
                    reason: "requested_by_candidate",
                  },
                });
              }, { fallback: "Could not record it." });
            }}
          >
            They asked not to be contacted
          </Button>
        )}
      </div>
    </Card>
  );
}
