'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireCtxAction, requirePermission, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import type { ActionResult } from '@/app/(auth)/actions';

function sanitize(text: string): string {
  return text.replace(/</g, '&lt;').replace(/\n/g, '<br/>');
}

export async function publishAnnouncementAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('announce.admin');
    const title = String(formData.get('title') ?? '').trim();
    const body = String(formData.get('body') ?? '').trim();
    if (!title || !body) return { error: 'Title and message are required.' };
    const countries = formData.getAll('countries').map(String).filter(Boolean);
    const announcement = await db.announcement.create({
      data: {
        title,
        bodyHtml: sanitize(body),
        audience: countries.length ? { countries } : {},
        publishAt: formData.get('publishAt') ? new Date(String(formData.get('publishAt'))) : new Date(),
        expiresAt: formData.get('expiresAt') ? new Date(String(formData.get('expiresAt'))) : null,
        pinned: formData.get('pinned') === 'on',
        requiresAck: formData.get('requiresAck') === 'on',
        authorUserId: ctx.userId,
      },
    });
    await audit(ctx, 'announcement.published', { targetType: 'Announcement', targetId: announcement.id });
    revalidatePath('/announcements');
    return { success: 'Published.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not publish the announcement.' };
  }
}

export async function ackAnnouncementAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    if (!ctx.workerId) return { error: 'Your account is not linked to a worker profile.' };
    const announcementId = String(formData.get('announcementId') ?? '');
    await db.announcementAck.upsert({
      where: { announcementId_workerId: { announcementId, workerId: ctx.workerId } },
      create: { announcementId, workerId: ctx.workerId },
      update: {},
    });
    revalidatePath('/announcements');
    return { success: 'Acknowledged.' };
  } catch {
    return { error: 'Could not record the acknowledgment.' };
  }
}
