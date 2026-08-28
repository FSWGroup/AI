import { requireActor } from "@/lib/auth/guard";
import { getSettings } from "@/lib/settings";
import { SectionHeading } from "@/components/page-header";
import { SettingsForm } from "@/app/(app)/admin/settings/_shared/settings-form";

export default async function PrivacySettingsPage() {
  const actor = await requireActor();
  const settings = await getSettings();

  return (
    <div>
      <SectionHeading
        title="Privacy & retention"
        description="How long evidence and analytics are retained, and the privacy notice shown to people."
      />
      <div className="mt-4 max-w-md">
        <SettingsForm
          section="privacy"
          canManage={actor.permissions.has("settings.manage")}
          fields={[
            { key: "trainingRecordRetentionYears", label: "Training record retention (years)", type: "number" },
            { key: "auditRetentionYears", label: "Audit log retention (years)", type: "number" },
            { key: "analyticsRetentionYears", label: "Analytics retention (years)", type: "number" },
            { key: "privacyNoticeUrl", label: "Privacy notice URL", type: "url" },
            { key: "privacyNoticeText", label: "Privacy notice text", type: "textarea" },
          ]}
          initialValues={settings.privacy}
        />
      </div>
    </div>
  );
}
