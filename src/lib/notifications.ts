import "server-only";
import { prisma } from "@/lib/db";
import type { NotificationType } from "@prisma/client";
import { JOB_TYPES, enqueueJob } from "@/lib/jobs/queue";

/**
 * Notification dispatch.
 *
 * Writes the in-app record immediately, then enqueues email delivery so a slow
 * or failing mail provider never blocks a user action.
 *
 * Anti-spam: a person receives at most one notification of the same type for
 * the same entity within the dedupe window. Reminder jobs rely on this rather
 * than tracking their own state.
 */

const DEDUPE_WINDOW_HOURS: Partial<Record<NotificationType, number>> = {
  TRAINING_DUE_SOON: 20,
  TRAINING_OVERDUE: 24 * 3,
  CERTIFICATE_EXPIRING: 24 * 7,
  CONTENT_REVIEW_DUE: 24 * 7,
  MANAGER_APPROVAL_NEEDED: 24,
  REACK_REQUIRED: 24 * 3,
};

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  linkUrl?: string;
  /** Entity key used for deduplication, e.g. "assignment:abc123". */
  dedupeKey?: string;
  /** Skip the email channel regardless of preference (used for low-value events). */
  inAppOnly?: boolean;
}

async function shouldSuppress(input: NotifyInput): Promise<boolean> {
  const windowHours = DEDUPE_WINDOW_HOURS[input.type];
  if (!windowHours || !input.dedupeKey) return false;

  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const existing = await prisma.notification.findFirst({
    where: {
      userId: input.userId,
      type: input.type,
      linkUrl: input.linkUrl ?? undefined,
      createdAt: { gte: since },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

export async function notify(input: NotifyInput): Promise<void> {
  if (await shouldSuppress(input)) return;

  const [user, preference] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, email: true, name: true, status: true },
    }),
    prisma.notificationPreference.findUnique({
      where: { userId_type: { userId: input.userId, type: input.type } },
      select: { inApp: true, email: true },
    }),
  ]);

  // Never notify deactivated people.
  if (!user || user.status === "INACTIVE") return;

  const wantsInApp = preference?.inApp ?? true;
  const wantsEmail = (preference?.email ?? true) && !input.inAppOnly;

  let notificationId: string | null = null;
  if (wantsInApp) {
    const created = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        linkUrl: input.linkUrl ?? null,
      },
      select: { id: true },
    });
    notificationId = created.id;
  }

  if (wantsEmail) {
    await enqueueJob(
      JOB_TYPES.SEND_EMAIL,
      {
        userId: input.userId,
        notificationId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        linkUrl: input.linkUrl ?? null,
      },
      {
        idempotencyKey: notificationId ? `email:${notificationId}` : undefined,
      },
    );
  }
}

/** Batch dispatch used by assignment and reminder jobs. */
export async function notifyMany(inputs: NotifyInput[]): Promise<void> {
  for (const input of inputs) {
    await notify(input);
  }
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}
