import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { ROLE_LABELS, type RoleKey } from "@/lib/permissions";
import { PageHeader, PageBody } from "@/components/page-header";
import { AnnouncementForm, type TargetOptions } from "@/app/(app)/admin/announcements/announcement-form";

export default async function NewAnnouncementPage() {
  await requirePermission("announcements.manage");

  const [businessUnits, departments, teams, locations, roles] = await Promise.all([
    prisma.businessUnit.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.team.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.role.findMany({ select: { key: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const options: TargetOptions = {
    businessUnits,
    departments,
    teams,
    locations,
    roles: roles.map((r) => ({ key: r.key, name: ROLE_LABELS[r.key as RoleKey] ?? r.name })),
  };

  return (
    <div>
      <PageHeader
        title="New announcement"
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "Announcements", href: "/admin/announcements" }, { label: "New" }]}
      />
      <PageBody>
        <AnnouncementForm
          initial={{ title: "", body: "", targetMode: "everyone", targetId: null, startsAt: new Date().toISOString(), expiresAt: null, pinned: false, requiresAck: false }}
          options={options}
        />
      </PageBody>
    </div>
  );
}
