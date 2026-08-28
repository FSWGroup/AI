import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { NewPersonForm } from "@/app/(app)/admin/people/new/new-person-form";

export const metadata = { title: "New Person" };

export default async function NewPersonPage() {
  await requirePermission("people.edit");

  const [businessUnits, departments, teams, positions, locations, managers] = await Promise.all([
    prisma.businessUnit.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.department.findMany({
      where: { isActive: true },
      select: { id: true, name: true, businessUnitId: true },
      orderBy: { name: "asc" },
    }),
    prisma.team.findMany({
      where: { isActive: true },
      select: { id: true, name: true, departmentId: true },
      orderBy: { name: "asc" },
    }),
    prisma.position.findMany({
      where: { isActive: true },
      select: { id: true, title: true, departmentId: true },
      orderBy: { title: "asc" },
    }),
    prisma.location.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }),
  ]);

  return (
    <>
      <PageHeader
        title="New person"
        description="Creates the account, assigns default roles, and evaluates assignment rules and position requirements right away."
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "People", href: "/admin/people" }, { label: "New" }]}
      />
      <PageBody>
        <Card className="mx-auto max-w-3xl">
          <CardContent>
            <NewPersonForm options={{ businessUnits, departments, teams, positions, locations, managers }} />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
