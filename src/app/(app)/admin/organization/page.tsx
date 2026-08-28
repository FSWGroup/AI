import Link from "next/link";
import { requirePermission } from "@/lib/auth/guard";
import {
  listBusinessUnits,
  listDepartments,
  listLocations,
  listPositions,
  listTeams,
} from "@/lib/services/org";
import { PageHeader, PageBody } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icons";
import { OrgTabs } from "@/app/(app)/admin/organization/org-tabs";

export const metadata = { title: "Organization Structure" };

export default async function OrganizationPage() {
  const actor = await requirePermission("org.manage");

  const [businessUnits, departments, teams, locations, positions] = await Promise.all([
    listBusinessUnits(actor),
    listDepartments(actor),
    listTeams(actor),
    listLocations(actor),
    listPositions(actor),
  ]);

  return (
    <>
      <PageHeader
        title="Organization structure"
        description="Business units, departments, teams, locations, and positions."
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "Organization" }]}
        actions={
          <Link href="/admin/organization/chart">
            <Button variant="outline">
              <Icon name="org" className="h-4 w-4" /> View org chart
            </Button>
          </Link>
        }
      />
      <PageBody>
        <OrgTabs businessUnits={businessUnits} departments={departments} teams={teams} locations={locations} positions={positions} />
      </PageBody>
    </>
  );
}
