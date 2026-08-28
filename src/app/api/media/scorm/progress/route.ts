import { z } from "zod";
import { getActor } from "@/lib/auth/guard";
import { recordScormProgress } from "@/lib/services/scorm";
import { getSettings } from "@/lib/settings";

/**
 * Receives the commit/terminate messages the SCORM player wrapper page
 * relays from its sandboxed iframe via postMessage (see media/[id]/page.tsx
 * and src/lib/services/scorm.ts). Applies them to LessonProgress.
 */

const bodySchema = z.object({
  mediaId: z.string().min(1),
  cmi: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await getSettings();
  if (!settings.features.scormPlayer) return Response.json({ error: "SCORM playback is disabled." }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid progress payload." }, { status: 400 });

  const result = await recordScormProgress(actor, parsed.data.mediaId, { cmi: parsed.data.cmi });
  return Response.json({ ok: true, ...result });
}
