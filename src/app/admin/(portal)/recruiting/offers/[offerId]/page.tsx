import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCompanyName } from "@/lib/org-settings";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Badge, Card, SectionHeading } from "@/components/ui";
import { OfferActions } from "@/components/admin/OfferActions";
import { chainStatus, describeChain, type ApprovalStep } from "@/lib/ats/approvals";
import {
  OFFER_STATUS_LABEL,
  formatMoney,
  renderTemplate,
  unresolvedFields,
  whereToFill,
} from "@/lib/ats/offers";
import { mergeContextForOffer } from "@/lib/ats/offer-letter";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d ? new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(d) : "—";

export default async function OfferPage({
  params,
}: {
  params: Promise<{ offerId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "VIEW_REQUISITIONS")) redirect("/admin");
  const { offerId } = await params;

  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: {
      template: true,
      approvals: {
        orderBy: { stepIndex: "asc" },
        include: { approver: { select: { id: true, name: true } } },
      },
      application: {
        include: {
          candidate: true,
          requisition: {
            include: { team: { include: { user: { select: { name: true } } } } },
          },
        },
      },
    },
  });
  if (!offer) notFound();

  const companyName = await getCompanyName();
  const context = mergeContextForOffer(offer, companyName);

  const preview =
    offer.letterBody ??
    (offer.template ? renderTemplate(offer.template.body, context) : null);
  const unresolved = offer.template
    ? unresolvedFields(offer.template.body, context)
    : [];

  const steps: ApprovalStep[] = offer.approvals.map((a) => ({
    stepIndex: a.stepIndex,
    approverId: a.approverId,
    approverName: a.approver.name,
    decision: a.decision,
    comment: a.comment,
    decidedAt: a.decidedAt,
  }));
  const approval = chainStatus(steps);
  const candidateName = `${offer.application.candidate.firstName} ${offer.application.candidate.lastName}`;

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={`/admin/recruiting/applications/${offer.applicationId}`}
        className="text-sm font-semibold text-fsw-700 hover:underline"
      >
        ← {candidateName}
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <SectionHeading
          eyebrow={offer.reference}
          title={`Offer — ${offer.jobTitle}`}
          description={`${candidateName} · ${offer.application.candidate.email}`}
        />
        <Badge
          tone={
            offer.status === "ACCEPTED"
              ? "green"
              : offer.status === "SENT"
                ? "blue"
                : offer.status === "DECLINED" || offer.status === "RESCINDED"
                  ? "red"
                  : "neutral"
          }
        >
          {OFFER_STATUS_LABEL[offer.status]}
        </Badge>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-6">
            <h2 className="text-sm font-bold text-navy-900">Terms</h2>
            <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Row label="Base salary" value={`${formatMoney(offer.baseSalary, offer.salaryCurrency)} per ${offer.salaryPeriod.toLowerCase()}`} />
              <Row
                label="Signing bonus"
                value={
                  offer.signingBonus != null
                    ? formatMoney(offer.signingBonus, offer.salaryCurrency)
                    : "None"
                }
              />
              <Row label="Start date" value={fmt(offer.startDate)} />
              <Row label="Respond by" value={fmt(offer.expiresAt)} />
              <Row
                label="Employment type"
                value={offer.employmentType.replace(/_/g, " ").toLowerCase()}
              />
              <Row label="Arrangement" value={offer.workArrangement.toLowerCase()} />
            </dl>
            {offer.variablePay && (
              <p className="mt-3 text-sm text-navy-700">
                <span className="font-medium">Variable pay:</span> {offer.variablePay}
              </p>
            )}
          </Card>

          {preview ? (
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-navy-900">
                  {offer.letterBody ? "The letter as sent" : "Letter preview"}
                </h2>
                <a
                  href={`/api/admin/offers/${offer.id}/letter`}
                  className="rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-xs font-semibold text-navy-800 hover:bg-navy-50"
                >
                  Download PDF
                </a>
              </div>
              {offer.letterBody && (
                <p className="mt-1 text-xs text-navy-500">
                  Frozen when it was sent. A later template edit cannot change
                  what this candidate was offered.
                </p>
              )}
              {unresolved.length > 0 && !offer.letterBody && (
                <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                  <p className="font-semibold">
                    Unfilled placeholders — these have to be resolved before the
                    offer can be sent, or they would appear literally in the
                    candidate&rsquo;s letter.
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {unresolved.map((f) => (
                      <li key={f}>
                        <span className="font-mono">{`{{${f}}}`}</span> — {whereToFill(f)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <article className="mt-4 max-h-[32rem] overflow-y-auto whitespace-pre-line rounded-xl border border-navy-100 bg-navy-50 p-5 text-[13px] leading-relaxed text-navy-800">
                {preview}
              </article>
            </Card>
          ) : (
            <Card className="p-6 text-sm text-navy-500">
              No letter template chosen yet.
            </Card>
          )}

          {offer.status === "ACCEPTED" && (
            <Card className="border-emerald-200 bg-emerald-50 p-6">
              <h2 className="text-sm font-bold text-emerald-900">Accepted</h2>
              <p className="mt-2 text-sm text-emerald-900">
                Signed as <strong>{offer.signatureName}</strong> on{" "}
                {offer.respondedAt
                  ? new Intl.DateTimeFormat("en-US", {
                      dateStyle: "long",
                      timeStyle: "short",
                    }).format(offer.respondedAt)
                  : "—"}
                {offer.signatureIp ? ` from ${offer.signatureIp}` : ""}.
              </p>
              <p className="mt-2 text-xs text-emerald-800">
                Move the application to the Hired stage to close the requisition
                out.
              </p>
            </Card>
          )}

          {offer.status === "DECLINED" && offer.declineReason && (
            <Card className="p-6">
              <h2 className="text-sm font-bold text-navy-900">Reason given</h2>
              <p className="mt-2 whitespace-pre-line text-sm text-navy-700">
                {offer.declineReason}
              </p>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <OfferActions
            offerId={offer.id}
            status={offer.status}
            hasApprovers={steps.length > 0}
            canManage={can(user.role, "MANAGE_OFFERS")}
            canDecideNow={approval.currentStep?.approverId === user.id}
          />

          <Card className="p-6">
            <h2 className="text-sm font-bold text-navy-900">Approval</h2>
            <p className="mt-1 text-sm text-navy-600">{describeChain(steps)}</p>
            {steps.length > 0 && (
              <ol className="mt-3 space-y-2 text-sm">
                {steps.map((s) => (
                  <li
                    key={s.stepIndex}
                    className="flex items-center justify-between gap-2 rounded-lg border border-navy-100 px-3 py-2"
                  >
                    <span className="text-navy-800">{s.approverName}</span>
                    <Badge
                      tone={
                        s.decision === "APPROVED"
                          ? "green"
                          : s.decision === "REJECTED"
                            ? "red"
                            : "neutral"
                      }
                    >
                      {s.decision.toLowerCase()}
                    </Badge>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-navy-400">
        {label}
      </dt>
      <dd className="mt-0.5 font-medium text-navy-900">{value}</dd>
    </div>
  );
}
