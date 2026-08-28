import { requirePermission } from "@/lib/auth/guard";
import { isCapabilityAvailable } from "@/lib/providers/registry";
import { PageHeader, PageBody } from "@/components/page-header";
import { QuizDraftFlow } from "@/components/ai/quiz-draft-flow";

export const metadata = { title: "Generate Quiz Questions" };

export default async function QuizStudioPage() {
  await requirePermission("ai.generate");
  const available = isCapabilityAvailable("ai_text");

  return (
    <>
      <PageHeader
        title="Generate quiz questions"
        description="Draft knowledge-check questions from source text. They're created as drafts and won't appear to learners until accepted."
        crumbs={[
          { label: "Admin", href: "/admin" },
          { label: "AI Studio", href: "/admin/ai-studio" },
          { label: "Generate quiz questions" },
        ]}
      />
      <PageBody className="max-w-4xl">
        <QuizDraftFlow available={available} />
      </PageBody>
    </>
  );
}
