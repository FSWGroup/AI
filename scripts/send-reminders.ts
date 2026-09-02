/**
 * Interview reminder job (run via cron: `npm run reminders:run`).
 *
 * Queuing a reminder that nothing ever sends is worse than not queuing it,
 * because the interface implies the candidate was reminded. This is the other
 * half.
 *
 * Each reminder is marked sent before the next is attempted, so a crash
 * mid-run resends nothing. A reminder whose interview moved or was cancelled
 * was marked cancelled at that moment and is skipped here.
 */

import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrl } from "../src/lib/database-url";

resolveDatabaseUrl();
const prisma = new PrismaClient();

/** Don't send a "tomorrow" reminder three days late after an outage. */
const MAX_LATENESS_HOURS = 6;

function formatIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
}

async function main(): Promise<void> {
  const now = new Date();
  const floor = new Date(now.getTime() - MAX_LATENESS_HOURS * 3600_000);

  const due = await prisma.scheduledReminder.findMany({
    where: {
      sentAt: null,
      cancelledAt: null,
      dueAt: { lte: now, gte: floor },
      interview: { status: "SCHEDULED" },
    },
    include: {
      user: { select: { email: true, name: true, timeZone: true } },
      interview: {
        include: {
          application: {
            include: {
              candidate: { select: { firstName: true, email: true } },
              requisition: { select: { title: true } },
            },
          },
          schedulingRequest: { select: { candidateTimeZone: true } },
        },
      },
    },
    orderBy: { dueAt: "asc" },
    take: 500,
  });

  if (due.length === 0) {
    console.log("No reminders due.");
    return;
  }

  const settings = await prisma.orgSettings.findUnique({ where: { id: "org" } });
  const company = settings?.companyName ?? "FSW Group";
  const orgZone = settings?.timeZone ?? "Asia/Manila";
  const { sendEmail } = await import("../src/lib/email");

  let sent = 0;
  for (const reminder of due) {
    const interview = reminder.interview;
    const toCandidate = reminder.userId === null;
    const zone = toCandidate
      ? (interview.schedulingRequest?.candidateTimeZone ?? orgZone)
      : (reminder.user?.timeZone ?? orgZone);
    const when = formatIn(interview.scheduledAt, zone);
    const where = interview.meetingDetail
      ? `\n\nWhere: ${interview.meetingDetail}`
      : "";

    const payload = toCandidate
      ? {
          to: interview.application.candidate.email,
          template: "reminder" as const,
          subject: `Reminder: your ${interview.title} with ${company}`,
          bodyText: [
            `Hello ${interview.application.candidate.firstName},`,
            "",
            `This is a reminder about your ${interview.title} for ${interview.application.requisition.title}.`,
            "",
            `When: ${when}`.concat(where),
            "",
            "If you need to move or cancel it, use the same link you booked with.",
            "",
            company,
          ].join("\n"),
        }
      : {
          to: reminder.user?.email ?? "",
          template: "reminder" as const,
          subject: `Tomorrow: ${interview.application.candidate.firstName} — ${interview.title}`,
          bodyText: [
            `You are interviewing ${interview.application.candidate.firstName} for ${interview.application.requisition.title}.`,
            "",
            `When: ${when}`.concat(where),
          ].join("\n"),
        };

    if (!payload.to) {
      await prisma.scheduledReminder.update({
        where: { id: reminder.id },
        data: { cancelledAt: new Date() },
      });
      continue;
    }

    // Marked sent first. A send that succeeds and then fails to record is a
    // reminder the next run sends again, and two reminders read as a mistake.
    await prisma.scheduledReminder.update({
      where: { id: reminder.id },
      data: { sentAt: new Date() },
    });
    try {
      await sendEmail(payload);
      sent++;
    } catch (err) {
      console.error(
        `[reminders] could not send ${reminder.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Anything that fell off the back of the window is stale rather than due.
  const stale = await prisma.scheduledReminder.updateMany({
    where: { sentAt: null, cancelledAt: null, dueAt: { lt: floor } },
    data: { cancelledAt: new Date() },
  });

  console.log(
    `Reminders: ${sent} sent, ${due.length - sent} skipped, ${stale.count} too late to be useful.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
