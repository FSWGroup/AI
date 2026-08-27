/**
 * Attempt completion pipeline:
 *  1. finalize responses (mark remaining questions unanswered)
 *  2. mark attempt COMPLETED
 *  3. calculate scores (deterministic)
 *  4. generate the report
 *  5. notify HR (never with scores or questions in the email)
 *
 * Recording finalization happens separately via the recording routes; a
 * recording that fails to finalize never blocks completion or affects scores.
 */

import { prisma } from "@/lib/db";
import { getEmailProvider } from "@/lib/email";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { scoreAttempt } from "./score-attempt";
import { generateReport } from "@/lib/report/generate";

export async function completeAttempt(attemptId: string): Promise<void> {
  const attempt = await prisma.attempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: {
      sections: true,
      candidate: true,
      jobOpening: true,
      questions: { select: { id: true, response: { select: { id: true } } } },
    },
  });
  if (attempt.status === "COMPLETED") return;

  // Close any still-open sections (their unanswered questions stay unanswered).
  await prisma.attemptSection.updateMany({
    where: { attemptId, status: { in: ["PENDING", "IN_PROGRESS"] } },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  // Ensure every served question has a response row (unanswered where none).
  const missing = attempt.questions.filter((q) => !q.response);
  if (missing.length > 0) {
    await prisma.response.createMany({
      data: missing.map((q) => ({
        attemptId,
        attemptQuestionId: q.id,
        unanswered: true,
      })),
      skipDuplicates: true,
    });
  }

  await prisma.attempt.update({
    where: { id: attemptId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  await prisma.invitation.update({
    where: { id: attempt.invitationId },
    data: { status: "COMPLETED" },
  });
  await prisma.integrityEvent.create({
    data: { attemptId, type: "ATTEMPT_COMPLETED" },
  });

  await scoreAttempt(attemptId);
  const reportId = await generateReport(attemptId);
  await audit({
    actorLabel: "system:completion",
    action: AUDIT_ACTIONS.REPORT_GENERATED,
    entityType: "Report",
    entityId: reportId,
    newValue: { attemptId, trigger: "completion" },
  });

  // Notify HR — status only; never scores, questions, or recordings.
  const settings = await prisma.orgSettings.findUnique({ where: { id: "org" } });
  if (settings?.hrNotificationEmail) {
    try {
      await getEmailProvider().send({
        to: settings.hrNotificationEmail,
        template: "completed_notification",
        subject: `Assessment completed — ${attempt.candidate.firstName} ${attempt.candidate.lastName}`,
        bodyText:
          `${attempt.candidate.firstName} ${attempt.candidate.lastName} has completed the ` +
          `FSW WorkFit assessment for ${attempt.jobOpening.title}.\n\n` +
          `Sign in to the FSW WorkFit admin portal to review results.`,
      });
    } catch {
      // Notification failure must never break candidate completion.
    }
  }
}
