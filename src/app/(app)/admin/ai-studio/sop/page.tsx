import { requirePermission } from "@/lib/auth/guard";
import { isCapabilityAvailable } from "@/lib/providers/registry";
import { PageHeader, PageBody } from "@/components/page-header";
import { SopDraftFlow } from "@/components/ai/sop-draft-flow";

export const metadata = { title: "Draft an SOP" };

export default async function DraftSopPage() {
  await requirePermission("ai.generate");
  const available = isCapabilityAvailable("ai_text");

  return (
    <>
      <PageHeader
        title="Draft an SOP with AI"
        description="Give it a prompt, rough notes, a call transcript, or a pasted document. Review and edit everything before saving."
        crumbs={[
          { label: "Admin", href: "/admin" },
          { label: "AI Studio", href: "/admin/ai-studio" },
          { label: "Draft an SOP" },
        ]}
      />
      <PageBody className="max-w-4xl">
        <SopDraftFlow available={available} />
      </PageBody>
    </>
  );
}
