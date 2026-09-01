"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card, Input } from "@/components/ui";

export function OfferActions({
  offerId,
  status,
  hasApprovers,
  canManage,
  canDecideNow,
}: {
  offerId: string;
  status: string;
  hasApprovers: boolean;
  canManage: boolean;
  canDecideNow: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [offerUrl, setOfferUrl] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  async function post(body: Record<string, unknown>, ok: string): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ offerUrl?: string }>(`/api/admin/offers/${offerId}`, {
        body,
      });
      if (res.offerUrl) setOfferUrl(res.offerUrl);
      setMessage(ok);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-sm font-bold text-navy-900">Actions</h2>
      {message && (
        <p role="status" className="mt-3 rounded-lg bg-fsw-50 p-2.5 text-sm text-fsw-900">
          {message}
        </p>
      )}
      {offerUrl && (
        <div className="mt-3 rounded-lg border border-navy-100 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-navy-500">
            Candidate link
          </p>
          <p className="mt-1 break-all text-xs text-navy-700">{offerUrl}</p>
          <p className="mt-1.5 text-xs text-navy-400">
            Emailed to the candidate. Send it yourself as well if no email
            provider is configured.
          </p>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {canManage && status === "DRAFT" && hasApprovers && (
          <Button
            disabled={busy}
            onClick={() =>
              void post({ action: "submit_for_approval" }, "Sent to the first approver.")
            }
          >
            Submit for approval
          </Button>
        )}
        {canManage && status === "DRAFT" && !hasApprovers && (
          <Button
            disabled={busy}
            onClick={() =>
              void post({ action: "approve_without_chain" }, "Approved and ready to send.")
            }
          >
            Approve
          </Button>
        )}
        {canManage && status === "APPROVED" && (
          <Button
            disabled={busy}
            onClick={() => void post({ action: "send" }, "Sent to the candidate.")}
          >
            Send to candidate
          </Button>
        )}
        {canManage && ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "ACCEPTED"].includes(status) && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void post({ action: "rescind" }, "Rescinded.")}
          >
            Rescind offer
          </Button>
        )}
      </div>

      {canDecideNow && status === "PENDING_APPROVAL" && (
        <div className="mt-4 rounded-xl border border-fsw-200 bg-fsw-50 p-4">
          <p className="text-sm font-semibold text-navy-900">
            This offer needs your decision.
          </p>
          <Input
            className="mt-3"
            placeholder="Comment (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            aria-label="Approval comment"
          />
          <div className="mt-3 flex gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                void post(
                  { action: "decide", decision: "APPROVED", comment: comment || null },
                  "Approved.",
                )
              }
            >
              Approve
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void post(
                  { action: "decide", decision: "REJECTED", comment: comment || null },
                  "Rejected and returned to draft.",
                )
              }
            >
              Reject
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
