'use server';

import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requirePermission, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import type { ActionResult } from '@/app/(auth)/actions';

export async function completeSetupAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('settings.admin');
    const mode = String(formData.get('mode') ?? '');
    const org = await db.organization.findFirst();
    if (!org) return { error: 'No organization record found — run the seed first.' };

    if (mode === 'save-org') {
      const orgName = String(formData.get('orgName') ?? '').trim();
      if (!orgName) return { error: 'Organization name is required.' };
      await db.organization.update({ where: { id: org.id }, data: { name: orgName } });
      await audit(ctx, 'setup.organization_saved', { targetType: 'Organization', targetId: org.id });
      return { success: 'Saved.' };
    }

    if (mode === 'finish') {
      await db.organization.update({ where: { id: org.id }, data: { setupCompletedAt: new Date() } });
      await audit(ctx, 'setup.completed', { targetType: 'Organization', targetId: org.id });
      redirect('/');
    }
    return { error: 'Unknown setup step.' };
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save setup.' };
  }
}
