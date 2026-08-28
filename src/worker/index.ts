/**
 * Background worker.
 *
 * Polls the Postgres job queue and dispatches to handlers. Run one or more
 * instances alongside the web application:
 *
 *   npm run worker
 *
 * Horizontal scaling is safe: `claimNextJob` uses FOR UPDATE SKIP LOCKED, so
 * two workers never process the same job.
 *
 * Scheduled work (reminders, overdue sweeps, recertification, review notices,
 * link checks, retention) is enqueued by the internal scheduler below, guarded
 * by idempotency keys so running several workers does not multiply the work.
 */

import { randomUUID } from "node:crypto";
import { JOB_TYPES, claimNextJob, completeJob, enqueueJob, failJob } from "@/lib/jobs/queue";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";

const WORKER_ID = `${process.env.HOSTNAME ?? "worker"}-${randomUUID().slice(0, 8)}`;
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_MS ?? 2000);
const SCHEDULE_INTERVAL_MS = 60_000;

let shuttingDown = false;

type Handler = (payload: Record<string, unknown>) => Promise<void>;

/**
 * Handlers are loaded lazily so a module that fails to import (for example an
 * unconfigured optional capability) disables only its own job type.
 */
async function resolveHandler(type: string): Promise<Handler | null> {
  switch (type) {
    case JOB_TYPES.INDEX_CONTENT: {
      const mod = await import("@/lib/ai/indexer");
      return mod.handleIndexContentJob as Handler;
    }
    case JOB_TYPES.AI_GENERATE: {
      const mod = await import("@/lib/ai/generate");
      return mod.handleAiGenerateJob as Handler;
    }
    case JOB_TYPES.GENERATE_VIDEO_PLAN: {
      const mod = await import("@/lib/video/render");
      return mod.handleGenerateVideoPlanJob as Handler;
    }
    case JOB_TYPES.RENDER_VIDEO: {
      const mod = await import("@/lib/video/render");
      return mod.handleRenderVideoJob as Handler;
    }
    case JOB_TYPES.SEND_EMAIL: {
      const mod = await import("@/lib/services/integrations");
      return mod.handleSendEmailJob as Handler;
    }
    case JOB_TYPES.DELIVER_WEBHOOK: {
      const mod = await import("@/lib/services/integrations");
      return mod.handleDeliverWebhookJob as Handler;
    }
    case JOB_TYPES.CHECK_LINKS: {
      const mod = await import("@/lib/services/integrations");
      return mod.handleCheckLinksJob as Handler;
    }
    case JOB_TYPES.RETENTION_SWEEP: {
      const mod = await import("@/lib/services/integrations");
      return mod.handleRetentionSweepJob as Handler;
    }
    case JOB_TYPES.TRANSCRIBE_MEDIA: {
      const mod = await import("@/lib/services/integrations");
      return mod.handleTranscribeMediaJob as Handler;
    }
    case JOB_TYPES.EVALUATE_ASSIGNMENT_RULES: {
      const mod = await import("@/lib/services/assignment");
      return mod.handleEvaluateAssignmentRulesJob as Handler;
    }
    case JOB_TYPES.MARK_OVERDUE: {
      const mod = await import("@/lib/services/assignment");
      return mod.handleMarkOverdueJob as Handler;
    }
    case JOB_TYPES.SEND_DUE_REMINDERS: {
      const mod = await import("@/lib/services/assignment");
      return mod.handleSendDueRemindersJob as Handler;
    }
    case JOB_TYPES.PROCESS_RECERTIFICATION: {
      const mod = await import("@/lib/services/assignment");
      return mod.handleProcessRecertificationJob as Handler;
    }
    case JOB_TYPES.SOP_REVIEW_REMINDERS: {
      const mod = await import("@/lib/services/sop");
      return mod.handleSopReviewRemindersJob as Handler;
    }
    default:
      return null;
  }
}

/**
 * Enqueue recurring work. The idempotency key includes the period, so repeated
 * scheduler ticks (and multiple workers) collapse to one job per period.
 */
async function scheduleRecurringWork(): Promise<void> {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const hour = `${day}T${String(now.getUTCHours()).padStart(2, "0")}`;

  const schedules: { type: string; key: string; payload?: Record<string, unknown> }[] = [
    { type: JOB_TYPES.MARK_OVERDUE, key: `overdue:${hour}` },
    { type: JOB_TYPES.SEND_DUE_REMINDERS, key: `reminders:${day}` },
    { type: JOB_TYPES.PROCESS_RECERTIFICATION, key: `recert:${day}` },
    { type: JOB_TYPES.SOP_REVIEW_REMINDERS, key: `sopreview:${day}` },
    { type: JOB_TYPES.EVALUATE_ASSIGNMENT_RULES, key: `rules:${day}`, payload: { scope: "all" } },
    { type: JOB_TYPES.CHECK_LINKS, key: `links:${day}` },
    { type: JOB_TYPES.RETENTION_SWEEP, key: `retention:${day}` },
  ];

  for (const schedule of schedules) {
    await enqueueJob(schedule.type as never, schedule.payload ?? {}, {
      idempotencyKey: schedule.key,
      priority: -1,
    });
  }
}

async function processOne(): Promise<boolean> {
  const job = await claimNextJob(WORKER_ID);
  if (!job) return false;

  const startedAt = Date.now();
  logger.info("job started", { jobId: job.id, type: job.type, attempt: job.attempts });

  try {
    const handler = await resolveHandler(job.type);
    if (!handler) {
      throw new Error(`No handler registered for job type "${job.type}"`);
    }

    await handler(job.payload);
    await completeJob(job.id);
    logger.info("job completed", {
      jobId: job.id,
      type: job.type,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logger.exception(error, { jobId: job.id, type: job.type, attempt: job.attempts });
    await failJob(job.id, error);
  }

  return true;
}

async function main(): Promise<void> {
  logger.info("worker starting", { workerId: WORKER_ID, pollMs: POLL_INTERVAL_MS });

  // Verify the database is reachable before entering the loop.
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    logger.exception(error, { stage: "startup", detail: "database unreachable" });
    process.exit(1);
  }

  let lastSchedule = 0;

  while (!shuttingDown) {
    try {
      if (Date.now() - lastSchedule > SCHEDULE_INTERVAL_MS) {
        lastSchedule = Date.now();
        await scheduleRecurringWork();
      }

      // Drain the queue before sleeping so bursts are handled promptly.
      let processed = false;
      for (let i = 0; i < 20; i += 1) {
        if (shuttingDown) break;
        const didWork = await processOne();
        if (!didWork) break;
        processed = true;
      }

      if (!processed) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch (error) {
      logger.exception(error, { stage: "loop" });
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  logger.info("worker stopped", { workerId: WORKER_ID });
  await prisma.$disconnect();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(1);
    logger.info("worker shutdown requested", { signal });
    shuttingDown = true;
  });
}

void main();
