import { requireActor } from "@/lib/auth/guard";
import { getSettings } from "@/lib/settings";
import { SectionHeading } from "@/components/page-header";
import { SettingsForm } from "@/app/(app)/admin/settings/_shared/settings-form";

export default async function NotificationsSettingsPage() {
  const actor = await requireActor();
  const settings = await getSettings();

  return (
    <div>
      <SectionHeading
        title="Notifications"
        description="Platform-wide reminder and certificate-expiry warning timing. Per-person in-app/email toggles live at Settings → Notifications for each user."
      />
      <div className="mt-4 max-w-md">
        <SettingsForm
          section="training"
          canManage={actor.permissions.has("settings.manage")}
          fields={[
            { key: "reminderDaysBefore", label: "Remind before due date (days)", type: "number-list", hint: "Comma-separated, e.g. 7, 1." },
            { key: "expiryWarningDays", label: "Warn before certificate expiry (days)", type: "number-list", hint: "Comma-separated, e.g. 60, 30, 7." },
          ]}
          initialValues={settings.training as unknown as Record<string, unknown>}
        />
      </div>
    </div>
  );
}
