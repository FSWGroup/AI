import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/people/badges";
import { EditPersonForm, type EditablePerson } from "@/app/(app)/admin/people/[id]/edit/edit-person-form";
import { RolesEditor } from "@/app/(app)/admin/people/[id]/edit/roles-editor";
import { SensitiveFieldEditor } from "@/app/(app)/admin/people/[id]/edit/sensitive-field-editor";
import { StatusActions } from "@/app/(app)/admin/people/[id]/edit/status-actions";
import { formatIsoDate } from "@/lib/dates";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id }, select: { name: true } });
  return { title: user ? `Edit ${user.name}` : "Edit person" };
}

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("people.edit");
  const { id } = await params;

  const [user, businessUnits, departments, teams, positions, locations, managers, allRoles, userRoles, sensitiveDefs] =
    await Promise.all([
      prisma.user.findUnique({ where: { id } }),
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
      prisma.role.findMany({ select: { key: true, name: true, description: true }, orderBy: { name: "asc" } }),
      prisma.userRole.findMany({ where: { userId: id }, select: { role: { select: { key: true } } } }),
      prisma.sensitiveFieldDefinition.findMany({ where: { isActive: true }, orderBy: { label: "asc" } }),
    ]);

  if (!user) notFound();

  const editable: EditablePerson = {
    id: user.id,
    name: user.name,
    title: user.title,
    legalName: user.legalName,
    personalEmail: user.personalEmail,
    workPhone: user.workPhone,
    mobilePhone: user.mobilePhone,
    employeeId: user.employeeId,
    workerType: user.workerType,
    country: user.country,
    state: user.state,
    startDateIso: user.startDate ? formatIsoDate(user.startDate, "UTC") : null,
    businessUnitId: user.businessUnitId,
    departmentId: user.departmentId,
    teamId: user.teamId,
    positionId: user.positionId,
    locationId: user.locationId,
    managerId: user.managerId,
  };

  return (
    <>
      <PageHeader
        title={`Edit ${user.name}`}
        crumbs={[
          { label: "Admin", href: "/admin" },
          { label: "People", href: "/admin/people" },
          { label: user.name, href: `/people/${user.id}` },
          { label: "Edit" },
        ]}
        meta={<StatusBadge status={user.status} />}
        actions={<StatusActions userId={user.id} status={user.status} name={user.name} />}
      />
      <PageBody className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <EditPersonForm person={editable} options={{ businessUnits, departments, teams, positions, locations, managers }} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Roles</CardTitle>
          </CardHeader>
          <CardContent>
            <RolesEditor userId={user.id} allRoles={allRoles} currentRoleKeys={userRoles.map((r) => r.role.key)} />
          </CardContent>
        </Card>

        {actor.permissions.has("people.sensitive_edit") && (
          <Card>
            <CardHeader>
              <CardTitle>Sensitive fields</CardTitle>
            </CardHeader>
            <CardContent>
              <SensitiveFieldEditor userId={user.id} definitions={sensitiveDefs} />
            </CardContent>
          </Card>
        )}
      </PageBody>
    </>
  );
}
