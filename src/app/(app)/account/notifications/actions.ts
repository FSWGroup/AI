'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireCtxAction } from '@/lib/authz';
import type { ActionResult } from '@/app/(auth)/actions';

export async function saveNotificationPrefsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireCtxAction();
  await db.user.update({
    where: { id: ctx.userId },
    data: {
      notificationPrefs: {
        emailTasks: formData.get('emailTasks') === 'on',
        emailApprovals: formData.get('emailApprovals') === 'on',
        emailGeneral: formData.get('emailGeneral') === 'on',
      },
    },
  });
  revalidatePath('/account/notifications');
  return { success: 'Preferences saved.' };
}
