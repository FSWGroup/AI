/**
 * Start a recording session. Requires stored recording consent.
 * One Recording row per continuous MediaRecorder run; camera restarts
 * create a new session so the manifest stays truthful.
 */

import { z } from "zod";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requireAttempt } from "@/lib/attempt/candidate-auth";

const schema = z.object({
  mimeType: z.string().max(100).optional(),
});

export const POST = withErrorHandling(async (req) => {
  const attempt = await requireAttempt();
  if (attempt.cameraExempt) {
    return apiError("This attempt has a camera exemption on file.", 409);
  }
  const consent = await prisma.consentRecord.findFirst({
    where: { attemptId: attempt.id, consentType: "recording" },
  });
  if (!consent) {
    return apiError("Recording consent is required before recording.", 409);
  }
  const { mimeType } = await parseBody(req, schema);

  const recording = await prisma.recording.create({
    data: {
      attemptId: attempt.id,
      sessionId: randomUUID(),
      mimeType: mimeType?.startsWith("video/") ? mimeType : "video/webm",
      status: "ACTIVE",
    },
  });
  await prisma.integrityEvent.create({
    data: {
      attemptId: attempt.id,
      type: "CAMERA_STARTED",
      meta: { recordingSessionId: recording.sessionId },
    },
  });
  return apiOk({ sessionId: recording.sessionId });
});
