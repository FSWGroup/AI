import { NextResponse } from "next/server";
import { z } from "zod";
import { getActor } from "@/lib/auth/guard";
import { recordLessonProgress, ServiceError } from "@/lib/services/completion";

/**
 * POST /api/progress
 *
 * Records video/checklist/survey progress for the calling actor's own lesson
 * progress row. The service enforces the monotonic + anti-scrub rules for
 * video playback — this route only authenticates and validates shape.
 */

const bodySchema = z.object({
  lessonId: z.string().min(1),
  videoPositionSeconds: z.number().min(0).optional(),
  videoDurationSeconds: z.number().min(0).optional(),
  checklistItemId: z.string().optional(),
  checklistChecked: z.boolean().optional(),
  surveyAnswers: z.record(z.unknown()).optional(),
  markComplete: z.boolean().optional(),
});

export async function POST(request: Request) {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ ok: false, error: "Your session has expired. Please sign in again." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid progress payload." }, { status: 400 });
  }

  const { lessonId, ...patch } = parsed.data;

  try {
    const result = await recordLessonProgress(actor, lessonId, patch);
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 422 });
    }
    console.error("[api/progress]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
