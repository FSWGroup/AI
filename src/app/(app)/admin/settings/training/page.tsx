import { requireActor } from "@/lib/auth/guard";
import { getSettings } from "@/lib/settings";
import { SectionHeading } from "@/components/page-header";
import { SettingsForm } from "@/app/(app)/admin/settings/_shared/settings-form";

export default async function TrainingSettingsPage() {
  const actor = await requireActor();
  const settings = await getSettings();

  return (
    <div>
      <SectionHeading
        title="Training defaults"
        description="Defaults applied to new courses and assignments unless a course overrides them."
      />
      <div className="mt-4 max-w-md">
        <SettingsForm
          section="training"
          canManage={actor.permissions.has("settings.manage")}
          fields={[
            { key: "defaultDueDays", label: "Default due date (days after assignment)", type: "number" },
            { key: "defaultRequiredVideoPercent", label: "Required video watch percentage", type: "number", hint: "0–100" },
            { key: "defaultPassingScore", label: "Default quiz passing score", type: "number", hint: "0–100" },
          ]}
          initialValues={settings.training}
        />
      </div>
    </div>
  );
}
