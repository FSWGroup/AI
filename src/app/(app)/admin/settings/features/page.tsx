import { requireActor } from "@/lib/auth/guard";
import { getSettings } from "@/lib/settings";
import { SectionHeading } from "@/components/page-header";
import { SettingsForm } from "@/app/(app)/admin/settings/_shared/settings-form";

export default async function FeatureFlagsSettingsPage() {
  const actor = await requireActor();
  const settings = await getSettings();

  return (
    <div>
      <SectionHeading title="Feature flags" description="Turn optional platform features on or off for everyone." />
      <div className="mt-4 max-w-md">
        <SettingsForm
          section="features"
          canManage={actor.permissions.has("settings.manage")}
          fields={[
            { key: "darkMode", label: "Dark mode", type: "checkbox", hint: "Lets people switch to a dark theme." },
            {
              key: "publicCertificateVerification",
              label: "Public certificate verification",
              type: "checkbox",
              hint: "Enables the unauthenticated /verify/[token] page for certificates issued with a verification token.",
            },
            { key: "leaderboards", label: "Leaderboards", type: "checkbox", hint: "Shows a team completion leaderboard on the learner home page." },
            { key: "selfEnrollment", label: "Self-enrollment", type: "checkbox", hint: "Lets people enroll themselves in eligible courses." },
            { key: "gamificationBadges", label: "Gamification badges", type: "checkbox" },
            { key: "scormPlayer", label: "SCORM player", type: "checkbox", hint: "Enables uploading and playing SCORM packages." },
            { key: "aiVideoStudio", label: "AI Video Studio", type: "checkbox" },
            { key: "translations", label: "Translations", type: "checkbox" },
          ]}
          initialValues={settings.features}
        />
      </div>
    </div>
  );
}
