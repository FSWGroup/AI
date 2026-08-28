import { requirePermission } from "@/lib/auth/guard";
import { listReportsForActor } from "@/lib/services/reports";
import { PageHeader, PageBody } from "@/components/page-header";
import { ReportCatalog } from "@/app/(app)/admin/reports/_shared/report-catalog";

export default async function AdminReportsCatalogPage() {
  const actor = await requirePermission("reports.view");
  const reports = listReportsForActor(actor);

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Server-paginated, exportable reports scoped to what you're allowed to see."
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "Reports" }]}
      />
      <PageBody>
        <ReportCatalog reports={reports} />
      </PageBody>
    </div>
  );
}
