"use client";

/**
 * Accept or decline. A typed name stands as the signature, with the statement
 * shown above it so the candidate sees what they are agreeing to before they
 * type anything.
 */

import { useState } from "react";
import { Button, Card, Input, Textarea } from "@/components/ui";

export function OfferResponse({
  token,
  status,
  expired,
  candidateName,
  acceptanceStatement,
}: {
  token: string;
  status: string;
  expired: boolean;
  candidateName: string;
  acceptanceStatement: string;
}) {
  const [signature, setSignature] = useState("");
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"ACCEPTED" | "DECLINED" | null>(
    status === "ACCEPTED" ? "ACCEPTED" : status === "DECLINED" ? "DECLINED" : null,
  );

  async function respond(payload: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/offer/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { status?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "We could not record your response.");
      setDone(body.status === "ACCEPTED" ? "ACCEPTED" : "DECLINED");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (done === "ACCEPTED") {
    return (
      <Card className="p-8">
        <h2 className="text-lg font-bold text-navy-900">Offer accepted</h2>
        <p className="mt-3 leading-relaxed text-navy-600">
          Thank you. Your acceptance is recorded and your recruiting contact has
          been notified. They will be in touch about start arrangements.
        </p>
      </Card>
    );
  }
  if (done === "DECLINED") {
    return (
      <Card className="p-8">
        <h2 className="text-lg font-bold text-navy-900">Response recorded</h2>
        <p className="mt-3 leading-relaxed text-navy-600">
          Thank you for letting us know, and for the time you gave this process.
          We wish you well.
        </p>
      </Card>
    );
  }
  if (expired || status !== "SENT") {
    return (
      <Card className="p-8">
        <h2 className="text-lg font-bold text-navy-900">
          This offer is no longer open
        </h2>
        <p className="mt-3 leading-relaxed text-navy-600">
          Please contact your recruiting contact — they can reissue it if the
          role is still open.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-8">
      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {error}
        </p>
      )}

      {!declining ? (
        <>
          <h2 className="text-lg font-bold text-navy-900">Your response</h2>
          <p className="mt-3 text-sm leading-relaxed text-navy-700">
            {acceptanceStatement}
          </p>
          <label
            htmlFor="signature"
            className="mt-5 block text-sm font-medium text-navy-800"
          >
            Type your full name to sign
          </label>
          <Input
            id="signature"
            className="mt-1.5 max-w-sm"
            placeholder={candidateName}
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            autoComplete="name"
          />
          <div className="mt-5 flex flex-wrap gap-3">
            <Button
              disabled={busy || signature.trim().length < 2}
              onClick={() =>
                void respond({ action: "accept", signatureName: signature.trim() })
              }
            >
              Accept offer
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setDeclining(true)}>
              Decline
            </Button>
          </div>
          <p className="mt-3 text-xs text-navy-400">
            We record the time and connection you responded from, so that both
            sides have a record of the acceptance.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-lg font-bold text-navy-900">Declining this offer</h2>
          <p className="mt-2 text-sm leading-relaxed text-navy-600">
            If you are willing to say why, it genuinely helps us — but it is
            entirely optional.
          </p>
          <Textarea
            className="mt-3"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label="Reason for declining"
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              disabled={busy}
              onClick={() => void respond({ action: "decline", reason: reason || null })}
            >
              Confirm decline
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setDeclining(false)}>
              Back
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
