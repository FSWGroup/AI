/**
 * Continuous recording playback.
 *
 * Serves one recording session as a single playable WebM covering the whole
 * assessment, rather than per-chunk files (only the first of which is
 * playable — see src/lib/recording/webm.ts). Supports HTTP Range so the
 * player can buffer progressively, and `from=<sequence>` to start playback
 * at a later point by splicing the init segment onto those chunks.
 *
 * Access is gated by the same RBAC as the recording listing and is audited.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiError, withErrorHandling } from "@/lib/api";
import { requireAnyUser, requestMeta } from "@/lib/auth/session";
import { canAccessRecordings } from "@/lib/auth/rbac";
import { assertAttemptAccess } from "@/lib/auth/scope";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { getStorage } from "@/lib/storage";
import {
  extractInitSegment,
  parseRange,
  partsForRange,
  planStream,
  type ChunkRef,
} from "@/lib/recording/webm";

export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = withErrorHandling(async (req, ctx) => {
  const user = await requireAnyUser();
  const { attemptId } = await ctx.params;

  const settings = await prisma.orgSettings.findUnique({ where: { id: "org" } });
  if (
    !canAccessRecordings(
      user.role,
      settings?.recordingAccessRoles ?? ["SUPER_ADMIN", "HR_ADMIN"],
    )
  ) {
    return apiError("You do not have permission to view recordings.", 403);
  }
  await assertAttemptAccess(user, attemptId);

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session");
  const fromParam = url.searchParams.get("from");
  const fromSequence = fromParam ? Math.max(0, parseInt(fromParam, 10) || 0) : 0;

  const recording = sessionId
    ? await prisma.recording.findUnique({
        where: { sessionId },
        include: { chunks: { orderBy: { sequence: "asc" } } },
      })
    : await prisma.recording.findFirst({
        where: { attemptId, status: { not: "DELETED" } },
        include: { chunks: { orderBy: { sequence: "asc" } } },
        orderBy: { startedAt: "asc" },
      });

  if (!recording || recording.attemptId !== attemptId) {
    return apiError("Recording not found.", 404);
  }
  if (recording.status === "DELETED") {
    return apiError("This recording has been deleted under the retention policy.", 410);
  }

  const uploaded = recording.chunks.filter(
    (c) => c.status === "UPLOADED" && c.sizeBytes && c.sizeBytes > 0,
  );
  if (uploaded.length === 0) {
    return apiError("No uploaded video is available for this session.", 404);
  }

  const storage = getStorage();

  // The init segment lives in the first chunk and is only needed when
  // playback starts later than that chunk.
  const firstChunk = uploaded[0];
  let initSegment: Buffer | null = null;
  if (fromSequence > firstChunk.sequence) {
    const firstBytes = await storage.getObject(firstChunk.objectKey);
    initSegment = firstBytes ? extractInitSegment(firstBytes) : null;
    if (!initSegment) {
      // Without a header we cannot build a playable stream from the middle;
      // fall back to serving from the beginning rather than failing.
      return NextResponse.redirect(
        new URL(
          `/api/admin/attempts/${attemptId}/recording/stream?session=${recording.sessionId}`,
          url.origin,
        ),
      );
    }
  }

  const chunkRefs: ChunkRef[] = uploaded.map((c) => ({
    sequence: c.sequence,
    objectKey: c.objectKey,
    sizeBytes: c.sizeBytes!,
  }));
  const { parts, totalLength } = planStream(
    chunkRefs,
    fromSequence,
    initSegment?.length ?? 0,
  );
  if (parts.length === 0 || totalLength === 0) {
    return apiError("No video available for that position.", 404);
  }

  const range = parseRange(req.headers.get("range"), totalLength);
  const start = range ? range.start : 0;
  const end = range ? range.end : totalLength - 1;
  const needed = partsForRange(parts, start, end);

  // Stream the pieces in order; only the chunks overlapping the requested
  // range are fetched, so seeking never loads the whole recording.
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (const { part, sliceStart, sliceEnd } of needed) {
          let buf: Buffer | null;
          if (part.kind === "init") {
            buf = initSegment;
          } else {
            buf = await storage.getObject(part.objectKey!);
          }
          if (!buf) continue;
          controller.enqueue(
            new Uint8Array(buf.subarray(sliceStart, sliceEnd + 1)),
          );
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  const meta = await requestMeta();
  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.RECORDING_VIEWED,
    entityType: "Attempt",
    entityId: attemptId,
    newValue: {
      sessionId: recording.sessionId,
      fromSequence,
      bytes: `${start}-${end}/${totalLength}`,
    },
    ip: meta.ip,
  });

  const headers: Record<string, string> = {
    "Content-Type": recording.mimeType || "video/webm",
    "Content-Length": String(end - start + 1),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${totalLength}`;

  return new NextResponse(stream, { status: range ? 206 : 200, headers });
});
