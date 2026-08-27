/**
 * Scheduled retention job (run via cron: `npm run retention:run`).
 *
 * Applies configured RetentionPolicy rows, skipping anything under an active
 * legal hold. Object-store deletions and database deletions are performed
 * together so the two never disagree. Every run and every deletion batch is
 * recorded in the audit log.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const { getStorage } = await import("../src/lib/storage");
  const run = await prisma.retentionRun.create({ data: {} });
  const policies = await prisma.retentionPolicy.findMany({
    where: { retentionDays: { not: null } },
  });
  const holds = await prisma.legalHold.findMany({ where: { active: true } });
  const globalHold = holds.some((h) => h.scope === "GLOBAL");
  const heldAttemptIds = new Set(
    holds
      .filter((h) => h.scope.startsWith("ATTEMPT:"))
      .map((h) => h.scope.slice("ATTEMPT:".length)),
  );
  const heldCandidateIds = new Set(
    holds
      .filter((h) => h.scope.startsWith("CANDIDATE:"))
      .map((h) => h.scope.slice("CANDIDATE:".length)),
  );

  const summary: Record<string, number> = {};

  for (const policy of policies) {
    if (globalHold) {
      summary[policy.recordType] = -1; // skipped: global hold
      continue;
    }
    const cutoff = new Date(Date.now() - policy.retentionDays! * 24 * 3600 * 1000);
    let deleted = 0;

    switch (policy.recordType) {
      case "WEBCAM_RECORDINGS": {
        const recordings = await prisma.recording.findMany({
          where: { startedAt: { lt: cutoff }, status: { not: "DELETED" } },
          include: { attempt: { select: { candidateId: true } } },
        });
        const storage = getStorage();
        for (const rec of recordings) {
          if (
            heldAttemptIds.has(rec.attemptId) ||
            heldCandidateIds.has(rec.attempt.candidateId)
          ) {
            continue;
          }
          await storage.deletePrefix(
            `assessment-recordings/${rec.attemptId}/${rec.sessionId}/`,
          );
          await prisma.recordingChunk.deleteMany({ where: { recordingId: rec.id } });
          await prisma.recording.update({
            where: { id: rec.id },
            data: { status: "DELETED", deletedAt: new Date() },
          });
          deleted++;
        }
        break;
      }
      case "ASSESSMENT_ANSWERS": {
        const attempts = await prisma.attempt.findMany({
          where: { completedAt: { lt: cutoff } },
          select: { id: true, candidateId: true },
        });
        for (const a of attempts) {
          if (heldAttemptIds.has(a.id) || heldCandidateIds.has(a.candidateId)) continue;
          const res = await prisma.response.deleteMany({ where: { attemptId: a.id } });
          deleted += res.count;
        }
        break;
      }
      case "SCORE_REPORT_DATA": {
        const attempts = await prisma.attempt.findMany({
          where: { completedAt: { lt: cutoff } },
          select: { id: true, candidateId: true },
        });
        const storage = getStorage();
        for (const a of attempts) {
          if (heldAttemptIds.has(a.id) || heldCandidateIds.has(a.candidateId)) continue;
          await storage.deletePrefix(`reports/${a.id}/`);
          const r1 = await prisma.report.deleteMany({ where: { attemptId: a.id } });
          const r2 = await prisma.score.deleteMany({ where: { attemptId: a.id } });
          const r3 = await prisma.compositeScore.deleteMany({ where: { attemptId: a.id } });
          deleted += r1.count + r2.count + r3.count;
        }
        break;
      }
      case "INVITATION_RECORDS": {
        const res = await prisma.invitation.deleteMany({
          where: {
            createdAt: { lt: cutoff },
            status: { in: ["EXPIRED", "REVOKED"] },
            attempts: { none: {} },
          },
        });
        deleted = res.count;
        break;
      }
      case "INTEGRITY_EVENT_LOGS": {
        const events = await prisma.integrityEvent.findMany({
          where: { occurredAt: { lt: cutoff } },
          select: { id: true, attemptId: true, attempt: { select: { candidateId: true } } },
        });
        const deletable = events
          .filter(
            (e) =>
              !heldAttemptIds.has(e.attemptId) &&
              !heldCandidateIds.has(e.attempt.candidateId),
          )
          .map((e) => e.id);
        const res = await prisma.integrityEvent.deleteMany({
          where: { id: { in: deletable } },
        });
        deleted = res.count;
        break;
      }
      case "AUDIT_RECORDS": {
        const res = await prisma.auditEvent.deleteMany({
          where: { createdAt: { lt: cutoff } },
        });
        deleted = res.count;
        break;
      }
    }
    summary[policy.recordType] = deleted;
  }

  await prisma.retentionRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), summary },
  });
  await prisma.auditEvent.create({
    data: {
      actorLabel: "system:retention",
      action: "retention.run",
      entityType: "RetentionRun",
      entityId: run.id,
      newValue: summary,
    },
  });
  console.log("Retention run complete:", summary);
}

main()
  .catch((err) => {
    console.error("Retention run failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
