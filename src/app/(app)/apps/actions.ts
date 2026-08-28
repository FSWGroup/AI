'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import type { ActionResult } from '@/app/(auth)/actions';

export async function saveAppAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('apps.admin');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { error: 'Application name is required.' };
    const app = await db.softwareApp.upsert({
      where: { name },
      create: {
        name,
        category: String(formData.get('category') ?? '') || null,
        monthlyCostPerSeat: formData.get('monthlyCostPerSeat') ? Number(formData.get('monthlyCostPerSeat')) : null,
        renewalDate: formData.get('renewalDate') ? new Date(String(formData.get('renewalDate'))) : null,
        autoProvisionOnboarding: formData.get('autoProvision') === 'on',
        provisioningNote: String(formData.get('provisioningNote') ?? '') || null,
      },
      update: {
        category: String(formData.get('category') ?? '') || null,
        monthlyCostPerSeat: formData.get('monthlyCostPerSeat') ? Number(formData.get('monthlyCostPerSeat')) : null,
        renewalDate: formData.get('renewalDate') ? new Date(String(formData.get('renewalDate'))) : null,
        autoProvisionOnboarding: formData.get('autoProvision') === 'on',
      },
    });
    await audit(ctx, 'apps.saved', { targetType: 'SoftwareApp', targetId: app.id });
    revalidatePath('/apps');
    return { success: 'Application saved.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the application.' };
  }
}

export async function grantAccessAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('apps.admin');
    const appId = String(formData.get('appId') ?? '');
    const workerId = String(formData.get('workerId') ?? '');
    if (!workerId) return { error: 'Pick a worker.' };
    const existing = await db.appAccessGrant.findFirst({ where: { appId, workerId, revokedAt: null } });
    if (existing) return { error: 'That worker already has an active grant.' };
    await db.appAccessGrant.create({
      data: { appId, workerId, accessLevel: String(formData.get('accessLevel') ?? 'USER'), grantedById: ctx.userId },
    });
    await audit(ctx, 'apps.access_granted', { targetType: 'SoftwareApp', targetId: appId, metadata: { workerId } });
    revalidatePath('/apps');
    return { success: 'Access granted.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not grant access.' };
  }
}

export async function revokeAccessAction(formData: FormData): Promise<void> {
  const ctx = await requirePermission('apps.admin');
  const grantId = String(formData.get('grantId') ?? '');
  await db.appAccessGrant.update({
    where: { id: grantId },
    data: { revokedAt: new Date(), revokedById: ctx.userId },
  });
  await audit(ctx, 'apps.access_revoked', { targetType: 'AppAccessGrant', targetId: grantId });
  revalidatePath('/apps');
}
