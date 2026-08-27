/**
 * Finalize a recording session: the client declares how many chunks it
 * produced; the server verifies the manifest and marks the recording
 * FINALIZED (all chunks uploaded) or INCOMPLETE.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { getAttemptFromCookie } from "@/lib/attempt/candidate-auth";

const schema = z.object({
  sessionId: z.string().uuid(),
  expectedChunks: z.number().int().min(0).max(100_000),
  reason: z.enum(["completed", "exited", "camera_lost"]).default("completed"),
});

export const POST = withErrorHandling(async (req) => {
  const attempt = await getAttemptFromCookie();
  if (!attempt) return apiError("No active assessment session.", 401);
  const body = await parseBody(req, schema);

  const recording = await prisma.recording.findUnique({
    where: { sessionId: body.sessionId },
    include: { chunks: true },
  });
  if (!recording || recording.attemptId !== attempt.id) {
    return apiError("Unknown recording session.", 404);
  }
  if (recording.status !== "ACTIVE") {
    return apiOk({ status: recording.status });
  }

  const uploaded = recording.chunks.filter((c) => c.status === "UPLOADED").length;
  const complete = uploaded >= body.expectedChunks;

  const updated = await prisma.recording.update({
    where: { id: recording.id },
    data: {
      status: complete ? "FINALIZED" : "INCOMPLETE",
      endedAt: new Date(),
      expectedChunks: body.expectedChunks,
    },
  });
  await prisma.integrityEvent.create({
    data: {
      attemptId: attempt.id,
      type: "CAMERA_ENDED",
      meta: {
        recordingSessionId: recording.sessionId,
        reason: body.reason,
        uploadedChunks: uploaded,
        expectedChunks: body.expectedChunks,
      },
    },
  });
  return apiOk({ status: updated.status, uploadedChunks: uploaded });
});
