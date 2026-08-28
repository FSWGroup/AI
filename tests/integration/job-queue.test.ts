import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { freshDatabase, testPrisma } from "./helpers";
import {
  JOB_TYPES,
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  retryJob,
} from "@/lib/jobs/queue";

/**
 * The job queue.
 *
 * Reminders, recertification, content indexing, video rendering, and email all
 * depend on this. The properties that matter are the ones that only show up
 * under concurrency and failure: two workers must never claim the same job, an
 * idempotency key must prevent a duplicate enqueue, a crashed worker's lock must
 * be reclaimable, and a job must not retry forever.
 */

beforeEach(async () => {
  await freshDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("claiming", () => {
  it("returns null when the queue is empty", async () => {
    expect(await claimNextJob("worker-1")).toBeNull();
  });

  it("claims a queued job and marks it running", async () => {
    await enqueueJob(JOB_TYPES.MARK_OVERDUE, { scope: "all" });

    const job = await claimNextJob("worker-1");
    expect(job).toBeTruthy();
    expect(job?.type).toBe(JOB_TYPES.MARK_OVERDUE);
    expect(job?.attempts).toBe(1);

    const row = await testPrisma.job.findUniqueOrThrow({
      where: { id: job!.id },
      select: { status: true, lockedBy: true, lockedAt: true },
    });
    expect(row.status).toBe("RUNNING");
    expect(row.lockedBy).toBe("worker-1");
    expect(row.lockedAt).toBeInstanceOf(Date);
  });

  it("never hands the same job to two workers", async () => {
    await enqueueJob(JOB_TYPES.MARK_OVERDUE, {});

    const first = await claimNextJob("worker-1");
    const second = await claimNextJob("worker-2");

    expect(first).toBeTruthy();
    // Only one job exists, and it is already claimed.
    expect(second).toBeNull();
  });

  it("distributes distinct jobs across workers", async () => {
    for (let i = 0; i < 4; i += 1) {
      await enqueueJob(JOB_TYPES.SEND_EMAIL, { index: i });
    }

    const claimed = [
      await claimNextJob("worker-1"),
      await claimNextJob("worker-2"),
      await claimNextJob("worker-1"),
      await claimNextJob("worker-2"),
    ];

    const ids = claimed.map((j) => j?.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(4);
  });

  it("respects priority, then run time", async () => {
    await enqueueJob(JOB_TYPES.SEND_EMAIL, { label: "low" }, { priority: -1 });
    await enqueueJob(JOB_TYPES.SEND_EMAIL, { label: "high" }, { priority: 5 });
    await enqueueJob(JOB_TYPES.SEND_EMAIL, { label: "normal" }, { priority: 0 });

    const first = await claimNextJob("worker-1");
    const second = await claimNextJob("worker-1");
    const third = await claimNextJob("worker-1");

    expect((first?.payload as { label?: string }).label).toBe("high");
    expect((second?.payload as { label?: string }).label).toBe("normal");
    expect((third?.payload as { label?: string }).label).toBe("low");
  });

  it("does not claim a job scheduled for the future", async () => {
    await enqueueJob(
      JOB_TYPES.SEND_DUE_REMINDERS,
      {},
      { runAt: new Date(Date.now() + 60 * 60 * 1000) },
    );

    expect(await claimNextJob("worker-1")).toBeNull();
  });

  it("reclaims a job whose worker died", async () => {
    await enqueueJob(JOB_TYPES.RENDER_VIDEO, { jobId: "v1" });

    const first = await claimNextJob("worker-1");
    expect(first).toBeTruthy();

    // Immediately, another worker must not steal it.
    expect(await claimNextJob("worker-2")).toBeNull();

    // Backdate the lock past the timeout, simulating a crashed worker.
    await testPrisma.$executeRaw`
      UPDATE "Job" SET "lockedAt" = NOW() - INTERVAL '30 minutes' WHERE "id" = ${first!.id}
    `;

    const reclaimed = await claimNextJob("worker-2", 15 * 60 * 1000);
    expect(reclaimed?.id).toBe(first!.id);
    // The attempt counter advances, so a job that repeatedly kills its worker
    // still exhausts its retries rather than looping forever.
    expect(reclaimed?.attempts).toBe(2);
  });
});

describe("idempotency", () => {
  it("ignores a second enqueue with the same key", async () => {
    const first = await enqueueJob(JOB_TYPES.MARK_OVERDUE, {}, { idempotencyKey: "overdue:2026-08-28T02" });
    const second = await enqueueJob(JOB_TYPES.MARK_OVERDUE, {}, { idempotencyKey: "overdue:2026-08-28T02" });

    expect(first).toBeTruthy();
    expect(second).toBeNull();
    expect(await testPrisma.job.count()).toBe(1);
  });

  it("allows the same job type with different keys", async () => {
    await enqueueJob(JOB_TYPES.MARK_OVERDUE, {}, { idempotencyKey: "overdue:hour-1" });
    await enqueueJob(JOB_TYPES.MARK_OVERDUE, {}, { idempotencyKey: "overdue:hour-2" });

    expect(await testPrisma.job.count()).toBe(2);
  });

  it("lets several workers schedule the same recurring work without multiplying it", async () => {
    // This is what stops three workers from sending three sets of reminders.
    const key = "reminders:2026-08-28";
    const results = await Promise.all([
      enqueueJob(JOB_TYPES.SEND_DUE_REMINDERS, {}, { idempotencyKey: key }),
      enqueueJob(JOB_TYPES.SEND_DUE_REMINDERS, {}, { idempotencyKey: key }),
      enqueueJob(JOB_TYPES.SEND_DUE_REMINDERS, {}, { idempotencyKey: key }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await testPrisma.job.count()).toBe(1);
  });
});

describe("completion and failure", () => {
  it("marks a job complete and clears its lock", async () => {
    await enqueueJob(JOB_TYPES.INDEX_CONTENT, { entityType: "SOP", entityId: "x" });
    const job = await claimNextJob("worker-1");
    await completeJob(job!.id);

    const row = await testPrisma.job.findUniqueOrThrow({
      where: { id: job!.id },
      select: { status: true, lockedAt: true, lockedBy: true, lastError: true },
    });
    expect(row.status).toBe("COMPLETE");
    expect(row.lockedAt).toBeNull();
    expect(row.lockedBy).toBeNull();
    expect(row.lastError).toBeNull();
  });

  it("requeues with backoff on a retryable failure", async () => {
    await enqueueJob(JOB_TYPES.SEND_EMAIL, {}, { maxAttempts: 3 });
    const job = await claimNextJob("worker-1");

    await failJob(job!.id, new Error("SMTP connection refused"));

    const row = await testPrisma.job.findUniqueOrThrow({
      where: { id: job!.id },
      select: { status: true, lastError: true, runAt: true, attempts: true },
    });
    expect(row.status).toBe("QUEUED");
    expect(row.lastError).toContain("SMTP connection refused");
    expect(row.attempts).toBe(1);
    // Backoff pushes the next attempt into the future, so a failing provider is
    // not hammered.
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("parks a job in FAILED once attempts are exhausted", async () => {
    await enqueueJob(JOB_TYPES.SEND_EMAIL, {}, { maxAttempts: 2 });

    for (let i = 0; i < 2; i += 1) {
      // Make the job claimable again regardless of backoff.
      await testPrisma.job.updateMany({ data: { runAt: new Date(0) } });
      const job = await claimNextJob("worker-1");
      expect(job, `attempt ${i + 1} should be claimable`).toBeTruthy();
      await failJob(job!.id, new Error("persistent failure"));
    }

    const row = await testPrisma.job.findFirstOrThrow({
      select: { status: true, attempts: true, lastError: true },
    });
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(2);
    expect(row.lastError).toContain("persistent failure");

    // A parked job is not picked up again on its own.
    await testPrisma.job.updateMany({ data: { runAt: new Date(0) } });
    expect(await claimNextJob("worker-1")).toBeNull();
  });

  it("truncates a very long error rather than failing the update", async () => {
    await enqueueJob(JOB_TYPES.RENDER_VIDEO, {});
    const job = await claimNextJob("worker-1");

    await failJob(job!.id, new Error("x".repeat(10_000)));

    const row = await testPrisma.job.findUniqueOrThrow({
      where: { id: job!.id },
      select: { lastError: true },
    });
    expect(row.lastError!.length).toBeLessThanOrEqual(2000);
  });

  it("handles a non-Error rejection", async () => {
    await enqueueJob(JOB_TYPES.AI_GENERATE, {});
    const job = await claimNextJob("worker-1");

    await failJob(job!.id, "a string rejection");

    const row = await testPrisma.job.findUniqueOrThrow({
      where: { id: job!.id },
      select: { lastError: true },
    });
    expect(row.lastError).toContain("a string rejection");
  });

  it("lets an administrator retry a failed job", async () => {
    await enqueueJob(JOB_TYPES.RENDER_VIDEO, {}, { maxAttempts: 1 });
    const job = await claimNextJob("worker-1");
    await failJob(job!.id, new Error("render crashed"));

    const failed = await testPrisma.job.findUniqueOrThrow({
      where: { id: job!.id },
      select: { status: true },
    });
    expect(failed.status).toBe("FAILED");

    await retryJob(job!.id);

    const requeued = await testPrisma.job.findUniqueOrThrow({
      where: { id: job!.id },
      select: { status: true, attempts: true, lastError: true },
    });
    expect(requeued.status).toBe("QUEUED");
    expect(requeued.attempts).toBe(0);
    expect(requeued.lastError).toBeNull();

    // And it becomes claimable again.
    expect(await claimNextJob("worker-1")).toBeTruthy();
  });

  it("ignores failure for a job that no longer exists", async () => {
    await expect(failJob("does-not-exist", new Error("boom"))).resolves.toBeUndefined();
  });
});

describe("payloads", () => {
  it("round-trips a structured payload", async () => {
    const payload = {
      entityType: "SOP",
      entityId: "sop_123",
      nested: { retrain: true, versions: ["1.0", "2.0"] },
    };
    await enqueueJob(JOB_TYPES.INDEX_CONTENT, payload);

    const job = await claimNextJob("worker-1");
    expect(job?.payload).toEqual(payload);
  });

  it("accepts an empty payload", async () => {
    await enqueueJob(JOB_TYPES.RETENTION_SWEEP, {});
    const job = await claimNextJob("worker-1");
    expect(job?.payload).toEqual({});
  });
});
