import { requirePermission } from "@/lib/auth/guard";
import { isCapabilityAvailable } from "@/lib/providers/registry";
import { PageHeader, PageBody } from "@/components/page-header";
import { QualityCheckFlow } from "@/components/ai/quality-check-flow";

export const metadata = { title: "Content Quality Check" };

export default async function QualityCheckPage() {
  await requirePermission("ai.generate");
  const available = isCapabilityAvailable("ai_text");

  return (
    <>
      <PageHeader
        title="Run a quality check"
        description="Checks clarity, missing steps, reading level, terminology, duplicates, broken links, and missing owners. Read-only — nothing here is ever changed automatically."
        crumbs={[
          { label: "Admin", href: "/admin" },
          { label: "AI Studio", href: "/admin/ai-studio" },
          { label: "Run a quality check" },
        ]}
      />
      <PageBody className="max-w-3xl">
        <QualityCheckFlow available={available} />
      </PageBody>
    </>
  );
}
