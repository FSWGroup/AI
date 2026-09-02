import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Badge, Card, SectionHeading } from "@/components/ui";
import { ApplicationActions } from "@/components/admin/ApplicationActions";
import {
  summarizeScorecards,
  RECOMMENDATION_LABEL,
  RATING_LABEL,
} from "@/lib/ats/scorecards";
import { ReviewPanel } from "@/components/admin/ReviewPanel";
import { ChecksPanel } from "@/components/admin/ChecksPanel";
import { WorkSamplePanel } from "@/components/admin/WorkSamplePanel";
import { KeepInTouchPanel } from "@/components/admin/KeepInTouchPanel";
import { visibleReviews, reviewProgress, buildConsensus } from "@/lib/ats/reviews";
import { categoryLabel } from "@/lib/ats/social-check";
import { isCheckrConfigured } from "@/lib/checkr/client";
import { canSendAdverseAction } from "@/lib/checkr/adverse-action";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(d)
    : "—";

export default async function ApplicationPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "VIEW_REQUISITIONS")) redirect("/admin");
  const { applicationId } = await params;

  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      candidate: { include: { talentProfile: true } },
      requisition: {
        include: { stages: { orderBy: { orderIndex: "asc" } }, department: true },
      },
      stage: true,
      channel: true,
      rejectionReason: true,
      referredBy: { select: { name: true } },
      screeningAnswers: { include: { question: true } },
      stageEvents: {
        orderBy: { occurredAt: "desc" },
        include: { actor: { select: { name: true } } },
      },
      notes: {
        orderBy: { createdAt: "desc" },
        include: { author: { select: { name: true } } },
      },
      documents: true,
      interviews: {
        orderBy: { scheduledAt: "desc" },
        include: {
          participants: { include: { user: { select: { name: true } } } },
          kit: { select: { name: true } },
        },
      },
      scorecards: {
        include: { author: { select: { name: true } }, ratings: true },
        orderBy: { createdAt: "desc" },
      },
      offers: { orderBy: { createdAt: "desc" } },
      workSamples: {
        include: {
          workSample: { select: { id: true, title: true, requiredGraders: true } },
          grades: { select: { status: true } },
        },
        orderBy: { assignedAt: "desc" },
      },
      invitations: {
        include: { attempts: { select: { id: true, status: true } } },
      },
      referenceChecks: { orderBy: { createdAt: "desc" } },
      reviewRounds: {
        orderBy: { createdAt: "desc" },
        include: {
          kit: { select: { name: true } },
          reviews: {
            include: {
              reviewer: { select: { id: true, name: true } },
              ratings: true,
            },
          },
        },
      },
      socialMediaCheck: {
        include: {
          reviewer: { select: { name: true } },
          findings: { orderBy: { createdAt: "asc" } },
        },
      },
      backgroundCheck: {
        include: { events: { orderBy: { occurredAt: "desc" }, take: 10 } },
      },
    },
  });
  if (!application) notFound();

  const reasons = await prisma.rejectionReason.findMany({
    where: { active: true },
    orderBy: { orderIndex: "asc" },
  });

  const summary = summarizeScorecards(
    application.scorecards.map((s) => ({
      id: s.id,
      authorName: s.author.name,
      status: s.status,
      recommendation: s.recommendation,
      summary: s.summary,
      submittedAt: s.submittedAt,
      ratings: s.ratings.map((r) => ({
        competencyName: r.competencyName,
        rating: r.rating,
        note: r.note,
      })),
    })),
  );

  const attempt = application.invitations.flatMap((i) => i.attempts)[0] ?? null;
  const manage = can(user.role, "MANAGE_PIPELINE");
  const canSeeAllReviews = can(user.role, "VIEW_ALL_REVIEWS");

  const [settings, kits, teamUsers, eligibleReviewers, activeWorkSamples] =
    await Promise.all([
    prisma.orgSettings.findUnique({ where: { id: "org" } }),
    prisma.interviewKit.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { active: true, role: { in: ["SUPER_ADMIN", "HR_ADMIN", "HIRING_MANAGER"] } },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { active: true, role: { in: ["SUPER_ADMIN", "HR_ADMIN"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.workSample.findMany({
      where: {
        status: "ACTIVE",
        OR: [
          { jobProfileId: null },
          { jobProfileId: application.requisition.jobProfileId },
        ],
      },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
  ]);

  // Anyone deciding on this candidate is disqualified from social review.
  const requisitionTeam = await prisma.hiringTeamMember.findMany({
    where: { requisitionId: application.requisitionId },
    select: { userId: true, role: true },
  });
  const deciderIds = new Set(
    requisitionTeam
      .filter((t) => t.role === "HIRING_MANAGER" || t.role === "RECRUITER")
      .map((t) => t.userId),
  );

  const rounds = application.reviewRounds.map((round) => {
    const asLike = round.reviews.map((r) => ({
      id: r.id,
      reviewerId: r.reviewerId,
      reviewerName: r.reviewer.name,
      status: r.status,
      recommendation: r.recommendation,
      summary: r.summary,
      submittedAt: r.submittedAt,
      ratings: r.ratings.map((x) => ({
        criterionName: x.criterionName,
        rating: x.rating,
        note: x.note,
      })),
    }));
    const visibility = visibleReviews({
      reviews: asLike,
      viewerId: user.id,
      blind: round.blind,
      canSeeAll: canSeeAllReviews,
      roundClosed: round.status === "CLOSED",
    });
    const progress = reviewProgress(asLike);
    const mine = asLike.find((r) => r.reviewerId === user.id) ?? null;
    return {
      id: round.id,
      name: round.name,
      blind: round.blind,
      status: round.status,
      dueAt: round.dueAt?.toISOString() ?? null,
      reviews: [],
      visible: visibility.visible.map((r) => ({
        ...r,
        submittedAt: undefined,
      })) as never,
      hiddenCount: visibility.hiddenCount,
      hiddenReason: visibility.reason,
      progress: {
        invited: progress.invited,
        submitted: progress.submitted,
        outstanding: progress.outstanding.map((o) => o.reviewerName),
      },
      // The consensus summarizes the whole panel, so it is withheld from
      // anyone still under the blind — otherwise an average would leak the
      // reviews themselves.
      consensus:
        canSeeAllReviews && visibility.hiddenCount === 0
          ? buildConsensus(asLike)
          : { submittedCount: 0, averageScore: null, split: false, spread: null, criteria: [] },
      myReviewId: mine?.id ?? null,
      myReviewStatus: mine?.status ?? null,
    };
  });

  const bg = application.backgroundCheck;
  const adverseGate = bg
    ? canSendAdverseAction({
        state: {
          stage: bg.adverseStage,
          preAdverseSentAt: bg.preAdverseSentAt,
          disputeReceivedAt: bg.disputeReceivedAt,
          adverseActionSentAt: bg.adverseActionSentAt,
        },
      })
    : null;

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href={`/admin/recruiting/requisitions/${application.requisitionId}`}
        className="text-sm font-semibold text-fsw-700 hover:underline"
      >
        ← {application.requisition.title}
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <SectionHeading
          eyebrow={`${application.reference} · applied ${fmt(application.appliedAt)}`}
          title={`${application.candidate.firstName} ${application.candidate.lastName}`}
          description={`${application.candidate.email}${application.candidate.phone ? ` · ${application.candidate.phone}` : ""} · via ${application.channel?.name ?? "an unknown source"}`}
        />
        <div className="flex flex-col items-end gap-2">
          <Badge
            tone={
              application.status === "HIRED"
                ? "green"
                : application.status === "REJECTED"
                  ? "red"
                  : application.status === "WITHDRAWN"
                    ? "neutral"
                    : "blue"
            }
          >
            {application.status.toLowerCase()}
          </Badge>
          {application.stage && (
            <span className="text-xs font-semibold uppercase tracking-wide text-navy-500">
              {application.stage.name}
            </span>
          )}
        </div>
      </div>

      {application.knockedOut && (
        <Card className="mt-6 border-amber-200 bg-amber-50 p-5">
          <h2 className="text-sm font-bold text-amber-900">
            Flagged by a screening question
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-amber-900">
            {application.knockoutReason}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-amber-800">
            This is a flag, not a rejection. Nobody has been screened out — read
            the answers below and decide.
          </p>
        </Card>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {application.screeningAnswers.length > 0 && (
            <Card className="p-6">
              <h2 className="text-sm font-bold text-navy-900">Screening answers</h2>
              <dl className="mt-3 space-y-3 text-sm">
                {application.screeningAnswers.map((a) => (
                  <div key={a.id}>
                    <dt className="font-medium text-navy-900">{a.promptSnapshot}</dt>
                    <dd className="mt-0.5 whitespace-pre-line text-navy-700">
                      {a.valueList.length > 0
                        ? a.valueList.join(", ")
                        : (a.valueText ?? (a.valueNumber != null ? String(a.valueNumber) : "—"))}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          {application.scorecards.length > 0 && (
            <Card className="p-6">
              <h2 className="text-sm font-bold text-navy-900">Interview scorecards</h2>
              <p className="mt-1 text-xs text-navy-500">
                {summary.submittedCount} submitted
                {summary.pendingCount > 0 ? `, ${summary.pendingCount} outstanding` : ""}
                {summary.panelSplit ? " · the panel is split" : ""}
              </p>
              {summary.panelSplit && (
                <p className="mt-2 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                  Interviewers disagreed. Read the individual write-ups rather
                  than the average — a split panel is information, and averaging
                  it away throws that information out.
                </p>
              )}
              <div className="mt-4 space-y-4">
                {application.scorecards.map((s) => (
                  <div key={s.id} className="rounded-xl border border-navy-100 p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-navy-900">
                        {s.author.name}
                      </p>
                      {s.recommendation ? (
                        <Badge
                          tone={
                            s.recommendation.includes("STRONG_YES")
                              ? "green"
                              : s.recommendation === "YES"
                                ? "blue"
                                : "amber"
                          }
                        >
                          {RECOMMENDATION_LABEL[s.recommendation]}
                        </Badge>
                      ) : (
                        <Badge tone="neutral">draft</Badge>
                      )}
                    </div>
                    {s.summary && (
                      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-navy-700">
                        {s.summary}
                      </p>
                    )}
                    {s.ratings.length > 0 && (
                      <ul className="mt-3 space-y-1 text-xs">
                        {s.ratings.map((r) => (
                          <li key={r.id} className="flex justify-between gap-3">
                            <span className="text-navy-700">{r.competencyName}</span>
                            <span className="text-navy-500">
                              {r.rating == null
                                ? "not assessed"
                                : `${r.rating}/4 — ${RATING_LABEL[r.rating]}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {application.interviews.length > 0 && (
            <Card className="p-6">
              <h2 className="text-sm font-bold text-navy-900">Interviews</h2>
              <ul className="mt-3 divide-y divide-navy-50 text-sm">
                {application.interviews.map((i) => (
                  <li key={i.id} className="py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-navy-900">{i.title}</span>
                      <Badge tone={i.status === "COMPLETED" ? "green" : "blue"}>
                        {i.status.toLowerCase().replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <p className="text-xs text-navy-500">
                      {fmt(i.scheduledAt)} · {i.durationMinutes} min ·{" "}
                      {i.participants.map((p) => p.user.name).join(", ")}
                      {i.kit ? ` · ${i.kit.name}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {application.offers.length > 0 && (
            <Card className="p-6">
              <h2 className="text-sm font-bold text-navy-900">Offers</h2>
              <ul className="mt-3 divide-y divide-navy-50 text-sm">
                {application.offers.map((o) => (
                  <li key={o.id} className="flex items-center justify-between py-2.5">
                    <Link
                      href={`/admin/recruiting/offers/${o.id}`}
                      className="font-medium text-fsw-700 hover:underline"
                    >
                      {o.reference} — {o.jobTitle}
                    </Link>
                    <Badge tone={o.status === "ACCEPTED" ? "green" : "neutral"}>
                      {o.status.toLowerCase().replace(/_/g, " ")}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <ReviewPanel
            applicationId={application.id}
            rounds={rounds as never}
            canOpenRound={manage}
            canSeeAll={canSeeAllReviews}
            teamOptions={teamUsers}
            kitOptions={kits}
          />

          <Card className="p-6">
            <h2 className="text-sm font-bold text-navy-900">History</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {application.stageEvents.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className="w-40 shrink-0 text-xs text-navy-400">
                    {fmt(e.occurredAt)}
                  </span>
                  <span className="text-navy-700">
                    {e.fromStageName ? `${e.fromStageName} → ` : ""}
                    <strong className="font-semibold text-navy-900">{e.stageName}</strong>
                    <span className="ml-2 text-xs text-navy-400">
                      {e.actor?.name ?? e.actorLabel ?? "System"}
                    </span>
                    {e.note && (
                      <span className="mt-0.5 block text-xs text-navy-500">{e.note}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          {can(user.role, "MANAGE_TALENT_POOL") && (
            <KeepInTouchPanel
              candidateId={application.candidateId}
              consentStatus={application.candidate.talentProfile?.consentStatus ?? null}
              askedAt={
                application.candidate.talentProfile?.consentAskedAt?.toISOString() ?? null
              }
              expiresAt={
                application.candidate.talentProfile?.expiresAt?.toISOString() ?? null
              }
            />
          )}

          <WorkSamplePanel
            applicationId={application.id}
            canManage={can(user.role, "MANAGE_WORK_SAMPLES")}
            available={activeWorkSamples.map((w) => ({ id: w.id, title: w.title }))}
            assigned={application.workSamples.map((a) => ({
              id: a.id,
              reference: a.reference,
              title: a.workSample.title,
              status: a.status,
              dueAt: a.dueAt.toISOString(),
              submittedAt: a.submittedAt?.toISOString() ?? null,
              gradesFiled: a.grades.filter((g) => g.status === "SUBMITTED").length,
              gradesRequired: a.workSample.requiredGraders,
            }))}
          />

          <ChecksPanel
            applicationId={application.id}
            socialEnabled={settings?.socialCheckEnabled ?? false}
            checkrConfigured={isCheckrConfigured()}
            canManageSocial={can(user.role, "MANAGE_SOCIAL_CHECKS")}
            canManageBackground={can(user.role, "MANAGE_BACKGROUND_CHECKS")}
            defaultPackage={settings?.checkrDefaultPackage ?? null}
            offerAccepted={application.offers.some((o) => o.status === "ACCEPTED")}
            stageKind={application.stage?.kind ?? null}
            reviewerOptions={eligibleReviewers.filter((r) => !deciderIds.has(r.id))}
            social={
              application.socialMediaCheck
                ? {
                    id: application.socialMediaCheck.id,
                    status: application.socialMediaCheck.status,
                    outcome: application.socialMediaCheck.outcome,
                    reviewerName: application.socialMediaCheck.reviewer?.name ?? null,
                    reviewerNotes: application.socialMediaCheck.reviewerNotes,
                    consentUrl: null,
                    findings: application.socialMediaCheck.findings.map((f) => ({
                      id: f.id,
                      category: f.category,
                      categoryLabel: categoryLabel(f.category),
                      description: f.description,
                    })),
                  }
                : null
            }
            background={
              bg
                ? {
                    id: bg.id,
                    status: bg.status,
                    result: bg.result,
                    packageSlug: bg.packageSlug,
                    invitationUrl: bg.invitationUrl,
                    adverseStage: bg.adverseStage,
                    preAdverseSentAt: bg.preAdverseSentAt?.toISOString() ?? null,
                    adverseGateReason: adverseGate?.reason ?? null,
                    adverseAllowed: adverseGate?.allowed ?? false,
                    events: bg.events.map((e) => ({
                      id: e.id,
                      type: e.type,
                      summary: e.summary,
                      occurredAt: e.occurredAt.toISOString(),
                    })),
                  }
                : null
            }
          />

          <ApplicationActions
            applicationId={application.id}
            status={application.status}
            currentStageId={application.stageId}
            stages={application.requisition.stages.map((s) => ({
              id: s.id,
              name: s.name,
              kind: s.kind,
            }))}
            reasons={reasons.map((r) => ({ id: r.id, label: r.label }))}
            canManage={manage}
          />

          <Card className="p-6">
            <h2 className="text-sm font-bold text-navy-900">Source</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Channel" value={application.channel?.name ?? "Unknown"} />
              {application.referredBy && (
                <Row label="Referred by" value={application.referredBy.name} />
              )}
              {application.sourceDetail != null &&
                Object.entries(application.sourceDetail as Record<string, string>).map(
                  ([k, v]) => <Row key={k} label={k} value={v} />,
                )}
            </dl>
          </Card>

          {attempt && (
            <Card className="p-6">
              <h2 className="text-sm font-bold text-navy-900">Assessment</h2>
              <p className="mt-2 text-sm text-navy-600">
                Status: {attempt.status.toLowerCase().replace(/_/g, " ")}
              </p>
              <Link
                href={`/admin/candidates/${attempt.id}`}
                className="mt-3 inline-block rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm font-semibold text-navy-800 hover:bg-navy-50"
              >
                Open assessment record
              </Link>
            </Card>
          )}

          {application.documents.length > 0 && (
            <Card className="p-6">
              <h2 className="text-sm font-bold text-navy-900">Documents</h2>
              <ul className="mt-2 space-y-1 text-sm text-navy-700">
                {application.documents.map((d) => (
                  <li key={d.id}>
                    {d.fileName}{" "}
                    <span className="text-xs text-navy-400">
                      {Math.round(d.sizeBytes / 1024)} KB
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {application.status === "REJECTED" && (
            <Card className="p-6">
              <h2 className="text-sm font-bold text-navy-900">Rejection</h2>
              <p className="mt-2 text-sm text-navy-700">
                {application.rejectionReason?.label ?? "No reason recorded"}
              </p>
              {application.rejectionNote && (
                <p className="mt-1 text-xs text-navy-500">{application.rejectionNote}</p>
              )}
              <p className="mt-1 text-xs text-navy-400">{fmt(application.rejectedAt)}</p>
            </Card>
          )}

          <Card className="p-6">
            <h2 className="text-sm font-bold text-navy-900">Notes</h2>
            <ul className="mt-3 space-y-3 text-sm">
              {application.notes.map((n) => (
                <li key={n.id}>
                  <p className="whitespace-pre-line text-navy-700">{n.body}</p>
                  <p className="mt-0.5 text-xs text-navy-400">
                    {n.author?.name ?? "Unknown"} · {fmt(n.createdAt)}
                  </p>
                </li>
              ))}
              {application.notes.length === 0 && (
                <li className="text-navy-400">No notes yet.</li>
              )}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-navy-500">{label}</dt>
      <dd className="truncate text-right font-medium text-navy-800">{value}</dd>
    </div>
  );
}
