/**
 * Issue a short-lived signed upload URL for one recording chunk.
 * Chunks go directly from the browser to object storage — never through
 * an application JSON body.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, rateLimit, withErrorHandling } from "@/lib/api";
import { requireAttempt } from "@/lib/attempt/candidate-auth";
import { getStorage, recordingChunkKey } from "@/lib/storage";

const schema = z.object({
  sessionId: z.string().uuid(),
  sequence: z.number().int().min(0).max(100_000),
});

export const POST = withErrorHandling(async (req) => {
  const attempt = await requireAttempt();
  if (!rateLimit(`chunkurl:${attempt.id}`, 120, 60_000)) {
    return apiError("Too many requests.", 429);
  }
  const { sessionId, sequence } = await parseBody(req, schema);

  const recording = await prisma.recording.findUnique({ where: { sessionId } });
  if (!recording || recording.attemptId !== attempt.id) {
    return apiError("Unknown recording session.", 404);
  }
  if (recording.status !== "ACTIVE") {
    return apiError("This recording session is closed.", 409);
  }

  const objectKey = recordingChunkKey(attempt.id, sessionId, sequence);
  await prisma.recordingChunk.upsert({
    where: { recordingId_sequence: { recordingId: recording.id, sequence } },
    create: { recordingId: recording.id, sequence, objectKey, status: "PENDING" },
    update: { status: "PENDING" },
  });
  const uploadUrl = await getStorage().getUploadUrl(objectKey, recording.mimeType);
  return apiOk({ uploadUrl, sequence });
});
