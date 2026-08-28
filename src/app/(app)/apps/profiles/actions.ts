'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { provisionForOnboarding, recordAccessEvent } from '@/lib/access';
import type { ActionResult } from '@/app/(auth)/actions';

export async function saveAccessProfileAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('apps.admin');
    const id = String(formData.get('profileId') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { error: 'Name the profile.' };

    const departmentIds = formData.getAll('departmentIds').map(String).filter(Boolean);
    const workerTypes = formData.getAll('workerTypes').map(String).filter(Boolean);
    const jobFamilies = String(formData.get('jobFamilies') ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean);

    if (departmentIds.length === 0 && workerTypes.length === 0 && jobFamilies.length === 0) {
      return { error: 'Give the profile at least one rule — a profile with no rules would apply to nobody.' };
    }

    const data = {
      name,
      description: String(formData.get('description') ?? '') || null,
      criteria: { departmentIds, workerTypes, jobFamilies },
      active: formData.get('active') !== 'off',
    };
    const profile = id
      ? await db.accessProfile.update({ where: { id }, data })
      : await db.accessProfile.create({ data });
    await audit(ctx, id ? 'access.profile_updated' : 'access.profile_created', {
      targetType: 'AccessProfile',
      targetId: profile.id,
    });
    revalidatePath('/apps/profiles');
    return { success: 'Profile saved.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    if ((error as { code?: string }).code === 'P2002') return { error: 'A profile with that name already exists.' };
    return { error: 'Could not save the profile.' };
  }
}

export async function addProfileItemAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('apps.admin');
    const profileId = String(formData.get('profileId') ?? '');
    const appId = String(formData.get('appId') ?? '');
    if (!appId) return { error: 'Pick an application.' };
    await db.accessProfileItem.upsert({
      where: { profileId_appId: { profileId, appId } },
      create: {
        profileId,
        appId,
        accessLevel: String(formData.get('accessLevel') ?? 'USER'),
        required: formData.get('required') !== 'off',
      },
      update: {
        accessLevel: String(formData.get('accessLevel') ?? 'USER'),
        required: formData.get('required') !== 'off',
      },
    });
    await audit(ctx, 'access.profile_item_added', { targetType: 'AccessProfile', targetId: profileId });
    revalidatePath('/apps/profiles');
    return { success: 'Entitlement added.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not add the entitlement.' };
  }
}

export async function removeProfileItemAction(formData: FormData): Promise<void> {
  const ctx = await requirePermission('apps.admin');
  const itemId = String(formData.get('itemId') ?? '');
  const item = await db.accessProfileItem.findUnique({ where: { id: itemId } });
  if (!item) return;
  await db.accessProfileItem.delete({ where: { id: itemId } });
  await audit(ctx, 'access.profile_item_removed', { targetType: 'AccessProfile', targetId: item.profileId });
  revalidatePath('/apps/profiles');
}

/** Raise the grant tasks a worker's profiles say they are missing. */
export async function reprovisionWorkerAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('apps.admin');
    const workerId = String(formData.get('workerId') ?? '');
    const created = await provisionForOnboarding(workerId, ctx.userId);
    await audit(ctx, 'access.reprovisioned', { targetType: 'Worker', targetId: workerId, metadata: { created } });
    revalidatePath('/apps/exceptions');
    return {
      success: created === 0 ? 'Nothing missing — no tasks raised.' : `Raised ${created} access task(s).`,
    };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not raise the tasks.' };
  }
}

/**
 * Record that an exception was reviewed and is acceptable.
 *
 * Never deletes the exception — an accepted risk stays visible in the evidence
 * log. Somebody deciding "that is fine" is itself a decision worth recording.
 */
export async function noteAccessExceptionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('apps.admin');
    const workerId = String(formData.get('workerId') ?? '');
    const appName = String(formData.get('appName') ?? '');
    const detail = String(formData.get('detail') ?? '').trim();
    if (!detail) return { error: 'Say why this is acceptable.' };
    await recordAccessEvent({
      workerId,
      appId: String(formData.get('appId') ?? '') || null,
      appName,
      action: 'EXCEPTION_NOTED',
      source: 'REVIEW',
      actorUserId: ctx.userId,
      detail,
    });
    await audit(ctx, 'access.exception_noted', { targetType: 'Worker', targetId: workerId, metadata: { appName } });
    revalidatePath('/apps/exceptions');
    return { success: 'Recorded. The exception stays listed — the note explains it, it does not clear it.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not record the note.' };
  }
}
