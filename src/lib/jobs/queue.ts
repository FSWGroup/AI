import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/**
 * Postgres-backed job queue.
 *
 * Chosen over an external service (Inngest/Trigger.dev) because it needs no
 * additional vendor, works identically in development and production, and the
 * platform already depends on Postgres. Claiming uses
 * `FOR UPDATE SKIP LOCKED`, so multiple workers scale horizontally without
 * double-processing.
 *
 * Jobs are idempotent by construction: handlers check current state before
 * acting, and `idempotencyKey` prevents duplicate enqueues.
 */

export const JOB_TYPES = {
  RENDER_VIDEO: "render_video",
  GENERATE_VIDEO_PLAN: "generate_video_plan",
  AI_GENERATE: "ai_generate",
  INDEX_CONTENT: "index_content",
  SEND_EMAIL: "send_email",
  SEND_NOTIFICATION: "send_notification",
  EVALUATE_ASSIGNMENT_RULES: "evaluate_assignment_rules",
  SEND_DUE_REMINDERS: "send_due_reminders",
  MARK_OVERDUE: "mark_overdue",
  PROCESS_RECERTIFICATION: "process_recertification",
  SOP_REVIEW_REMINDERS: "sop_review_reminders",
  CHECK_LINKS: "check_links",
  TRANSCRIBE_MEDIA: "transcribe_media",
  DELIVER_WEBHOOK: "deliver_webhook",
  RETENTION_SWEEP: "retention_sweep",
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

export interface EnqueueOptions {
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
  /** When set, a second enqueue with the same key is ignored. */
  idempotencyKey?: string;
}

export async function enqueueJob(
  type: JobType,
  payload: Record<string, unknown>,
  options: EnqueueOptions = {},
): Promise<string | null> {
  const runAt = options.runAt ?? new Date();
  const priority = options.priority ?? 0;
  const maxAttempts = options.maxAttempts ?? 3;

  if (options.idempotencyKey) {
    /*
     * ON CONFLICT DO NOTHING rather than catching a unique violation.
     *
     * A collision here is normal operation, not an error: every worker
     * schedules the same recurring work each minute and all but one is meant to
     * be discarded. Letting the constraint throw would emit a "Unique
     * constraint failed" line from the Prisma error logger every minute in
     * production, burying real failures in noise.
     */
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO "Job" ("id", "type", "payload", "status", "priority", "runAt",
                         "attempts", "maxAttempts", "idempotencyKey",
                         "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, ${type}, ${payload as Prisma.InputJsonValue}::jsonb,
              'QUEUED', ${priority}, ${runAt}, 0, ${maxAttempts},
              ${options.idempotencyKey}, NOW(), NOW())
      ON CONFLICT ("idempotencyKey") DO NOTHING
      RETURNING "id"
    `;
    return rows[0]?.id ?? null;
  }

  const job = await prisma.job.create({
    data: {
      type,
      payload: payload as Prisma.InputJsonValue,
      runAt,
      priority,
      maxAttempts,
    },
    select: { id: true },
  });
  return job.id;
}

export interface ClaimedJob {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

/**
 * Atomically claim the next runnable job. Returns null when the queue is idle.
 * Stale locks (worker crash) are reclaimed after the lock timeout.
 */
export async function claimNextJob(workerId: string, lockTimeoutMs = 15 * 60 * 1000): Promise<ClaimedJob | null> {
  const staleBefore = new Date(Date.now() - lockTimeoutMs);

  const rows = await prisma.$queryRaw<
    { id: string; type: string; payload: unknown; attempts: number; maxAttempts: number }[]
  >`
    UPDATE "Job"
    SET "status" = 'RUNNING',
        "lockedAt" = NOW(),
        "lockedBy" = ${workerId},
        "attempts" = "attempts" + 1,
        "updatedAt" = NOW()
    WHERE "id" = (
      SELECT "id" FROM "Job"
      WHERE ("status" = 'QUEUED' AND "runAt" <= NOW())
         OR ("status" = 'RUNNING' AND "lockedAt" < ${staleBefore})
      ORDER BY "priority" DESC, "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id", "type", "payload", "attempts", "maxAttempts"
  `;

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    type: row.type,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
  };
}

export async function completeJob(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "COMPLETE", lockedAt: null, lockedBy: null, lastError: null },
  });
}

/**
 * Mark a job failed. Retries with exponential backoff until maxAttempts, then
 * parks the job in FAILED so an administrator can inspect and retry it.
 */
export async function failJob(jobId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { attempts: true, maxAttempts: true },
  });
  if (!job) return;

  const exhausted = job.attempts >= job.maxAttempts;
  const backoffSeconds = Math.min(3600, 2 ** job.attempts * 30);

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: exhausted ? "FAILED" : "QUEUED",
      lastError: message.slice(0, 2000),
      lockedAt: null,
      lockedBy: null,
      runAt: exhausted ? undefined : new Date(Date.now() + backoffSeconds * 1000),
    },
  });
}

/** Re-queue a FAILED job (admin action). Clears the attempt counter. */
export async function retryJob(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "QUEUED", attempts: 0, runAt: new Date(), lastError: null },
  });
}
