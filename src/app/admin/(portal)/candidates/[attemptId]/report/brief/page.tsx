import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { scopedJobProfileIds } from "@/lib/auth/scope";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { ManagerBrief } from "@/components/report/ManagerBrief";
import { PrintButton } from "@/components/admin/PrintButton";
import { buildManagerBrief } from "@/lib/report/manager-brief";
import type { ReportPayload } from "@/lib/report/generate";

export const dynamic = "force-dynamic";

/**
 * The condensed brief carries the same permission gate and the same audit
 * entry as the full report — it is the same data, so it gets the same
 * controls.
 */
export default async function ManagerBriefPage({
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
    newValue: { view: "manager_brief" },
  });

  const brief = buildManagerBrief(report.payload as unknown as ReportPayload);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/admin/candidates/${attemptId}`}
          className="text-sm font-semibold text-fsw-700 hover:underline"
        >
          ← Back to candidate
        </Link>
        <div className="flex gap-2">
          <PrintButton />
          <Link
            href={`/admin/candidates/${attemptId}/report`}
            className="rounded-lg bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800"
          >
            Full report
          </Link>
        </div>
      </div>
      <ManagerBrief brief={brief} />
    </div>
  );
}
