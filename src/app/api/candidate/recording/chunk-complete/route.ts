/** Confirm a chunk upload; the server verifies the object actually exists. */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { getAttemptFromCookie } from "@/lib/attempt/candidate-auth";
import { getStorage } from "@/lib/storage";

const schema = z.object({
  sessionId: z.string().uuid(),
  sequence: z.number().int().min(0).max(100_000),
  sizeBytes: z.number().int().min(0).max(100 * 1024 * 1024),
  checksum: z.string().max(128).optional(),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
});

export const POST = withErrorHandling(async (req) => {
  const attempt = await getAttemptFromCookie();
  if (!attempt) return apiError("No active assessment session.", 401);
  const body = await parseBody(req, schema);

  const recording = await prisma.recording.findUnique({
    where: { sessionId: body.sessionId },
  });
  if (!recording || recording.attemptId !== attempt.id) {
    return apiError("Unknown recording session.", 404);
  }
  const chunk = await prisma.recordingChunk.findUnique({
    where: {
      recordingId_sequence: { recordingId: recording.id, sequence: body.sequence },
    },
  });
  if (!chunk) return apiError("Unknown chunk.", 404);

  const exists = await getStorage().objectExists(chunk.objectKey);
  await prisma.recordingChunk.update({
    where: { id: chunk.id },
    data: {
      status: exists ? "UPLOADED" : "FAILED",
      sizeBytes: body.sizeBytes,
      checksum: body.checksum,
      startedAt: body.startedAt ? new Date(body.startedAt) : undefined,
      endedAt: body.endedAt ? new Date(body.endedAt) : undefined,
      uploadedAt: exists ? new Date() : undefined,
    },
  });
  return apiOk({ verified: exists });
});
