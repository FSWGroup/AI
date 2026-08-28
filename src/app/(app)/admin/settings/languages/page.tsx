import { requireActor } from "@/lib/auth/guard";
import { getSettings } from "@/lib/settings";
import { SectionHeading } from "@/components/page-header";
import { LanguagesForm } from "@/app/(app)/admin/settings/languages/languages-form";

export default async function LanguagesSettingsPage() {
  const actor = await requireActor();
  const settings = await getSettings();

  return (
    <div>
      <SectionHeading
        title="Languages"
        description="BCP-47 language codes supported for content and translation (e.g. en, fil, es)."
      />
      <LanguagesForm initialLanguages={settings.languages} canManage={actor.permissions.has("settings.manage")} />
    </div>
  );
}
