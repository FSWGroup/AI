import { requirePermission } from "@/lib/auth/guard";
import { getOrgChart } from "@/lib/services/org";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";
import { OrgChartTree } from "@/components/org/org-chart-tree";

export const metadata = { title: "Org Chart" };

export default async function OrgChartPage() {
  const actor = await requirePermission("org.view");
  const nodes = await getOrgChart(actor);

  return (
    <>
      <PageHeader
        title="Org chart"
        description="The reporting tree, scoped to what you can see. Expand a node to see its reports, or open a profile."
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "Organization", href: "/admin/organization" }, { label: "Chart" }]}
      />
      <PageBody>
        {nodes.length === 0 ? (
          <EmptyState
            icon={<Icon name="org" className="h-5 w-5" />}
            title="No reporting structure yet"
            description="Set manager relationships on people records to build the org chart."
          />
        ) : (
          <Card>
            <CardContent>
              <OrgChartTree nodes={nodes} />
            </CardContent>
          </Card>
        )}
      </PageBody>
    </>
  );
}
