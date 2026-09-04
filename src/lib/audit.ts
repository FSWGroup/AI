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
  REPORT_EXPORTED: "report.exported",
  REQUISITION_CREATED: "requisition.created",
  REQUISITION_UPDATED: "requisition.updated",
  REQUISITION_APPROVAL: "requisition.approval",
  REQUISITION_STATUS: "requisition.status",
  APPLICATION_CREATED: "application.created",
  APPLICATION_STAGE_MOVED: "application.stage_moved",
  APPLICATION_REJECTED: "application.rejected",
  APPLICATION_HIRED: "application.hired",
  CANDIDATES_MERGED: "candidate.merged",
  INTERVIEW_SCHEDULED: "interview.scheduled",
  SCORECARD_SUBMITTED: "scorecard.submitted",
  OFFER_CREATED: "offer.created",
  OFFER_APPROVAL: "offer.approval",
  OFFER_SENT: "offer.sent",
  OFFER_RESPONDED: "offer.responded",
  POSTING_PUBLISHED: "posting.published",
  REVIEW_ROUND_OPENED: "review.round_opened",
  REVIEW_SUBMITTED: "review.submitted",
  SOCIAL_CHECK_REQUESTED: "social_check.requested",
  SOCIAL_CHECK_CONSENT: "social_check.consent",
  SOCIAL_CHECK_COMPLETED: "social_check.completed",
  BACKGROUND_CHECK_ORDERED: "background_check.ordered",
  BACKGROUND_CHECK_UPDATED: "background_check.updated",
  PRE_ADVERSE_SENT: "background_check.pre_adverse_sent",
  ADVERSE_ACTION_SENT: "background_check.adverse_action_sent",
  RECORDING_VIEWED: "recording.viewed",
  RECORDING_DELETED: "recording.deleted",
  NOTE_CREATED: "candidate_note.created",
  NOTE_UPDATED: "candidate_note.updated",
  ATTEMPT_INVALIDATED: "attempt.invalidated",
  RETEST_AUTHORIZED: "attempt.retest_authorized",
  RESUME_LINK_ISSUED: "attempt.resume_link_issued",
  RESUME_UPLOADED: "candidate_document.uploaded",
  RESUME_DELETED: "candidate_document.deleted",
  AI_CANDIDATE_ANALYSIS: "ai.candidate_analysis",
  AI_JOB_DESCRIPTION_ANALYSIS: "ai.job_description_analysis",
  JOB_DESCRIPTION_UPDATED: "job_profile.job_description_updated",
  ASSESSMENT_VERSION_CREATED: "assessment_version.created",
  ACCOMMODATION_GRANTED: "attempt.accommodation_granted",
  RETENTION_CHANGED: "retention.changed",
  RETENTION_RUN: "retention.run",
  LEGAL_HOLD_CREATED: "legal_hold.created",
  LEGAL_HOLD_RELEASED: "legal_hold.released",
  NORM_TABLE_CREATED: "norm_table.generated",
  SETTINGS_UPDATED: "settings.updated",
  USER_CREATED: "user.created",
  USER_UPDATED: "user.updated",
  HIRE_RECORDED: "hire.recorded",
  HIRE_UPDATED: "hire.updated",
  PERFORMANCE_CYCLE_CREATED: "performance_cycle.created",
  PERFORMANCE_CYCLE_STATUS_CHANGED: "performance_cycle.status_changed",
  PERFORMANCE_REVIEW_SUBMITTED: "performance_review.submitted",
  VALIDATION_STUDY_CREATED: "validation_study.created",
  VALIDATION_STUDY_COMPUTED: "validation_study.computed",
  VALIDATION_STUDY_REPORT_DOWNLOADED: "validation_study.report_downloaded",
  NORM_TABLE_ACTIVATED: "norm_table.activated",
  NORM_TABLE_RETIRED: "norm_table.retired",
  TALENT_POOL_CREATED: "talent_pool.created",
  TALENT_CONSENT_REQUESTED: "talent.consent_requested",
  TALENT_OPTED_IN: "talent.opted_in",
  TALENT_OPTED_OUT: "talent.opted_out",
  TALENT_SUPPRESSED: "talent.suppressed",
  TALENT_OUTREACH_RECORDED: "talent.outreach_recorded",
  WORK_SAMPLE_CREATED: "work_sample.created",
  WORK_SAMPLE_STATUS_CHANGED: "work_sample.status_changed",
  WORK_SAMPLE_ASSIGNED: "work_sample.assigned",
  WORK_SAMPLE_STARTED: "work_sample.started",
  WORK_SAMPLE_SUBMITTED: "work_sample.submitted",
  WORK_SAMPLE_FILE_DOWNLOADED: "work_sample.file_downloaded",
  SCHEDULING_REQUEST_CREATED: "scheduling.request_created",
  SCHEDULING_CANCELLED: "scheduling.cancelled",
  INTERVIEW_RECORDING_CONSENT_REQUESTED: "interview_recording.consent_requested",
  INTERVIEW_RECORDING_UPLOADED: "interview_recording.uploaded",
  INTERVIEW_RECORDING_TRANSCRIPT_STORED: "interview_recording.transcript_stored",
  INTERVIEW_RECORDING_EVIDENCE_EXTRACTED: "interview_recording.evidence_extracted",
  INTERVIEW_RECORDING_DESTROYED: "interview_recording.destroyed",
} as const;
