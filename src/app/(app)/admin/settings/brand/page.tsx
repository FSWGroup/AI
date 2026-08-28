import { requireActor } from "@/lib/auth/guard";
import { getSettings } from "@/lib/settings";
import { SectionHeading } from "@/components/page-header";
import { BrandForm } from "@/app/(app)/admin/settings/brand/brand-form";

export default async function BrandSettingsPage() {
  const actor = await requireActor();
  const settings = await getSettings();

  return (
    <div>
      <SectionHeading title="Brand" description="Company name, app name, logos, and colors. Changes apply everywhere immediately." />
      <div className="mt-4">
        <BrandForm initial={settings.brand} canManage={actor.permissions.has("settings.manage")} />
      </div>
    </div>
  );
}
