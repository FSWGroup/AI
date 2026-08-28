import type { Metadata } from 'next';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireCtx, requireCtxAction } from '@/lib/authz';
import { fmtDateTime } from '@/lib/format';
import { Badge, Card, EmptyState, PageHeader, cx } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

export const metadata: Metadata = { title: 'Notifications' };

async function markAllRead() {
  'use server';
  const ctx = await requireCtxAction();
  await db.notification.updateMany({
    where: { userId: ctx.userId, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath('/notifications');
}

export default async function NotificationsPage() {
  const ctx = await requireCtx();
  const notifications = await db.notification.findMany({
    where: { userId: ctx.userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const toneFor: Record<string, 'gray' | 'blue' | 'amber' | 'red'> = {
    INFO: 'gray',
    TASK: 'blue',
    APPROVAL: 'amber',
    COMPLIANCE: 'red',
    SYSTEM: 'gray',
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Notifications"
        actions={
          <form action={markAllRead}>
            <SubmitButton variant="secondary" size="sm">
              Mark all read
            </SubmitButton>
          </form>
        }
      />
      <Card>
        {notifications.length === 0 ? (
          <EmptyState title="No notifications yet" description="Task assignments, approvals and HR updates will land here." />
        ) : (
          <ul className="divide-y divide-ink-100">
            {notifications.map((n) => {
              const inner = (
                <div className={cx('px-5 py-3', !n.readAt && 'bg-brand-50/50')}>
                  <div className="flex items-center gap-2">
                    <Badge tone={toneFor[n.kind] ?? 'gray'}>{n.kind.toLowerCase()}</Badge>
                    <span className={cx('text-sm', n.readAt ? 'text-ink-700' : 'font-medium text-ink-900')}>{n.title}</span>
                  </div>
                  {n.body ? <p className="mt-1 text-[13px] text-ink-500">{n.body}</p> : null}
                  <div className="mt-1 text-[12px] text-ink-400">{fmtDateTime(n.createdAt)}</div>
                </div>
              );
              return (
                <li key={n.id}>{n.href ? <Link href={n.href} className="block hover:bg-brand-50/40">{inner}</Link> : inner}</li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
