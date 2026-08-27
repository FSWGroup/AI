/**
 * Objective integrity event intake. Only whitelisted event types are
 * accepted; events never carry free-form candidate text beyond small
 * structured metadata. Events NEVER affect scores.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, rateLimit, withErrorHandling } from "@/lib/api";
import { getAttemptFromCookie } from "@/lib/attempt/candidate-auth";
import { INTEGRITY_EVENT_TYPES } from "@/lib/scoring/integrity";

const CLIENT_EVENTS = [
  "TAB_HIDDEN",
  "TAB_VISIBLE",
  "WINDOW_BLUR",
  "WINDOW_FOCUS",
  "PAGE_REFRESH",
  "DISCONNECTED",
  "RECONNECTED",
  "CAMERA_INTERRUPTED",
  "CAMERA_RESTORED",
  "COPY_ATTEMPT",
  "CONTEXT_MENU_BLOCKED",
] as const;

const schema = z.object({
  type: z.enum(CLIENT_EVENTS),
  meta: z
    .object({
      sectionKey: z.string().max(50).optional(),
      detail: z.string().max(200).optional(),
    })
    .optional(),
});

export const POST = withErrorHandling(async (req) => {
  const attempt = await getAttemptFromCookie();
  if (!attempt) return apiError("No active assessment session.", 401);
  if (!rateLimit(`event:${attempt.id}`, 240, 60_000)) {
    return apiOk({ recorded: false });
  }
  const body = await parseBody(req, schema);
  if (!(INTEGRITY_EVENT_TYPES as readonly string[]).includes(body.type)) {
    return apiError("Unknown event type.", 422);
  }
  await prisma.integrityEvent.create({
    data: { attemptId: attempt.id, type: body.type, meta: body.meta ?? {} },
  });
  return apiOk({ recorded: true });
});
