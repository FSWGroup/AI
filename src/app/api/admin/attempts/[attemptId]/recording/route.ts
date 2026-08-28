/**
 * Recording access. RBAC comes from OrgSettings.recordingAccessRoles
 * (default: SUPER_ADMIN + HR_ADMIN — least privilege). Every playback
 * issuance is audited. URLs are short-lived signed URLs; no public access.
 */

import { prisma } from "@/lib/db";
import { apiError, apiOk, withErrorHandling } from "@/lib/api";
import { requireAnyUser, requestMeta } from "@/lib/auth/session";
import { canAccessRecordings } from "@/lib/auth/rbac";
import { assertAttemptAccess } from "@/lib/auth/scope";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";

export const GET = withErrorHandling(async (_req, ctx) => {
  const user = await requireAnyUser();
  const { attemptId } = await ctx.params;
  const settings = await prisma.orgSettings.findUnique({ where: { id: "org" } });
  if (
    !canAccessRecordings(user.role, settings?.recordingAccessRoles ?? ["SUPER_ADMIN", "HR_ADMIN"])
  ) {
    return apiError("You do not have permission to view recordings.", 403);
  }
  await assertAttemptAccess(user, attemptId);

  const recordings = await prisma.recording.findMany({
    where: { attemptId, status: { not: "DELETED" } },
    include: { chunks: { orderBy: { sequence: "asc" } } },
    orderBy: { startedAt: "asc" },
  });

  const meta = await requestMeta();
  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.RECORDING_VIEWED,
    entityType: "Attempt",
    entityId: attemptId,
    newValue: { recordings: recordings.length },
    ip: meta.ip,
  });

  // Sessions are played back as one continuous stream (see the /stream
  // route); this payload describes the timeline so a reviewer can jump to a
  // point in time. Per-chunk URLs are deliberately not returned — an
  // individual chunk is not independently playable.
  const sessions = recordings.map((rec) => {
    const uploaded = rec.chunks
      .filter((c) => c.status === "UPLOADED" && c.sizeBytes && c.sizeBytes > 0)
      .sort((a, b) => a.sequence - b.sequence);
    const sessionStart = (
      uploaded[0]?.startedAt ?? rec.startedAt
    ).getTime();
    const lastEnd = uploaded[uploaded.length - 1]?.endedAt ?? rec.endedAt;

    return {
      sessionId: rec.sessionId,
      status: rec.status,
      mimeType: rec.mimeType,
      startedAt: rec.startedAt.toISOString(),
      endedAt: rec.endedAt?.toISOString() ?? null,
      expectedChunks: rec.expectedChunks,
      uploadedChunks: uploaded.length,
      totalBytes: uploaded.reduce((n, c) => n + (c.sizeBytes ?? 0), 0),
      /** Best-effort wall-clock length of the captured video, in seconds. */
      durationSeconds: lastEnd
        ? Math.max(0, Math.round((lastEnd.getTime() - sessionStart) / 1000))
        : null,
      segments: uploaded.map((c) => ({
        sequence: c.sequence,
        offsetSeconds: c.startedAt
          ? Math.max(0, Math.round((c.startedAt.getTime() - sessionStart) / 1000))
          : null,
        startedAt: c.startedAt?.toISOString() ?? null,
        sizeBytes: c.sizeBytes,
      })),
    };
  });

  return apiOk({
    reminder:
      "Review this recording only for assessment-integrity concerns. Do not evaluate appearance or any actual or perceived protected characteristic.",
    sessions,
  });
});

export const DELETE = withErrorHandling(async (_req, ctx) => {
  const user = await requireAnyUser();
  const { attemptId } = await ctx.params;
  const settings = await prisma.orgSettings.findUnique({ where: { id: "org" } });
  if (user.role !== "SUPER_ADMIN" && user.role !== "HR_ADMIN") {
    return apiError("You do not have permission to delete recordings.", 403);
  }
  if (
    !canAccessRecordings(user.role, settings?.recordingAccessRoles ?? ["SUPER_ADMIN", "HR_ADMIN"])
  ) {
    return apiError("You do not have permission to delete recordings.", 403);
  }

  // Legal hold blocks deletion.
  const attempt = await prisma.attempt.findUnique({ where: { id: attemptId } });
  if (!attempt) return apiError("Attempt not found.", 404);
  const holds = await prisma.legalHold.findMany({ where: { active: true } });
  const held = holds.some(
    (h) =>
      h.scope === "GLOBAL" ||
      h.scope === `ATTEMPT:${attemptId}` ||
      h.scope === `CANDIDATE:${attempt.candidateId}`,
  );
  if (held) {
    return apiError("A legal hold prevents deleting this recording.", 409);
  }

  const { getStorage } = await import("@/lib/storage");
  const deleted = await getStorage().deletePrefix(
    `assessment-recordings/${attemptId}/`,
  );
  await prisma.recording.updateMany({
    where: { attemptId },
    data: { status: "DELETED", deletedAt: new Date() },
  });

  const meta = await requestMeta();
  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.RECORDING_DELETED,
    entityType: "Attempt",
    entityId: attemptId,
    newValue: { objectsDeleted: deleted },
    ip: meta.ip,
  });
  return apiOk({ ok: true, objectsDeleted: deleted });
});
