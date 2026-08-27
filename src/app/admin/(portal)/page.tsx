import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { attemptScopeWhere } from "@/lib/auth/scope";
import { Card, Badge, SectionHeading } from "@/components/ui";
import { StatusBadge } from "@/components/admin/StatusBadge";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  const scope = await attemptScopeWhere(user);

  const [
    openings,
    invitationsSent,
    notStarted,
    inProgress,
    completed,
    reviewRecommended,
    reportsReady,
    settings,
  ] = await Promise.all([
    prisma.jobOpening.count({ where: { status: "OPEN" } }),
    prisma.invitation.count(),
    prisma.attempt.count({ where: { ...scope, status: "NOT_STARTED" } }),
    prisma.attempt.count({
      where: { ...scope, status: { in: ["IN_PROGRESS", "INTERRUPTED"] } },
    }),
    prisma.attempt.count({ where: { ...scope, status: "COMPLETED" } }),
    prisma.integrityEvent.groupBy({
      by: ["attemptId"],
      where: { type: { in: ["CAMERA_INTERRUPTED", "TAB_HIDDEN", "COPY_ATTEMPT"] } },
      _count: true,
    }),
    prisma.report.count({ where: { status: "READY" } }),
    prisma.orgSettings.findUnique({ where: { id: "org" } }),
  ]);

  const stats = [
    { label: "Active openings", value: openings },
    { label: "Invitations sent", value: invitationsSent },
    { label: "Not started", value: notStarted },
    { label: "In progress", value: inProgress },
    { label: "Completed", value: completed },
    {
      label: "Integrity events to review",
      value: reviewRecommended.filter((r) => r._count >= 3).length,
    },
    { label: "Reports ready", value: reportsReady },
  ];

  const recent = await prisma.attempt.findMany({
    where: scope,
    orderBy: { updatedAt: "desc" },
    take: 8,
    include: {
      candidate: true,
      jobOpening: true,
      reports: { where: { status: "READY" }, take: 1 },
    },
  });

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeading
          eyebrow={settings?.companyName ?? "FSW Group"}
          title="Dashboard"
          description="Assessment pipeline at a glance."
        />
        <Link
          href="/admin/candidates/invite"
          className="rounded-lg bg-fsw-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fsw-700"
        >
          Invite candidate
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-2xl font-bold text-navy-900">{s.value}</p>
            <p className="mt-1 text-xs font-medium text-navy-500">{s.label}</p>
          </Card>
        ))}
      </div>

      <div className="mt-8">
        <SectionHeading title="Recent activity" />
        <Card className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-400">
              <tr>
                <th className="px-4 py-3">Candidate</th>
                <th className="px-4 py-3">Position</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Report</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-50">
              {recent.map((a) => (
                <tr key={a.id} className="hover:bg-navy-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/candidates/${a.id}`}
                      className="font-semibold text-fsw-700 hover:underline"
                    >
                      {a.candidate.firstName} {a.candidate.lastName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-navy-600">{a.jobOpening.title}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={a.status} />
                  </td>
                  <td className="px-4 py-3">
                    {a.reports.length > 0 ? (
                      <Badge tone="green">Ready</Badge>
                    ) : (
                      <span className="text-navy-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-navy-400">
                    No assessment activity yet. Invite a candidate to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
