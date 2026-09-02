"use client";

/**
 * Social media review and background check, on the application.
 *
 * The hiring team sees outcomes and conduct findings. They never see the
 * disclosed profile links — someone who can open them can see everything the
 * process exists to keep out of the decision, and "I saw it but did not let it
 * count" is not a control.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { STAGE_LABEL } from "@/lib/checkr/adverse-action";

export interface SocialCheckView {
  id: string;
  status: string;
  outcome: string | null;
  reviewerName: string | null;
  reviewerNotes: string | null;
  findings: { id: string; category: string; categoryLabel: string; description: string }[];
  consentUrl: string | null;
}

export interface BackgroundCheckView {
  id: string;
  status: string;
  result: string | null;
  packageSlug: string;
  invitationUrl: string | null;
  adverseStage: string;
  preAdverseSentAt: string | null;
  adverseGateReason: string | null;
  adverseAllowed: boolean;
  events: { id: string; type: string; summary: string | null; occurredAt: string }[];
}

export function ChecksPanel({
  applicationId,
  social,
  background,
  socialEnabled,
  checkrConfigured,
  canManageSocial,
  canManageBackground,
  reviewerOptions,
  defaultPackage,
  offerAccepted,
  stageKind,
}: {
  applicationId: string;
  social: SocialCheckView | null;
  background: BackgroundCheckView | null;
  socialEnabled: boolean;
  checkrConfigured: boolean;
  canManageSocial: boolean;
  canManageBackground: boolean;
  reviewerOptions: { id: string; name: string }[];
  defaultPackage: string | null;
  offerAccepted: boolean;
  stageKind: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reviewerId, setReviewerId] = useState(reviewerOptions[0]?.id ?? "");
  const [packageSlug, setPackageSlug] = useState(defaultPackage ?? "");
  const [consentUrl, setConsentUrl] = useState<string | null>(null);

  async function post(
    path: string,
    body: Record<string, unknown>,
    ok: string,
  ): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ consentUrl?: string; invitationUrl?: string; note?: string }>(
        path,
        { body },
      );
      if (res.consentUrl) setConsentUrl(res.consentUrl);
      setMessage(res.note ? `${ok} ${res.note}` : ok);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const lateEnough = ["REFERENCE", "OFFER", "HIRED"].includes(stageKind ?? "");

  return (
    <Card className="p-6">
      <h2 className="text-sm font-bold text-navy-900">Checks</h2>
      {message && (
        <p role="status" className="mt-3 rounded-lg bg-fsw-50 p-2.5 text-sm text-fsw-900">
          {message}
        </p>
      )}
      {consentUrl && (
        <p className="mt-2 break-all rounded-lg border border-navy-100 p-2 text-xs text-navy-700">
          {consentUrl}
        </p>
      )}

      {/* ---- Social media review ---- */}
      <div className="mt-4 border-t border-navy-100 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-navy-500">
            Social media review
          </h3>
          {social && (
            <Badge
              tone={
                social.outcome === "FINDINGS_TO_DISCUSS"
                  ? "amber"
                  : social.status === "COMPLETED"
                    ? "green"
                    : social.status === "CONSENT_DECLINED"
                      ? "neutral"
                      : "blue"
              }
            >
              {social.status.replace(/_/g, " ").toLowerCase()}
            </Badge>
          )}
        </div>

        {!social && !socialEnabled && (
          <p className="mt-2 text-xs leading-relaxed text-navy-500">
            Switched off. Enable it in Settings after reviewing the process with
            counsel.
          </p>
        )}
        {!social && socialEnabled && !lateEnough && (
          <p className="mt-2 text-xs leading-relaxed text-navy-500">
            Available from the reference or offer stage. Screening every
            applicant exposes the process to protected characteristics hundreds
            of times over for people who were never near an offer.
          </p>
        )}
        {!social && socialEnabled && lateEnough && canManageSocial && (
          <div className="mt-2">
            <label className="mb-1 block text-xs text-navy-500">
              Reviewer (must not be deciding on this candidate)
            </label>
            <Select value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
              {reviewerOptions.length === 0 && (
                <option value="">Nobody eligible</option>
              )}
              {reviewerOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            <Button
              className="mt-2"
              variant="ghost"
              disabled={busy || !reviewerId}
              onClick={() =>
                void post(
                  `/api/admin/applications/${applicationId}/social-check`,
                  { reviewerId },
                  "Consent request sent to the candidate.",
                )
              }
            >
              Request consent
            </Button>
          </div>
        )}

        {social?.status === "CONSENT_DECLINED" && (
          <p className="mt-2 text-xs leading-relaxed text-navy-600">
            The candidate declined. That is recorded as a decline and nothing
            more — it must not weigh on the decision.
          </p>
        )}
        {social?.status === "COMPLETED" && (
          <div className="mt-2">
            <p className="text-sm text-navy-700">
              {social.outcome === "NOTHING_FOUND"
                ? "Reviewed — nothing to raise."
                : `${social.findings.length} finding${social.findings.length === 1 ? "" : "s"} to discuss.`}
              {social.reviewerName && (
                <span className="ml-1 text-xs text-navy-400">
                  by {social.reviewerName}
                </span>
              )}
            </p>
            {social.findings.length > 0 && (
              <ul className="mt-2 space-y-2">
                {social.findings.map((f) => (
                  <li key={f.id} className="rounded-lg bg-amber-50 p-2.5 text-xs">
                    <p className="font-semibold text-amber-900">{f.categoryLabel}</p>
                    <p className="mt-0.5 leading-relaxed text-amber-900">
                      {f.description}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {social.reviewerNotes && (
              <p className="mt-2 text-xs leading-relaxed text-navy-600">
                {social.reviewerNotes}
              </p>
            )}
            <p className="mt-2 text-xs text-navy-400">
              Profile links are held by the reviewer only. Discuss any finding
              with the candidate before it counts against them.
            </p>
          </div>
        )}
      </div>

      {/* ---- Background check ---- */}
      <div className="mt-5 border-t border-navy-100 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-navy-500">
            Background check (Checkr)
          </h3>
          {background && (
            <Badge
              tone={
                background.result === "CLEAR"
                  ? "green"
                  : background.result === "CONSIDER"
                    ? "amber"
                    : "blue"
              }
            >
              {background.result
                ? background.result.toLowerCase()
                : background.status.replace(/_/g, " ").toLowerCase()}
            </Badge>
          )}
        </div>

        {!background && !checkrConfigured && (
          <p className="mt-2 text-xs leading-relaxed text-navy-500">
            Not configured. Set CHECKR_API_KEY and CHECKR_WEBHOOK_SECRET to
            enable background checks.
          </p>
        )}
        {!background && checkrConfigured && !offerAccepted && (
          <p className="mt-2 text-xs leading-relaxed text-navy-500">
            Available once the candidate accepts an offer. Ordering earlier is
            restricted in many jurisdictions and there is no reason to pay for a
            report on someone who has not said yes.
          </p>
        )}
        {!background && checkrConfigured && offerAccepted && canManageBackground && (
          <div className="mt-2">
            <label className="mb-1 block text-xs text-navy-500">Checkr package</label>
            <Input
              value={packageSlug}
              onChange={(e) => setPackageSlug(e.target.value)}
              placeholder="e.g. tasker_standard"
            />
            <Button
              className="mt-2"
              variant="ghost"
              disabled={busy || packageSlug.trim() === ""}
              onClick={() =>
                void post(
                  `/api/admin/applications/${applicationId}/background-check`,
                  { packageSlug: packageSlug.trim() },
                  "Invitation sent. Checkr collects the candidate's details and consent directly.",
                )
              }
            >
              Order background check
            </Button>
            <p className="mt-1.5 text-xs leading-relaxed text-navy-400">
              Checkr collects the SSN, date of birth, and the FCRA disclosure
              and authorization. None of it comes through this system.
            </p>
          </div>
        )}

        {background && (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-navy-500">
              Package {background.packageSlug} ·{" "}
              {STAGE_LABEL[background.adverseStage as keyof typeof STAGE_LABEL] ??
                background.adverseStage}
            </p>

            {background.result === "CONSIDER" && (
              <div className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                <p className="font-semibold">
                  &ldquo;Consider&rdquo; is not a failure and not a decision.
                </p>
                <p className="mt-1">
                  It means a person has to look at the report and weigh it
                  against the role. If you then decide not to hire because of
                  it, the FCRA sequence below applies.
                </p>
              </div>
            )}

            {canManageBackground && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void post(
                      `/api/admin/background-checks/${background.id}`,
                      { action: "refresh" },
                      "Refreshed from Checkr.",
                    )
                  }
                >
                  Refresh
                </Button>
                {background.result === "CONSIDER" &&
                  background.adverseStage === "NONE" && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void post(
                          `/api/admin/background-checks/${background.id}`,
                          { action: "send_pre_adverse" },
                          "Pre-adverse notice sent.",
                        )
                      }
                    >
                      Send pre-adverse notice
                    </Button>
                  )}
                {["PRE_ADVERSE_SENT", "DISPUTED"].includes(background.adverseStage) && (
                  <>
                    <Button
                      variant="ghost"
                      disabled={busy || !background.adverseAllowed}
                      onClick={() =>
                        void post(
                          `/api/admin/background-checks/${background.id}`,
                          { action: "send_adverse_action" },
                          "Adverse action notice sent.",
                        )
                      }
                    >
                      Send adverse action
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void post(
                          `/api/admin/background-checks/${background.id}`,
                          { action: "cancel_adverse_action" },
                          "Adverse action cancelled.",
                        )
                      }
                    >
                      Cancel adverse action
                    </Button>
                  </>
                )}
              </div>
            )}

            {background.adverseGateReason && !background.adverseAllowed && (
              <p className="rounded-lg bg-navy-50 p-2.5 text-xs leading-relaxed text-navy-700">
                {background.adverseGateReason}
              </p>
            )}

            {background.events.length > 0 && (
              <ul className="mt-1 space-y-1 text-xs text-navy-500">
                {background.events.slice(0, 6).map((e) => (
                  <li key={e.id}>
                    {new Intl.DateTimeFormat("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(e.occurredAt))}{" "}
                    — {e.summary ?? e.type}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
