"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Glyph, Icon } from "@/components/icons";
import { cn } from "@/lib/utils";

export interface AskCitation {
  entityType: "SOP" | "COURSE" | "NEAR_MISS";
  entityId: string;
  title: string;
  sectionPath: string | null;
  versionLabel: string | null;
  href: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: AskCitation[];
  pending?: boolean;
  errored?: boolean;
}

interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
}

function uid(): string {
  return Math.random().toString(36).slice(2);
}

async function readSse(
  response: Response,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as Record<string, unknown>);
      } catch {
        // Ignore a malformed event rather than breaking the whole stream.
      }
    }
  }
}

export function AskChat({
  available,
  initialConversations,
  exampleQuestions,
  actorName,
}: {
  available: boolean;
  initialConversations: ConversationSummary[];
  exampleQuestions: string[];
  actorName: string;
}) {
  const [conversations, setConversations] = React.useState(initialConversations);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [loadingConversation, setLoadingConversation] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function loadConversation(id: string) {
    setLoadingConversation(true);
    setActiveId(id);
    try {
      const response = await fetch(`/api/ai/ask?conversationId=${encodeURIComponent(id)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Couldn't load that conversation.");
      setMessages(
        (data.messages as { id: string; role: "user" | "assistant"; content: string; citations: AskCitation[] | null }[]).map(
          (m) => ({ id: m.id, role: m.role, content: m.content, citations: m.citations ?? undefined }),
        ),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't load that conversation.");
    } finally {
      setLoadingConversation(false);
    }
  }

  function startNewConversation() {
    setActiveId(null);
    setMessages([]);
  }

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || sending) return;

    setInput("");
    setSending(true);

    const userMessage: ChatMessage = { id: uid(), role: "user", content: trimmed };
    const assistantId = uid();
    setMessages((prev) => [...prev, userMessage, { id: assistantId, role: "assistant", content: "", pending: true }]);

    try {
      const response = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, conversationId: activeId ?? undefined }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Something went wrong.");
      }

      let sawDelta = false;
      await readSse(response, (event) => {
        if (event.type === "delta" && typeof event.text === "string") {
          sawDelta = true;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + event.text, pending: false } : m)),
          );
        } else if (event.type === "done") {
          const conversationId = event.conversationId as string;
          const answer = typeof event.answer === "string" ? event.answer : "";
          const citations = (event.citations as AskCitation[] | undefined) ?? [];
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: sawDelta && m.content ? m.content : answer, citations, pending: false }
                : m,
            ),
          );
          if (!activeId) {
            setActiveId(conversationId);
            setConversations((prev) => [
              { id: conversationId, title: trimmed.slice(0, 80), createdAt: new Date().toISOString() },
              ...prev,
            ]);
          }
        } else if (event.type === "error") {
          const message = typeof event.message === "string" ? event.message : "Something went wrong.";
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: message, pending: false, errored: true } : m)),
          );
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: message, pending: false, errored: true } : m)),
      );
    } finally {
      setSending(false);
    }
  }

  if (!available) {
    return (
      <EmptyState
        icon={<Icon name="ai" className="h-6 w-6" />}
        title="Ask FSW AI isn't configured yet"
        description="An administrator needs to set ANTHROPIC_API_KEY or OPENAI_API_KEY for the platform before this feature is available. Everything else in FSW Academy — search, training, SOPs — works normally in the meantime."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
      <aside className="order-2 lg:order-1">
        <Button variant="outline" size="sm" className="mb-3 w-full justify-start" onClick={startNewConversation}>
          <Glyph name="plus" className="h-4 w-4" />
          New question
        </Button>
        <nav aria-label="Conversation history" className="flex flex-col gap-1">
          {conversations.length === 0 && (
            <p className="px-2 text-[0.75rem] text-[var(--text-muted)]">Your questions will appear here.</p>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => loadConversation(c.id)}
              className={cn(
                "truncate rounded-md px-2.5 py-2 text-left text-[0.8125rem] transition-colors",
                "hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                activeId === c.id
                  ? "bg-[var(--surface-sunken)] font-medium text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)]",
              )}
            >
              {c.title}
            </button>
          ))}
        </nav>
      </aside>

      <div className="order-1 flex min-w-0 flex-col lg:order-2">
        <div
          ref={scrollRef}
          className="flex h-[60vh] flex-col gap-4 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4"
        >
          {messages.length === 0 && !loadingConversation && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <div
                aria-hidden="true"
                className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-[var(--text-muted)]"
              >
                <Icon name="ai" className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">Hi {actorName.split(" ")[0]}, what do you need to know?</p>
                <p className="mt-1 text-[0.8125rem] text-[var(--text-muted)]">
                  Answers are grounded in published FSW SOPs, courses and near-miss case
                  studies, with citations.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {exampleQuestions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => send(q)}
                    className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3.5 py-2 text-left text-[0.8125rem] text-[var(--text-secondary)] shadow-xs hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={cn("flex flex-col gap-2", message.role === "user" ? "items-end" : "items-start")}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-lg px-3.5 py-2.5 text-[0.875rem] leading-relaxed whitespace-pre-wrap",
                  message.role === "user"
                    ? "bg-[var(--brand-primary)] text-white"
                    : message.errored
                      ? "border border-danger-200 bg-danger-50 text-danger-800"
                      : "border border-[var(--border-subtle)] bg-[var(--surface-sunken)] text-[var(--text-primary)]",
                )}
              >
                {message.pending && message.content.length === 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)]">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
                  </span>
                ) : (
                  message.content
                )}
              </div>

              {message.citations && message.citations.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {message.citations.map((citation, i) => (
                    <Link
                      key={`${citation.entityId}-${citation.sectionPath ?? i}`}
                      href={citation.href}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1 text-[0.6875rem] font-medium text-[var(--text-secondary)] shadow-xs hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                    >
                      <Glyph name="external" className="h-3 w-3" />
                      [{i + 1}] {citation.title}
                      {citation.sectionPath ? ` — ${citation.sectionPath}` : ""}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask about a procedure, policy, or your required training…"
            rows={2}
            className="flex-1 resize-none"
            aria-label="Ask FSW AI a question"
          />
          <Button type="submit" loading={sending} disabled={!input.trim()}>
            Ask
            <Badge tone="neutral" className="ml-1 hidden sm:inline-flex">
              Enter
            </Badge>
          </Button>
        </form>
      </div>
    </div>
  );
}
