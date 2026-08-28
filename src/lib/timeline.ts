import 'server-only';
import { db } from '@/lib/db';

export type TimelineVisibility = 'SELF' | 'MANAGER' | 'HR' | 'COMP' | 'HR_CONFIDENTIAL';

export async function recordTimeline(opts: {
  workerId: string;
  kind: string;
  title: string;
  detail?: string;
  visibility?: TimelineVisibility;
  actorUserId?: string | null;
  occurredAt?: Date;
}) {
  await db.timelineEvent.create({
    data: {
      workerId: opts.workerId,
      kind: opts.kind,
      title: opts.title,
      detail: opts.detail ?? null,
      visibility: opts.visibility ?? 'MANAGER',
      actorUserId: opts.actorUserId ?? null,
      occurredAt: opts.occurredAt ?? new Date(),
    },
  });
}
