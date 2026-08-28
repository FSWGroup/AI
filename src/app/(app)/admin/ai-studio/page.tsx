import { redirect } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/guard";
import { isCapabilityAvailable } from "@/lib/providers/registry";
import { PageHeader, PageBody, SectionHeading } from "@/components/page-header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icons";
import type { IconName } from "@/lib/navigation";

export const metadata = { title: "Build with AI" };

interface StudioTool {
  key: string;
  title: string;
  description: string;
  href: string;
  icon: IconName;
}

const TOOLS: StudioTool[] = [
  {
    key: "sop",
    title: "Draft an SOP",
    description: "Turn a prompt, notes, a call transcript, or a pasted document into a structured SOP draft, ready for your review.",
    href: "/admin/ai-studio/sop",
    icon: "sop",
  },
  {
    key: "course",
    title: "Build a course",
    description: "Generate an editable outline first, then let AI fill in full lesson content, examples, and a quiz once you approve the shape.",
    href: "/admin/ai-studio/course",
    icon: "training",
  },
  {
    key: "quiz",
    title: "Generate quiz questions",
    description: "Draft knowledge-check questions from source text, in any of the question types the platform supports.",
    href: "/admin/ai-studio/quiz",
    icon: "assignment",
  },
  {
    key: "translate",
    title: "Translate content",
    description: "Create a draft translation of a published SOP or course for another language, awaiting human review.",
    href: "/admin/ai-studio/translate",
    icon: "content",
  },
  {
    key: "quality",
    title: "Run a quality check",
    description: "Check clarity, reading level, missing steps, broken links, duplicate content, and inconsistent terminology — read-only.",
    href: "/admin/ai-studio/quality",
    icon: "compliance",
  },
];

export default async function AiStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; fromSop?: string }>;
}) {
  await requirePermission("ai.generate");
  const { type, fromSop } = await searchParams;

  if (type === "sop") redirect("/admin/ai-studio/sop");
  if (type === "course") {
    redirect(fromSop ? `/admin/ai-studio/course?fromSop=${encodeURIComponent(fromSop)}` : "/admin/ai-studio/course");
  }

  const available = isCapabilityAvailable("ai_text");

  return (
    <>
      <PageHeader
        title="Build with AI"
        description="Every tool here produces a draft. Nothing publishes, and nothing is live, until you review and save it."
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "AI Studio" }]}
      />
      <PageBody>
        {!available && (
          <Card className="mb-5 border-warning-200 bg-warning-50">
            <CardContent className="flex items-center gap-3 py-3.5">
              <Icon name="ai" className="h-5 w-5 shrink-0 text-warning-700" />
              <p className="text-[0.8125rem] text-warning-800">
                AI text generation isn&apos;t configured yet. Set <code className="font-mono">ANTHROPIC_API_KEY</code>{" "}
                or <code className="font-mono">OPENAI_API_KEY</code>, then reload this page. You can still browse
                these tools, but generation will show a setup message until then.
              </p>
            </CardContent>
          </Card>
        )}

        <SectionHeading title="Authoring tools" description="Pick what you're trying to create." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((tool) => (
            <Card key={tool.key} className="flex flex-col">
              <CardHeader>
                <div className="mb-1 flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-[var(--brand-primary)]"
                  >
                    <Icon name={tool.icon} className="h-4.5 w-4.5" />
                  </span>
                  <CardTitle>{tool.title}</CardTitle>
                </div>
                <CardDescription>{tool.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1" />
              <CardFooter>
                <Link
                  href={tool.href}
                  className="inline-flex h-9.5 w-full items-center justify-center gap-2 rounded-md border border-transparent bg-[var(--brand-primary)] px-4 text-sm font-medium text-white shadow-xs transition-colors hover:bg-[var(--brand-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                >
                  Open
                </Link>
              </CardFooter>
            </Card>
          ))}
        </div>

        <div className="mt-6 flex items-center gap-2 text-[0.8125rem] text-[var(--text-muted)]">
          <Badge tone="neutral">AI-generated — needs review</Badge>
          <span>appears on everything these tools produce, until a human accepts it.</span>
        </div>
      </PageBody>
    </>
  );
}
