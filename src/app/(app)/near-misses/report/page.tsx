import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { PageHeader, PageBody } from "@/components/page-header";
import { NearMissReportForm } from "@/app/(app)/near-misses/report/report-form";

export const metadata: Metadata = { title: "Report a Near Miss" };

export default async function ReportNearMissPage() {
  const actor = await requirePermission("nearmiss.report");

  const [departments, locations] = await Promise.all([
    prisma.department.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.location.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Report a near miss"
        description="Something that nearly went wrong, or did and was caught. No fault is recorded anywhere in this process — the point is the lesson, and lessons are the only thing published."
        crumbs={[
          { label: "Home", href: "/home" },
          ...(actor.permissions.has("nearmiss.view")
            ? [{ label: "Near Misses", href: "/near-misses" }]
            : []),
          { label: "Report" },
        ]}
      />
      <PageBody>
        <NearMissReportForm
          departments={departments}
          locations={locations}
          canViewLibrary={actor.permissions.has("nearmiss.view")}
        />
      </PageBody>
    </>
  );
}
