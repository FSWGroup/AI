import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/**
 * Append-only audit trail. There is deliberately no update/delete path for
 * audit events anywhere in the application; ordinary admins cannot edit it.
 */
export async function audit(entry: {
  userId?: string | null;
  actorLabel?: string;
  action: string;
  entityType: string;
  entityId?: string;
  previousValue?: unknown;
  newValue?: unknown;
  ip?: string;
}): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      userId: entry.userId ?? null,
      actorLabel: entry.actorLabel,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      previousValue: (entry.previousValue ?? undefined) as Prisma.InputJsonValue | undefined,
      newValue: (entry.newValue ?? undefined) as Prisma.InputJsonValue | undefined,
      ip: entry.ip,
    },
  });
}

/** Audit action names used across the app (single source of truth). */
export const AUDIT_ACTIONS = {
  LOGIN: "auth.login",
  LOGIN_FAILED: "auth.login_failed",
  LOGOUT: "auth.logout",
  INVITATION_CREATED: "invitation.created",
  INVITATION_REVOKED: "invitation.revoked",
  JOB_PROFILE_CREATED: "job_profile.created",
  JOB_PROFILE_UPDATED: "job_profile.updated",
  BENCHMARK_UPDATED: "benchmark.updated",
  QUESTION_CREATED: "question.created",
  QUESTION_UPDATED: "question.updated",
  QUESTION_STATUS_CHANGED: "question.status_changed",
  QUESTION_APPROVED: "question.approved",
  SCORE_RECALCULATED: "score.recalculated",
  REPORT_GENERATED: "report.generated",
  REPORT_VIEWED: "report.viewed",
  REPORT_PDF_DOWNLOADED: "report.pdf_downloaded",
  RECORDING_VIEWED: "recording.viewed",
  RECORDING_DELETED: "recording.deleted",
  NOTE_CREATED: "candidate_note.created",
  NOTE_UPDATED: "candidate_note.updated",
  ATTEMPT_INVALIDATED: "attempt.invalidated",
  RETEST_AUTHORIZED: "attempt.retest_authorized",
  RESUME_LINK_ISSUED: "attempt.resume_link_issued",
  ACCOMMODATION_GRANTED: "attempt.accommodation_granted",
  RETENTION_CHANGED: "retention.changed",
  RETENTION_RUN: "retention.run",
  LEGAL_HOLD_CREATED: "legal_hold.created",
  LEGAL_HOLD_RELEASED: "legal_hold.released",
  NORM_TABLE_CREATED: "norm_table.created",
  SETTINGS_UPDATED: "settings.updated",
  USER_CREATED: "user.created",
  USER_UPDATED: "user.updated",
} as const;
