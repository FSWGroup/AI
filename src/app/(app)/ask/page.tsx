import { requirePermission } from "@/lib/auth/guard";
import { isCapabilityAvailable } from "@/lib/providers/registry";
import { listConversations } from "@/lib/ai/rag";
import { PageHeader, PageBody } from "@/components/page-header";
import { AskChat } from "@/components/ai/ask-chat";

export const metadata = { title: "Ask FSW AI" };

const EXAMPLE_QUESTIONS = [
  "How do I create a purchase order?",
  "What training do I need for my role?",
  "Who approves new vendors?",
];

export default async function AskPage() {
  const actor = await requirePermission("ai.ask");
  const available = isCapabilityAvailable("ai_text");
  const conversations = available ? await listConversations(actor) : [];

  return (
    <>
      <PageHeader
        title="Ask FSW AI"
        description="Ask about company procedures, policies, and training. Every answer is grounded in approved FSW sources and cited."
        crumbs={[{ label: "Home", href: "/home" }, { label: "Ask FSW AI" }]}
      />
      <PageBody className="max-w-4xl">
        <AskChat
          available={available}
          initialConversations={conversations.map((c) => ({
            id: c.id,
            title: c.title ?? "Untitled question",
            createdAt: c.createdAt.toISOString(),
          }))}
          exampleQuestions={EXAMPLE_QUESTIONS}
          actorName={actor.name}
        />
      </PageBody>
    </>
  );
}
