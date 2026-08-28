import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/guard";
import { coachReply, getCoachMessages } from "@/lib/ai/coach";
import { RateLimitError } from "@/lib/rate-limit";
import { CapabilityUnavailableError } from "@/lib/ai/types";

/** The in-course Training Coach endpoint. Permission-gated on ai.ask, rate-limited inside coachReply(). */
export async function POST(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!actor.permissions.has("ai.ask")) {
    return NextResponse.json({ error: "You don't have permission to use the Training Coach." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.courseId !== "string" ||
    typeof body.lessonId !== "string" ||
    typeof body.message !== "string" ||
    body.message.trim().length === 0
  ) {
    return NextResponse.json({ error: "courseId, lessonId, and message are required." }, { status: 400 });
  }

  try {
    const result = await coachReply(actor, {
      courseId: body.courseId,
      lessonId: body.lessonId,
      message: body.message,
      conversationId: typeof body.conversationId === "string" ? body.conversationId : undefined,
      mode: typeof body.mode === "string" ? body.mode : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    if (error instanceof CapabilityUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[api/ai/coach]", error);
    return NextResponse.json({ error: "Something went wrong. Try again in a moment." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const conversationId = request.nextUrl.searchParams.get("conversationId");
  if (!conversationId) return NextResponse.json({ error: "conversationId is required." }, { status: 400 });

  const messages = await getCoachMessages(actor, conversationId);
  if (!messages) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  return NextResponse.json({ messages });
}
