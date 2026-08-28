import { requireActor } from "@/lib/auth/guard";
import { getSettings } from "@/lib/settings";
import { SectionHeading } from "@/components/page-header";
import { SettingsForm } from "@/app/(app)/admin/settings/_shared/settings-form";

export default async function ContentReviewSettingsPage() {
  const actor = await requireActor();
  const settings = await getSettings();

  return (
    <div>
      <SectionHeading
        title="Content review defaults"
        description="How often a published SOP is due for re-review, unless a specific SOP sets its own cycle."
      />
      <div className="mt-4 max-w-md">
        <SettingsForm
          section="training"
          canManage={actor.permissions.has("settings.manage")}
          fields={[{ key: "defaultReviewCycleDays", label: "Default review cycle (days)", type: "number", hint: "e.g. 90, 180, or 365." }]}
          initialValues={settings.training}
        />
      </div>
    </div>
  );
}
