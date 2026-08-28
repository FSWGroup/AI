import { requireActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { PERMISSIONS, PERMISSION_GROUPS, type Permission } from "@/lib/permissions";
import { SectionHeading } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";
import { RolesGrid, type RoleColumn, type PermissionGroup } from "@/app/(app)/admin/settings/roles/roles-grid";

export default async function RolesSettingsPage() {
  const actor = await requireActor();

  const roles = await prisma.role.findMany({
    orderBy: { name: "asc" },
    include: { permissions: { select: { permission: true } } },
  });

  if (roles.length === 0) {
    return (
      <div>
        <SectionHeading title="Roles & permissions" description="Grid of roles versus permission groups." />
        <EmptyState
          icon={<Icon name="approval" className="h-5 w-5" />}
          title="No roles exist yet"
          description="Roles are seeded when the platform is installed. Run the seed script, or contact your platform administrator."
        />
      </div>
    );
  }

  const roleColumns: RoleColumn[] = roles.map((r) => ({
    id: r.id,
    name: r.name,
    isSystem: r.isSystem,
    permissions: r.permissions.map((p) => p.permission as Permission),
  }));

  const groups: PermissionGroup[] = PERMISSION_GROUPS.map((group) => ({
    label: group.label,
    permissions: (Object.keys(PERMISSIONS) as Permission[])
      .filter((key) => key.startsWith(group.prefix))
      .map((key) => ({ key, description: PERMISSIONS[key] })),
  }));

  return (
    <div>
      <SectionHeading
        title="Roles & permissions"
        description="Check the permissions each role holds. Changes are audited and take effect on each person's next request."
      />
      <div className="mt-4">
        <RolesGrid roles={roleColumns} groups={groups} canManage={actor.permissions.has("settings.manage")} />
      </div>
    </div>
  );
}
