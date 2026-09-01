import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { SectionHeading } from "@/components/ui";
import { NewRequisitionForm } from "@/components/admin/NewRequisitionForm";

export const dynamic = "force-dynamic";

export default async function NewRequisitionPage() {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "MANAGE_REQUISITIONS")) redirect("/admin/recruiting");

  const [departments, locations, profiles, approvers] = await Promise.all([
    prisma.department.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.jobProfile.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { active: true, role: { in: ["SUPER_ADMIN", "HR_ADMIN", "HIRING_MANAGER"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <SectionHeading
        eyebrow="Recruiting"
        title="New requisition"
        description="Open a role. It stays a draft until its approvers have signed off, and only an open requisition appears on the careers page or in job feeds."
      />
      <NewRequisitionForm
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        locations={locations.map((l) => ({ id: l.id, name: l.name }))}
        profiles={profiles}
        approvers={approvers}
      />
    </div>
  );
}
