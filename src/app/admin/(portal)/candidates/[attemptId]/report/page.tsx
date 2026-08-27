import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { scopedJobProfileIds } from "@/lib/auth/scope";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { ReportView } from "@/components/report/ReportView";
import type { ReportPayload } from "@/lib/report/generate";

export const dynamic = "force-dynamic";

export default async function AdminReportPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "VIEW_REPORTS")) redirect("/admin");
  const { attemptId } = await params;

  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    select: { id: true, jobOpening: { select: { jobProfileId: true } } },
  });
  if (!attempt) notFound();
  const scoped = await scopedJobProfileIds(user);
  if (scoped !== null && !scoped.includes(attempt.jobOpening.jobProfileId)) {
    redirect("/admin/candidates");
  }

  const report = await prisma.report.findFirst({
    where: { attemptId, status: "READY" },
    orderBy: { version: "desc" },
  });
  if (!report?.payload) notFound();

  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.REPORT_VIEWED,
    entityType: "Report",
    entityId: report.id,
  });

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/admin/candidates/${attemptId}`}
          className="text-sm font-semibold text-fsw-700 hover:underline"
        >
          ← Back to candidate
        </Link>
        <a
          href={`/api/admin/attempts/${attemptId}/pdf`}
          className="rounded-lg bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800"
        >
          Download PDF
        </a>
      </div>
      <ReportView payload={report.payload as unknown as ReportPayload} />
    </div>
  );
}
