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
import { getStorage } from "@/lib/storage";

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

  const storage = getStorage();
  const sessions = [];
  for (const rec of recordings) {
    const chunks = [];
    for (const chunk of rec.chunks.filter((c) => c.status === "UPLOADED")) {
      chunks.push({
        sequence: chunk.sequence,
        url: await storage.getDownloadUrl(chunk.objectKey, 300),
        sizeBytes: chunk.sizeBytes,
        startedAt: chunk.startedAt,
        endedAt: chunk.endedAt,
      });
    }
    sessions.push({
      sessionId: rec.sessionId,
      status: rec.status,
      mimeType: rec.mimeType,
      startedAt: rec.startedAt,
      endedAt: rec.endedAt,
      chunks,
    });
  }

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

  const storage = getStorage();
  const deleted = await storage.deletePrefix(`assessment-recordings/${attemptId}/`);
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
