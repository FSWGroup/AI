import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Badge, Card, SectionHeading } from "@/components/ui";
import { PipelineBoard, EmptyBoard } from "@/components/admin/PipelineBoard";
import { RequisitionActions } from "@/components/admin/RequisitionActions";
import { JobDescriptionLinter } from "@/components/admin/JobDescriptionLinter";
import { PastApplicantsPanel } from "@/components/admin/PastApplicantsPanel";
import { chainStatus, describeChain, type ApprovalStep } from "@/lib/ats/approvals";
import { summarizeScorecards } from "@/lib/ats/scorecards";
import { buildFunnel, formatRate, timeInStages } from "@/lib/ats/analytics";
import { analyzeFunnelImpact } from "@/lib/ats/stage-impact";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "pipeline", label: "Pipeline" },
  { key: "details", label: "Role details" },
  { key: "postings", label: "Posting & sourcing" },
  { key: "team", label: "Team & approvals" },
  { key: "insights", label: "Insights" },
];

const MS_PER_DAY = 86_400_000;

export default async function RequisitionPage({
  params,
  searchParams,
}: {
  params: Promise<{ requisitionId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "VIEW_REQUISITIONS")) redirect("/admin");
  const { requisitionId } = await params;
  const { tab = "pipeline" } = await searchParams;

  const requisition = await prisma.requisition.findUnique({
    where: { id: requisitionId },
    include: {
      department: true,
      location: true,
      jobProfile: { select: { id: true, name: true } },
      approvals: {
        orderBy: { stepIndex: "asc" },
        include: { approver: { select: { id: true, name: true, email: true } } },
      },
      team: { include: { user: { select: { id: true, name: true, email: true } } } },
      stages: { orderBy: { orderIndex: "asc" } },
      postings: { include: { channel: true } },
      screeningQuestions: { orderBy: { orderIndex: "asc" } },
      events: {
        orderBy: { occurredAt: "desc" },
        take: 25,
        include: { actor: { select: { name: true } } },
      },
    },
  });
  if (!requisition) notFound();

  const applications = await prisma.application.findMany({
    where: { requisitionId },
    include: {
      candidate: { select: { firstName: true, lastName: true } },
      channel: { select: { name: true } },
      stageEvents: { orderBy: { occurredAt: "desc" }, take: 1 },
      scorecards: {
        include: {
          author: { select: { name: true } },
          ratings: true,
        },
      },
      invitations: { select: { attempts: { select: { id: true } } } },
    },
    orderBy: { appliedAt: "desc" },
  });

  const stageEvents = await prisma.applicationStageEvent.findMany({
    where: { application: { requisitionId } },
    select: {
      applicationId: true,
      stageName: true,
      stageKind: true,
      occurredAt: true,
    },
  });

  const steps: ApprovalStep[] = requisition.approvals.map((a) => ({
    stepIndex: a.stepIndex,
    approverId: a.approverId,
    approverName: a.approver.name,
    decision: a.decision,
    comment: a.comment,
    decidedAt: a.decidedAt,
  }));
  const approval = chainStatus(steps);
  const manageAllowed = can(user.role, "MANAGE_REQUISITIONS");
  const moveAllowed = can(user.role, "MANAGE_PIPELINE");

  const cards = applications
    .filter((a) => a.status === "ACTIVE")
    .map((a) => {
      const lastMove = a.stageEvents[0]?.occurredAt ?? a.appliedAt;
      const summary = summarizeScorecards(
        a.scorecards.map((s) => ({
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
      return {
        id: a.id,
        reference: a.reference,
        candidateName: `${a.candidate.firstName} ${a.candidate.lastName}`,
        stageId: a.stageId,
        knockedOut: a.knockedOut,
        knockoutReason: a.knockoutReason,
        channelName: a.channel?.name ?? null,
        appliedAt: a.appliedAt.toISOString(),
        daysInStage: Math.max(
          0,
          Math.floor((Date.now() - lastMove.getTime()) / MS_PER_DAY),
        ),
        scorecardSummary:
          summary.submittedCount > 0
            ? `${summary.submittedCount} scorecard${summary.submittedCount === 1 ? "" : "s"}${summary.panelSplit ? " · panel split" : ""}`
            : null,
      };
    });

  const closed = applications.filter((a) => a.status !== "ACTIVE");

  // Funnel-wide adverse impact, only when the compliance module is on. The
  // demographic rows are joined by opaque reference and never leave here as
  // individual data.
  const settings = await prisma.orgSettings.findUnique({ where: { id: "org" } });
  let stageImpact: ReturnType<typeof analyzeFunnelImpact> | null = null;
  if (settings?.eeoModuleEnabled && applications.length > 0) {
    const attemptRefs = applications.flatMap((a) =>
      a.invitations.flatMap((i) => i.attempts.map((t) => t.id)),
    );
    const eeo = await prisma.eeoRecord.findMany({
      where: { attemptRef: { in: attemptRefs } },
      select: { attemptRef: true, data: true },
    });
    const byAttempt = new Map(eeo.map((e) => [e.attemptRef, e.data as Record<string, string>]));
    stageImpact = analyzeFunnelImpact({
      orderedStages: requisition.stages.map((s) => ({ name: s.name, kind: s.kind })),
      reach: stageEvents.map((e) => ({
        applicationId: e.applicationId,
        stageName: e.stageName,
      })),
      people: applications.map((a) => {
        const ref = a.invitations.flatMap((i) => i.attempts.map((t) => t.id))[0];
        return {
          applicationId: a.id,
          demographics: ref ? (byAttempt.get(ref) ?? null) : null,
        };
      }),
      categories: [
        { key: "sex", label: "Sex" },
        { key: "raceEthnicity", label: "Race / ethnicity" },
      ],
    });
  }
  const funnel = buildFunnel(
    requisition.stages.map((s) => ({ name: s.name, kind: s.kind })),
    stageEvents,
  );
  const durations = timeInStages(stageEvents);

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/admin/recruiting"
        className="text-sm font-semibold text-fsw-700 hover:underline"
      >
        ← All requisitions
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <SectionHeading
          eyebrow={`${requisition.reference} · ${requisition.department?.name ?? "No department"}`}
          title={requisition.title}
          description={`${requisition.location?.name ?? "No location"} · ${requisition.employmentType.replace(/_/g, " ").toLowerCase()} · ${requisition.workArrangement.toLowerCase()} · ${requisition.openings} opening${requisition.openings === 1 ? "" : "s"}`}
        />
        <Badge
          tone={
            requisition.status === "OPEN"
              ? "green"
              : requisition.status === "PENDING_APPROVAL"
                ? "amber"
                : requisition.status === "REJECTED"
                  ? "red"
                  : "neutral"
          }
        >
          {requisition.status.replace(/_/g, " ").toLowerCase()}
        </Badge>
      </div>

      <nav
        className="mt-6 flex flex-wrap gap-1 border-b border-navy-100"
        aria-label="Requisition tabs"
      >
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/recruiting/requisitions/${requisition.id}?tab=${t.key}`}
            className={`rounded-t-lg px-4 py-2 text-sm font-semibold ${
              tab === t.key
                ? "border border-b-0 border-navy-100 bg-white text-navy-900"
                : "text-navy-500 hover:text-navy-800"
            }`}
            aria-current={tab === t.key ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6 space-y-6">
        {tab === "pipeline" && (
          <>
            {/* Before sourcing anyone new: who did we already meet? */}
            {can(user.role, "MANAGE_TALENT_POOL") && (
              <PastApplicantsPanel requisitionId={requisition.id} />
            )}
            {applications.length === 0 ? (
              <EmptyBoard />
            ) : (
              <PipelineBoard
                stages={requisition.stages.map((s) => ({
                  id: s.id,
                  name: s.name,
                  kind: s.kind,
                  orderIndex: s.orderIndex,
                }))}
                cards={cards}
                canMove={moveAllowed}
              />
            )}
            {closed.length > 0 && (
              <Card className="p-6">
                <h3 className="text-sm font-bold text-navy-900">
                  Closed applications ({closed.length})
                </h3>
                <ul className="mt-3 divide-y divide-navy-50 text-sm">
                  {closed.slice(0, 25).map((a) => (
                    <li key={a.id} className="flex items-center justify-between py-2">
                      <Link
                        href={`/admin/recruiting/applications/${a.id}`}
                        className="font-medium text-fsw-700 hover:underline"
                      >
                        {a.candidate.firstName} {a.candidate.lastName}
                      </Link>
                      <Badge
                        tone={
                          a.status === "HIRED"
                            ? "green"
                            : a.status === "WITHDRAWN"
                              ? "neutral"
                              : "amber"
                        }
                      >
                        {a.status.toLowerCase()}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}

        {tab === "details" && (
          <>
            <JobDescriptionLinter requisitionId={requisition.id} />
            <Card className="p-6">
              <h3 className="text-sm font-bold text-navy-900">Public description</h3>
              <dl className="mt-4 space-y-4 text-sm">
                <Field label="Summary" value={requisition.summary} />
                <Field label="About the role" value={requisition.description} />
                <Field label="Responsibilities" value={requisition.responsibilities} />
                <Field label="Requirements" value={requisition.requirements} />
                <Field label="Benefits" value={requisition.benefits} />
              </dl>
            </Card>
            <Card className="p-6">
              <h3 className="text-sm font-bold text-navy-900">Compensation</h3>
              <p className="mt-2 text-sm text-navy-700">
                {requisition.salaryMin != null && requisition.salaryMax != null
                  ? `${requisition.salaryCurrency} ${requisition.salaryMin.toLocaleString()}–${requisition.salaryMax.toLocaleString()} per ${requisition.salaryPeriod.toLowerCase()}`
                  : "No range set."}
              </p>
              <p className="mt-1 text-xs text-navy-500">
                {requisition.salaryPublish
                  ? "Published on the careers page and job feeds."
                  : "Held internally. Publishing a range is required in a growing number of jurisdictions and tends to improve applicant quality everywhere else."}
              </p>
            </Card>
            {requisition.screeningQuestions.length > 0 && (
              <Card className="p-6">
                <h3 className="text-sm font-bold text-navy-900">Screening questions</h3>
                <ul className="mt-3 space-y-3 text-sm">
                  {requisition.screeningQuestions.map((q) => (
                    <li key={q.id}>
                      <p className="font-medium text-navy-900">{q.prompt}</p>
                      <p className="text-xs text-navy-500">
                        {q.kind.replace(/_/g, " ").toLowerCase()}
                        {q.required ? " · required" : " · optional"}
                        {q.knockout
                          ? ` · flags for review when ${q.knockoutOperator?.toLowerCase()} ${q.knockoutValue}`
                          : ""}
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs leading-relaxed text-navy-500">
                  A flagged answer marks the application for a recruiter to look
                  at. It never rejects anyone and never hides them from the board.
                </p>
              </Card>
            )}
            {requisition.jobProfile && (
              <Card className="p-6">
                <h3 className="text-sm font-bold text-navy-900">Assessment benchmark</h3>
                <p className="mt-2 text-sm text-navy-700">
                  Candidates reaching an assessment stage are measured against{" "}
                  <Link
                    href={`/admin/jobs/${requisition.jobProfile.id}`}
                    className="font-semibold text-fsw-700 hover:underline"
                  >
                    {requisition.jobProfile.name}
                  </Link>
                  .
                </p>
              </Card>
            )}
          </>
        )}

        {tab === "postings" && (
          <Card className="p-6">
            <h3 className="text-sm font-bold text-navy-900">Where this role is posted</h3>
            {requisition.postings.length === 0 ? (
              <p className="mt-2 text-sm text-navy-500">
                Not published anywhere yet.
              </p>
            ) : (
              <table className="mt-3 w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-navy-400">
                  <tr>
                    <th className="py-2">Channel</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Published</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-50">
                  {requisition.postings.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2 font-medium text-navy-800">{p.channel.name}</td>
                      <td className="py-2">
                        <Badge tone={p.status === "PUBLISHED" ? "green" : "neutral"}>
                          {p.status.toLowerCase()}
                        </Badge>
                      </td>
                      <td className="py-2 text-navy-500">
                        {p.publishedAt
                          ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(p.publishedAt)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <RequisitionActions
              requisitionId={requisition.id}
              reference={requisition.reference}
              status={requisition.status}
              canManage={manageAllowed}
              canApprove={approval.currentStep?.approverId === user.id}
              section="postings"
            />
          </Card>
        )}

        {tab === "team" && (
          <>
            <Card className="p-6">
              <h3 className="text-sm font-bold text-navy-900">Approval</h3>
              <p className="mt-1 text-sm text-navy-600">{describeChain(steps)}</p>
              {steps.length > 0 && (
                <ol className="mt-4 space-y-2 text-sm">
                  {steps.map((s) => (
                    <li
                      key={s.stepIndex}
                      className="flex items-center justify-between rounded-lg border border-navy-100 px-3 py-2"
                    >
                      <span>
                        <span className="font-medium text-navy-900">
                          {s.approverName}
                        </span>
                        {s.comment && (
                          <span className="ml-2 text-xs text-navy-500">
                            &ldquo;{s.comment}&rdquo;
                          </span>
                        )}
                      </span>
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
              <RequisitionActions
                requisitionId={requisition.id}
                reference={requisition.reference}
                status={requisition.status}
                canManage={manageAllowed}
                canApprove={approval.currentStep?.approverId === user.id}
                section="approval"
              />
            </Card>

            <Card className="p-6">
              <h3 className="text-sm font-bold text-navy-900">Hiring team</h3>
              {requisition.team.length === 0 ? (
                <p className="mt-2 text-sm text-navy-500">Nobody assigned yet.</p>
              ) : (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {requisition.team.map((m) => (
                    <li key={m.id} className="flex justify-between">
                      <span className="text-navy-800">{m.user.name}</span>
                      <span className="text-xs uppercase tracking-wide text-navy-400">
                        {m.role.replace(/_/g, " ").toLowerCase()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-6">
              <h3 className="text-sm font-bold text-navy-900">Activity</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {requisition.events.map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <span className="w-32 shrink-0 text-xs text-navy-400">
                      {new Intl.DateTimeFormat("en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(e.occurredAt)}
                    </span>
                    <span className="text-navy-700">{e.summary}</span>
                  </li>
                ))}
                {requisition.events.length === 0 && (
                  <li className="text-navy-400">Nothing yet.</li>
                )}
              </ul>
            </Card>
          </>
        )}

        {tab === "insights" && (
          <>
            {stageImpact && (
              <Card className="p-6">
                <h3 className="text-sm font-bold text-navy-900">
                  Pass-through rates by group
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-navy-500">
                  The four-fifths screen applied at every stage, not only the
                  assessment. Any step used as a basis for an employment
                  decision is a selection procedure — and the larger disparity
                  is usually at the least structured one. A ratio below 0.80 is
                  a prompt to examine that stage, never a finding about it.
                </p>
                <div className="mt-4 space-y-4">
                  {stageImpact.map((s) => (
                    <div key={s.stageName} className="rounded-xl border border-navy-100 p-4">
                      <p className="text-sm font-semibold text-navy-900">{s.stageName}</p>
                      {s.insufficientReason ? (
                        <p className="mt-1 text-xs text-navy-500">
                          {s.insufficientReason}
                        </p>
                      ) : (
                        s.categories.map((c) => (
                          <div key={c.category} className="mt-3">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-semibold uppercase tracking-wide text-navy-500">
                                {c.category}
                              </p>
                              {c.flagged && <Badge tone="red">Below four-fifths</Badge>}
                            </div>
                            <table className="mt-1.5 w-full text-left text-xs">
                              <tbody className="divide-y divide-navy-50">
                                {c.groups.map((g) => (
                                  <tr key={g.group}>
                                    <td className="py-1 text-navy-700">
                                      {g.group.replace(/_/g, " ").toLowerCase()}
                                    </td>
                                    <td className="py-1 text-right text-navy-500">
                                      {g.selected}/{g.applicants}
                                    </td>
                                    <td className="py-1 text-right font-semibold text-navy-800">
                                      {g.status === "REFERENCE"
                                        ? "reference"
                                        : g.impactRatio == null
                                          ? "—"
                                          : g.impactRatio.toFixed(2)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                  Discuss any flagged stage with counsel before acting on it.
                  These ratios describe this one requisition&rsquo;s sample and
                  are not a legal conclusion.
                </p>
              </Card>
            )}
            <Card className="p-6">
              <h3 className="text-sm font-bold text-navy-900">Funnel</h3>
              <p className="mt-1 text-xs text-navy-500">
                Counts every application that ever reached a stage, so the numbers
                show where people fall out rather than where they happen to sit
                now. Conversion is withheld below ten.
              </p>
              <table className="mt-3 w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-navy-400">
                  <tr>
                    <th className="py-2">Stage</th>
                    <th className="py-2 text-right">Reached</th>
                    <th className="py-2 text-right">Advanced</th>
                    <th className="py-2 text-right">Conversion</th>
                    <th className="py-2 text-right">Median days</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-50">
                  {funnel.map((f) => {
                    const d = durations.find((x) => x.stageName === f.stageName);
                    return (
                      <tr key={f.stageName}>
                        <td className="py-2 font-medium text-navy-800">{f.stageName}</td>
                        <td className="py-2 text-right text-navy-600">{f.reached}</td>
                        <td className="py-2 text-right text-navy-600">{f.advanced}</td>
                        <td className="py-2 text-right text-navy-600">
                          {formatRate(f.conversionRate)}
                        </td>
                        <td className="py-2 text-right text-navy-600">
                          {d?.medianDays == null ? "—" : Math.round(d.medianDays)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-navy-400">
        {label}
      </dt>
      <dd className="mt-1 whitespace-pre-line leading-relaxed text-navy-700">
        {value}
      </dd>
    </div>
  );
}
