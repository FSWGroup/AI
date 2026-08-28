import { requireActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { SectionHeading } from "@/components/page-header";
import { OrganizationForm } from "@/app/(app)/admin/settings/organization/organization-form";

export default async function OrganizationSettingsPage() {
  const actor = await requireActor();
  const organization = await prisma.organization.findFirst();

  return (
    <div>
      <SectionHeading
        title="Organization"
        description="The legal or display name of the organization this platform serves. Business units, departments, and teams are managed separately in Organization structure."
      />
      <OrganizationForm initialName={organization?.name ?? ""} canManage={actor.permissions.has("settings.manage")} />
    </div>
  );
}
