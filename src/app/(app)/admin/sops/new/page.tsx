import { requirePermission } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { listPeopleForPicker } from "@/lib/services/sop";
import { PageHeader, PageBody } from "@/components/page-header";
import { SopCreateForm } from "@/app/(app)/admin/sops/new/sop-create-form";

export const metadata = { title: "New SOP" };

export default async function NewSopPage() {
  await requirePermission("sop.create");

  const [people, departments, businessUnits] = await Promise.all([
    listPeopleForPicker(),
    prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.businessUnit.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="New SOP"
        description="Set up the SOP's identity, then write the content. You can save a draft and come back anytime."
        crumbs={[{ label: "Home", href: "/home" }, { label: "Admin" }, { label: "SOPs", href: "/admin/sops" }, { label: "New" }]}
      />
      <PageBody>
        <SopCreateForm people={people} departments={departments} businessUnits={businessUnits} />
      </PageBody>
    </>
  );
}
