import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/guard";
import { answerQuestion, getConversationMessages, listConversations } from "@/lib/ai/rag";
import { RateLimitError } from "@/lib/rate-limit";
import { CapabilityUnavailableError } from "@/lib/ai/types";

/**
 * Ask FSW AI endpoint.
 *
 * POST streams the answer as Server-Sent Events so the chat UI can render it
 * incrementally; GET returns conversation history for the sidebar.
 * Permission-gated on ai.ask and rate-limited inside answerQuestion() itself.
 */

export async function POST(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!actor.permissions.has("ai.ask")) {
    return NextResponse.json({ error: "You don't have permission to use Ask FSW AI." }, { status: 403 });
  }

  let body: { question?: unknown; conversationId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "A question is required." }, { status: 400 });
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : undefined;

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Controller already closed (client disconnected) — nothing to do.
        }
      };

      try {
        const result = await answerQuestion(actor, question, conversationId, {
          onDelta: (chunk) => send({ type: "delta", text: chunk }),
        });
        send({
          type: "done",
          conversationId: result.conversationId,
          answer: result.answer,
          citations: result.citations,
          retrievalMode: result.retrievalMode,
        });
      } catch (error) {
        if (error instanceof RateLimitError) {
          send({ type: "error", code: "rate_limited", message: error.message });
        } else if (error instanceof CapabilityUnavailableError) {
          send({ type: "error", code: "unavailable", message: error.message });
        } else {
          console.error("[api/ai/ask]", error);
          send({ type: "error", code: "internal", message: "Something went wrong answering that question." });
        }
      } finally {
        closed = true;
        controller.close();
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function GET(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!actor.permissions.has("ai.ask")) {
    return NextResponse.json({ error: "You don't have permission to use Ask FSW AI." }, { status: 403 });
  }

  const conversationId = request.nextUrl.searchParams.get("conversationId");
  if (conversationId) {
    const messages = await getConversationMessages(actor, conversationId);
    if (!messages) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    return NextResponse.json({ messages });
  }

  const conversations = await listConversations(actor);
  return NextResponse.json({ conversations });
}
