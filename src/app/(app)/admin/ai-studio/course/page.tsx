import { requirePermission } from "@/lib/auth/guard";
import { isCapabilityAvailable } from "@/lib/providers/registry";
import { PageHeader, PageBody } from "@/components/page-header";
import { CourseDraftFlow } from "@/components/ai/course-draft-flow";

export const metadata = { title: "Build a Course" };

export default async function BuildCoursePage({
  searchParams,
}: {
  searchParams: Promise<{ fromSop?: string }>;
}) {
  await requirePermission("ai.generate");
  const { fromSop } = await searchParams;
  const available = isCapabilityAvailable("ai_text");

  return (
    <>
      <PageHeader
        title="Build a course with AI"
        description="Generate an editable outline first. You approve the shape, then AI fills in full lesson content, examples, and a quiz."
        crumbs={[
          { label: "Admin", href: "/admin" },
          { label: "AI Studio", href: "/admin/ai-studio" },
          { label: "Build a course" },
        ]}
      />
      <PageBody className="max-w-4xl">
        <CourseDraftFlow available={available} initialSopId={fromSop ?? null} />
      </PageBody>
    </>
  );
}
