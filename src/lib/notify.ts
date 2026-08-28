import 'server-only';
import { db } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { env } from '@/lib/env';

/**
 * In-app notification, optionally mirrored to email.
 * User preferences (User.notificationPrefs JSON: {emailTasks, emailApprovals,
 * emailGeneral}) are respected except for COMPLIANCE-kind notifications,
 * which always deliver (§39).
 */
export async function notifyUser(
  userId: string,
  opts: {
    kind?: 'INFO' | 'TASK' | 'APPROVAL' | 'COMPLIANCE' | 'SYSTEM';
    title: string;
    body?: string;
    href?: string;
    email?: boolean;
  },
) {
  const kind = opts.kind ?? 'INFO';
  await db.notification.create({
    data: { userId, kind, title: opts.title, body: opts.body ?? null, href: opts.href ?? null },
  });
  if (opts.email) {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) return;
    const prefs = (user.notificationPrefs ?? {}) as Record<string, boolean>;
    const prefKey = kind === 'TASK' ? 'emailTasks' : kind === 'APPROVAL' ? 'emailApprovals' : 'emailGeneral';
    const allowed = kind === 'COMPLIANCE' || prefs[prefKey] !== false;
    if (allowed) {
      await sendEmail({
        to: user.email,
        subject: `FSW People: ${opts.title}`,
        heading: opts.title,
        bodyHtml: `<p>${opts.body ?? ''}</p>`,
        ctaLabel: opts.href ? 'Open in FSW People' : undefined,
        ctaUrl: opts.href ? `${env.APP_BASE_URL}${opts.href}` : undefined,
        templateKey: 'notification',
      });
    }
  }
}

export async function notifyRole(
  roleKey: string,
  opts: Parameters<typeof notifyUser>[1],
) {
  const users = await db.userRole.findMany({
    where: { role: { key: roleKey }, user: { status: 'ACTIVE' } },
    select: { userId: true },
  });
  for (const u of users) await notifyUser(u.userId, opts);
}
