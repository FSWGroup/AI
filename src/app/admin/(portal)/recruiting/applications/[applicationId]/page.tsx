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
      candidate: true,
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
      invitations: {
        include: { attempts: { select: { id: true, status: true } } },
      },
      referenceChecks: { orderBy: { createdAt: "desc" } },
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
