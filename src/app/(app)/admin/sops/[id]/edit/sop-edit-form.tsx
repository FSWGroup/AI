"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Field, Textarea } from "@/components/ui/input";
import { Glyph, Icon } from "@/components/icons";
import { BlockEditor } from "@/components/editor/block-editor";
import { hasBlockingIssues, validateBlocksForPublish } from "@/components/editor/validation";
import { SopIdentityFields, type SopIdentityValue } from "@/app/(app)/admin/sops/sop-identity-fields";
import { SopMetaEditor } from "@/app/(app)/admin/sops/sop-meta-editor";
import type { Block, SopMeta } from "@/lib/content/types";
import type { HealthScoreResult, PersonRef } from "@/lib/services/sop";
import {
  approveSopAction,
  publishSopAction,
  requestChangesAction,
  resolveOutdatedReportAction,
  submitForReviewAction,
  updateSopDraftAction,
} from "@/app/(app)/admin/sops/[id]/edit/actions";

const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: "neutral",
  IN_REVIEW: "info",
  CHANGES_REQUESTED: "warning",
  APPROVED: "blue",
  PUBLISHED: "success",
  ARCHIVED: "neutral",
};

interface OutdatedReportRow {
  id: string;
  reason: string;
  status: string;
  createdAt: Date;
  reporter: PersonRef | null;
}

export function SopEditForm({
  sopId,
  sopCode,
  status,
  currentVersionNumber,
  initialIdentity,
  initialBlocks,
  initialMeta,
  people,
  departments,
  businessUnits,
  canApprove,
  canRequestChanges,
  canPublish,
  outdatedReports,
  health,
}: {
  sopId: string;
  sopCode: string;
  status: string;
  currentVersionNumber: string | null;
  initialIdentity: SopIdentityValue;
  initialBlocks: Block[];
  initialMeta: SopMeta;
  people: PersonRef[];
  departments: { id: string; name: string }[];
  businessUnits: { id: string; name: string }[];
  canApprove: boolean;
  canRequestChanges: boolean;
  canPublish: boolean;
  outdatedReports: OutdatedReportRow[];
  health: HealthScoreResult | null;
}) {
  const router = useRouter();
  const [identity, setIdentity] = useState(initialIdentity);
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [meta, setMeta] = useState<SopMeta>(initialMeta);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [changeSummary, setChangeSummary] = useState("");
  const [isMaterial, setIsMaterial] = useState(true);
  const [requestChangesOpen, setRequestChangesOpen] = useState(false);
  const [changesComment, setChangesComment] = useState("");
  const [, startTransition] = useTransition();

  const issues = validateBlocksForPublish(blocks);
  const blocking = hasBlockingIssues(issues);

  function draftPayload() {
    return {
      title: identity.title,
      summary: identity.summary,
      category: identity.category || null,
      departmentId: identity.departmentId || null,
      businessUnitId: identity.businessUnitId || null,
      ownerId: identity.ownerId || null,
      smeId: identity.smeId || null,
      reviewerId: identity.reviewerId || null,
      approverId: identity.approverId || null,
      language: identity.language,
      reviewCycleDays: identity.reviewCycleDays ? Number(identity.reviewCycleDays) : null,
      blocks,
      meta,
    };
  }

  function saveDraft(showToast = true) {
    setErrors({});
    setPendingAction("save");
    startTransition(async () => {
      const result = await updateSopDraftAction(sopId, draftPayload());
      setPendingAction(null);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      if (showToast) toast.success("Draft saved.");
      router.refresh();
    });
  }

  function submitForReview() {
    setPendingAction("submit");
    startTransition(async () => {
      const saveResult = await updateSopDraftAction(sopId, draftPayload());
      if (!saveResult.ok) {
        setPendingAction(null);
        toast.error(saveResult.error);
        return;
      }
      const result = await submitForReviewAction(sopId, {});
      setPendingAction(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Submitted for review.");
      router.refresh();
    });
  }

  function approve() {
    setPendingAction("approve");
    startTransition(async () => {
      const result = await approveSopAction(sopId, {});
      setPendingAction(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Approved — ready to publish.");
      router.refresh();
    });
  }

  function requestChanges() {
    setPendingAction("request_changes");
    startTransition(async () => {
      const result = await requestChangesAction(sopId, { comment: changesComment });
      setPendingAction(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Changes requested.");
      setRequestChangesOpen(false);
      setChangesComment("");
      router.refresh();
    });
  }

  function publish() {
    setPendingAction("publish");
    startTransition(async () => {
      const saveResult = await updateSopDraftAction(sopId, draftPayload());
      if (!saveResult.ok) {
        setPendingAction(null);
        toast.error(saveResult.error);
        return;
      }
      const result = await publishSopAction(sopId, { changeSummary: changeSummary || undefined, isMaterial });
      setPendingAction(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Published as v${result.data.versionNumber}.`);
      setPublishOpen(false);
      setChangeSummary("");
      router.refresh();
    });
  }

  function resolveReport(reportId: string, reportStatus: "RESOLVED" | "DISMISSED") {
    startTransition(async () => {
      const result = await resolveOutdatedReportAction(sopId, reportId, reportStatus);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(reportStatus === "RESOLVED" ? "Marked resolved." : "Dismissed.");
      router.refresh();
    });
  }

  const openReports = outdatedReports.filter((r) => r.status === "OPEN");

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_18rem]">
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>SOP details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <SopIdentityFields
              value={identity}
              onChange={(patch) => setIdentity((v) => ({ ...v, ...patch }))}
              people={people}
              departments={departments}
              businessUnits={businessUnits}
              titleError={errors.title}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Content</CardTitle>
          </CardHeader>
          <CardContent>
            <BlockEditor blocks={blocks} onChange={setBlocks} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Structured details</CardTitle>
          </CardHeader>
          <CardContent>
            <SopMetaEditor value={meta} onChange={setMeta} />
          </CardContent>
        </Card>

        {openReports.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Outdated reports ({openReports.length})</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {openReports.map((report) => (
                <div key={report.id} className="rounded-md border border-[var(--border-subtle)] p-3">
                  <p className="text-[0.8125rem] text-[var(--text-primary)]">{report.reason}</p>
                  <p className="mt-1 text-[0.75rem] text-[var(--text-muted)]">
                    {report.reporter?.name ?? "Someone"} · {new Date(report.createdAt).toLocaleDateString()}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => resolveReport(report.id, "RESOLVED")}>
                      Mark resolved
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => resolveReport(report.id, "DISMISSED")}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>
              <Badge tone="navy">{sopCode}</Badge>
            </div>
            <p className="text-[0.75rem] text-[var(--text-muted)]">
              Current published version: {currentVersionNumber ? `v${currentVersionNumber}` : "Not yet published"}
            </p>
            <Link href={`/sops/${sopId}/versions`} className="inline-flex items-center gap-1 text-[0.8125rem] text-[var(--brand-secondary)] hover:underline">
              <Glyph name="clock" className="h-3.5 w-3.5" /> Version history
            </Link>
            <Link href={`/admin/sops/${sopId}/impact`} className="inline-flex items-center gap-1 text-[0.8125rem] text-[var(--brand-secondary)] hover:underline">
              <Icon name="report" className="h-3.5 w-3.5" /> Change impact
            </Link>

            {blocking && (
              <p className="text-[0.75rem] font-medium text-danger-700">Fix the highlighted content issues before publishing.</p>
            )}

            <div className="mt-1 flex flex-col gap-2">
              <Button variant="secondary" onClick={() => saveDraft()} loading={pendingAction === "save"} disabled={pendingAction !== null}>
                Save draft
              </Button>
              {(status === "DRAFT" || status === "CHANGES_REQUESTED") && (
                <Button variant="secondary" onClick={submitForReview} loading={pendingAction === "submit"} disabled={pendingAction !== null}>
                  Submit for review
                </Button>
              )}
              {canApprove && status === "IN_REVIEW" && (
                <Button variant="secondary" onClick={approve} loading={pendingAction === "approve"} disabled={pendingAction !== null}>
                  Approve
                </Button>
              )}
              {canRequestChanges && status === "IN_REVIEW" && (
                <Button variant="outline" onClick={() => setRequestChangesOpen(true)} disabled={pendingAction !== null}>
                  Request changes
                </Button>
              )}
              {canPublish && (
                <Button onClick={() => setPublishOpen(true)} disabled={pendingAction !== null || blocking}>
                  Publish
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {health && (
          <Card>
            <CardHeader>
              <CardTitle>Content health — {health.score}/100</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2 text-[0.8125rem]">
                {health.factors.map((factor) => (
                  <li key={factor.label} className="flex items-start gap-2">
                    <Glyph name={factor.met ? "check" : "x"} className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${factor.met ? "text-success-600" : "text-danger-600"}`} />
                    <span>
                      <span className="font-medium text-[var(--text-primary)]">{factor.label}</span>
                      <span className="block text-[0.75rem] text-[var(--text-muted)]">{factor.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog.Root open={publishOpen} onOpenChange={setPublishOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-5 shadow-lg focus:outline-none">
            <Dialog.Title className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">Publish this SOP</Dialog.Title>
            <Dialog.Description className="mt-1.5 text-[0.8125rem] text-[var(--text-muted)]">
              This creates a new, immutable version. Learners will see it immediately.
            </Dialog.Description>
            <Field label="Change summary" htmlFor="publish-change-summary" className="mt-4" hint="Shown in version history.">
              <Textarea id="publish-change-summary" rows={3} value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} />
            </Field>
            <label className="mt-3 flex items-center gap-2 text-[0.8125rem] text-[var(--text-primary)]">
              <input type="checkbox" checked={isMaterial} onChange={(e) => setIsMaterial(e.target.checked)} className="h-4 w-4 accent-[var(--brand-primary)]" />
              This is a material change (bumps the major version and is more likely to require retraining)
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="secondary">Cancel</Button>
              </Dialog.Close>
              <Button onClick={publish} loading={pendingAction === "publish"}>
                Publish
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={requestChangesOpen} onOpenChange={setRequestChangesOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-5 shadow-lg focus:outline-none">
            <Dialog.Title className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">Request changes</Dialog.Title>
            <Field label="What needs to change?" htmlFor="request-changes-comment" required className="mt-4">
              <Textarea id="request-changes-comment" rows={3} value={changesComment} onChange={(e) => setChangesComment(e.target.value)} />
            </Field>
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="secondary">Cancel</Button>
              </Dialog.Close>
              <Button onClick={requestChanges} loading={pendingAction === "request_changes"} disabled={changesComment.trim().length < 3}>
                Send
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
