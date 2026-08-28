import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can, canAccessRecordings } from "@/lib/auth/rbac";
import { scopedJobProfileIds } from "@/lib/auth/scope";
import { Badge, Card, SectionHeading } from "@/components/ui";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { AdminActions } from "@/components/admin/AdminActions";
import { AiAnalysisPanel } from "@/components/admin/AiAnalysisPanel";
import { RecordingViewer } from "@/components/admin/RecordingViewer";
import { ScoreTable } from "@/components/admin/ScoreTable";
import { summarizeIntegrity, INTEGRITY_LABELS } from "@/lib/scoring/integrity";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "results", label: "Results" },
  { key: "report", label: "Narrative Report" },
  { key: "ai", label: "Résumé & AI Brief" },
  { key: "integrity", label: "Integrity" },
  { key: "recording", label: "Recording" },
  { key: "admin", label: "Administration" },
];

export default async function CandidateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "VIEW_CANDIDATES")) redirect("/admin");
  const { attemptId } = await params;
  const { tab = "overview" } = await searchParams;

  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      candidate: { include: { notes: { include: { author: true }, orderBy: { createdAt: "desc" } } } },
      jobOpening: { include: { jobProfile: { include: { benchmarks: true } } } },
      assessmentVersion: true,
      invitation: true,
      scores: true,
      sections: { orderBy: { orderIndex: "asc" } },
      integrityEvents: { orderBy: { occurredAt: "asc" } },
      consents: true,
      recordings: { include: { chunks: { select: { status: true } } } },
      reports: { where: { status: "READY" }, orderBy: { version: "desc" } },
      accommodations: true,
    },
  });
  if (!attempt) notFound();

  const scopedIds = await scopedJobProfileIds(user);
  if (scopedIds !== null && !scopedIds.includes(attempt.jobOpening.jobProfileId)) {
    redirect("/admin/candidates");
  }

  const settings = await prisma.orgSettings.findUnique({ where: { id: "org" } });
  const recordingAllowed = canAccessRecordings(
    user.role,
    settings?.recordingAccessRoles ?? ["SUPER_ADMIN", "HR_ADMIN"],
  );
  const manageAllowed = can(user.role, "MANAGE_ATTEMPTS");

  const counts = new Map<string, number>();
  for (const e of attempt.integrityEvents) {
    counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  }
  const integrity = summarizeIntegrity(
    [...counts.entries()].map(([type, count]) => ({ type, count })),
  );
  const fmt = (d: Date | null | undefined) =>
    d
      ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(d)
      : "—";

  const visibleTabs = TABS.filter((t) => {
    if (t.key === "recording") return recordingAllowed;
    if (t.key === "admin") return manageAllowed;
    return true;
  });

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeading
          eyebrow={attempt.jobOpening.title}
          title={`${attempt.candidate.firstName} ${attempt.candidate.lastName}`}
          description={`Record ID ${attempt.recordId} · Attempt ${attempt.attemptNumber} · ${attempt.assessmentVersion.name} v${attempt.assessmentVersion.versionNumber}`}
        />
        <StatusBadge status={attempt.status} />
      </div>

      <nav className="mt-6 flex flex-wrap gap-1 border-b border-navy-100" aria-label="Candidate tabs">
        {visibleTabs.map((t) => (
          <Link
            key={t.key}
            href={`/admin/candidates/${attempt.id}?tab=${t.key}`}
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
        {tab === "overview" && (
          <>
            <Card className="p-6">
              <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
                <Item label="Email" value={attempt.candidate.email} />
                <Item label="Phone" value={attempt.candidate.phone ?? "—"} />
                <Item label="Invited" value={fmt(attempt.invitation.createdAt)} />
                <Item label="Started" value={fmt(attempt.startedAt)} />
                <Item label="Completed" value={fmt(attempt.completedAt)} />
                <Item
                  label="Integrity"
                  value={INTEGRITY_LABELS[integrity.level]}
                />
              </dl>
            </Card>
            <Card className="p-6">
              <h3 className="text-sm font-bold text-navy-900">Sections</h3>
              <table className="mt-3 w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-navy-400">
                  <tr>
                    <th className="py-2">Section</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Started</th>
                    <th className="py-2">Finished</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-50">
                  {attempt.sections.map((s) => (
                    <tr key={s.id}>
                      <td className="py-2 font-medium text-navy-800">{s.sectionKey}</td>
                      <td className="py-2">
                        <Badge tone={s.status === "COMPLETED" ? "green" : s.status === "EXPIRED" ? "amber" : "neutral"}>
                          {s.status}
                        </Badge>
                      </td>
                      <td className="py-2 text-navy-500">{fmt(s.startedAt)}</td>
                      <td className="py-2 text-navy-500">{fmt(s.completedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            {attempt.accommodations.length > 0 && (
              <Card className="p-6">
                <h3 className="text-sm font-bold text-navy-900">Accommodations</h3>
                <ul className="mt-2 space-y-1 text-sm text-navy-600">
                  {attempt.accommodations.map((a) => (
                    <li key={a.id}>
                      {a.type.replaceAll("_", " ")}
                      {a.timeMultiplier ? ` (×${a.timeMultiplier})` : ""}
                      {a.note ? ` — ${a.note}` : ""}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}

        {tab === "results" && (
          <ScoreTable
            scores={attempt.scores.map((s) => ({
              construct: s.construct,
              band: s.band,
              bandType: s.bandType,
              rawScore: s.rawScore,
              scaledScore: s.scaledScore,
            }))}
            benchmarks={attempt.jobOpening.jobProfile.benchmarks.map((b) => ({
              construct: b.construct,
              minScore: b.minScore,
              maxScore: b.maxScore,
              enabled: b.enabled,
            }))}
          />
        )}

        {tab === "report" &&
          (attempt.reports.length > 0 ? (
            <Card className="p-6">
              <p className="text-sm text-navy-600">
                Report v{attempt.reports[0].version} generated{" "}
                {fmt(attempt.reports[0].generatedAt)}.
              </p>
              <div className="mt-4 flex gap-3">
                <Link
                  href={`/admin/candidates/${attempt.id}/report`}
                  className="rounded-lg bg-fsw-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fsw-700"
                >
                  Open web report
                </Link>
                <a
                  href={`/api/admin/attempts/${attempt.id}/pdf`}
                  className="rounded-lg border border-navy-200 bg-white px-4 py-2.5 text-sm font-semibold text-navy-800 hover:bg-navy-50"
                >
                  Download PDF
                </a>
              </div>
            </Card>
          ) : (
            <Card className="p-8 text-center text-sm text-navy-400">
              The report becomes available when the assessment is completed.
            </Card>
          ))}

        {tab === "integrity" && (
          <>
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-navy-900">Integrity summary</h3>
                <Badge
                  tone={
                    integrity.level === "NO_NOTABLE_EVENTS"
                      ? "green"
                      : integrity.level === "MINOR_REVIEW_RECOMMENDED"
                        ? "amber"
                        : "red"
                  }
                >
                  {INTEGRITY_LABELS[integrity.level]}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-navy-500">
                Only objective events are recorded. The recording is never
                analyzed, and integrity information never changes scores — a
                human decides whether follow-up is needed.
              </p>
            </Card>
            <Card className="max-h-[32rem] overflow-y-auto p-6">
              <h3 className="text-sm font-bold text-navy-900">Event log</h3>
              <table className="mt-3 w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-navy-400">
                  <tr>
                    <th className="py-2">Time</th>
                    <th className="py-2">Event</th>
                    <th className="py-2">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-50">
                  {attempt.integrityEvents.map((e) => (
                    <tr key={e.id}>
                      <td className="py-2 text-navy-500">{fmt(e.occurredAt)}</td>
                      <td className="py-2 font-mono text-xs font-semibold text-navy-800">
                        {e.type}
                      </td>
                      <td className="py-2 text-xs text-navy-500">
                        {e.meta ? JSON.stringify(e.meta) : ""}
                      </td>
                    </tr>
                  ))}
                  {attempt.integrityEvents.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-navy-400">
                        No events recorded.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
            <Card className="p-6">
              <h3 className="text-sm font-bold text-navy-900">Consent records</h3>
              <ul className="mt-2 space-y-1 text-sm text-navy-600">
                {attempt.consents.map((c) => (
                  <li key={c.id}>
                    {c.consentType} — notice v{c.noticeVersion} — {fmt(c.consentedAt)}
                  </li>
                ))}
                {attempt.consents.length === 0 && <li className="text-navy-400">None yet.</li>}
              </ul>
            </Card>
          </>
        )}

        {tab === "ai" && <AiAnalysisPanel attemptId={attempt.id} />}

        {tab === "recording" && recordingAllowed && (
          <RecordingViewer attemptId={attempt.id} />
        )}

        {tab === "admin" && manageAllowed && (
          <AdminActions
            attemptId={attempt.id}
            status={attempt.status}
            notes={attempt.candidate.notes.map((n) => ({
              id: n.id,
              body: n.body,
              author: n.author?.name ?? "Unknown",
              createdAt: n.createdAt.toISOString(),
            }))}
          />
        )}
      </div>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-navy-400">
        {label}
      </dt>
      <dd className="mt-0.5 font-medium text-navy-900">{value}</dd>
    </div>
  );
}
