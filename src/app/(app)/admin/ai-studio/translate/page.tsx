import { requirePermission } from "@/lib/auth/guard";
import { isCapabilityAvailable } from "@/lib/providers/registry";
import { getSettings } from "@/lib/settings";
import { PageHeader, PageBody } from "@/components/page-header";
import { TranslateFlow } from "@/components/ai/translate-flow";

export const metadata = { title: "Translate Content" };

export default async function TranslateStudioPage() {
  await requirePermission("ai.generate");
  const [available, settings] = await Promise.all([
    Promise.resolve(isCapabilityAvailable("ai_text")),
    getSettings(),
  ]);

  return (
    <>
      <PageHeader
        title="Translate content"
        description="Create a draft translation of a published SOP or course. It's saved as a draft translation, awaiting human review before publishing."
        crumbs={[
          { label: "Admin", href: "/admin" },
          { label: "AI Studio", href: "/admin/ai-studio" },
          { label: "Translate content" },
        ]}
      />
      <PageBody className="max-w-3xl">
        <TranslateFlow available={available} languages={settings.languages} />
      </PageBody>
    </>
  );
}
