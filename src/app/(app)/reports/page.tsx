import { requirePermission } from "@/lib/auth/guard";
import { listReportsForActor } from "@/lib/services/reports";
import { PageHeader, PageBody } from "@/components/page-header";
import { ReportCatalog } from "@/app/(app)/admin/reports/_shared/report-catalog";

export default async function ReportsCatalogPage() {
  const actor = await requirePermission("reports.view");
  const reports = listReportsForActor(actor);

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Training, compliance, and skills reports scoped to your team. Managers see their reporting subtree only."
      />
      <PageBody>
        <ReportCatalog reports={reports} />
      </PageBody>
    </div>
  );
}
