"use client";

/**
 * Requisition actions, split by the section they belong to so each tab shows
 * only what is relevant there.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Button, Input } from "@/components/ui";

export function RequisitionActions({
  requisitionId,
  reference,
  status,
  canManage,
  canApprove,
  section,
}: {
  requisitionId: string;
  reference: string;
  status: string;
  canManage: boolean;
  canApprove: boolean;
  section: "approval" | "postings";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  async function post(body: Record<string, unknown>, ok: string): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/api/admin/requisitions/${requisitionId}`, { body });
      setMessage(ok);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (section === "postings") {
    const feedUrl = `/api/feeds/jobs.xml`;
    return (
      <div className="mt-5 border-t border-navy-100 pt-5">
        {message && (
          <p role="status" className="mb-3 text-sm text-fsw-800">
            {message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {canManage && status === "OPEN" && (
            <Button
              disabled={busy}
              onClick={() =>
                void post(
                  { action: "set_status", status: "ON_HOLD" },
                  "Put on hold. The role no longer appears on the careers page or in feeds.",
                )
              }
              variant="ghost"
            >
              Pause posting
            </Button>
          )}
          {canManage && status === "ON_HOLD" && (
            <Button
              disabled={busy}
              onClick={() =>
                void post({ action: "set_status", status: "OPEN" }, "Reopened.")
              }
            >
              Resume posting
            </Button>
          )}
          <a
            href={`/careers/${reference}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-navy-200 bg-white px-4 py-2.5 text-sm font-semibold text-navy-800 hover:bg-navy-50"
          >
            View public page
          </a>
          <a
            href={feedUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-navy-200 bg-white px-4 py-2.5 text-sm font-semibold text-navy-800 hover:bg-navy-50"
          >
            Job feed XML
          </a>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-navy-500">
          Open roles appear automatically in the XML feed that Indeed and other
          aggregators read. Give a board the feed URL once and every future role
          flows to it without anyone re-typing a posting.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5 border-t border-navy-100 pt-5">
      {message && (
        <p role="status" className="mb-3 text-sm text-fsw-800">
          {message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canManage && status === "DRAFT" && (
          <Button
            disabled={busy}
            onClick={() =>
              void post(
                { action: "submit_for_approval" },
                "Sent to the first approver.",
              )
            }
          >
            Submit for approval
          </Button>
        )}
        {canManage && status === "APPROVED" && (
          <Button
            disabled={busy}
            onClick={() =>
              void post(
                { action: "set_status", status: "OPEN" },
                "Open. The role is now live on the careers page and in the job feed.",
              )
            }
          >
            Open the role
          </Button>
        )}
        {canManage && (status === "OPEN" || status === "ON_HOLD") && (
          <>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void post({ action: "set_status", status: "FILLED" }, "Marked filled.")
              }
            >
              Mark filled
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void post({ action: "set_status", status: "CLOSED" }, "Closed.")
              }
            >
              Close
            </Button>
          </>
        )}
      </div>

      {canApprove && status === "PENDING_APPROVAL" && (
        <div className="mt-4 rounded-xl border border-fsw-200 bg-fsw-50 p-4">
          <p className="text-sm font-semibold text-navy-900">
            This requisition is waiting on your decision.
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
                  "Rejected and returned to the recruiter.",
                )
              }
            >
              Reject
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
