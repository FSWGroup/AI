'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission, requireCtxAction, can, workerAccess, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { env } from '@/lib/env';
import { generateKioskToken, hashKioskToken, isValidPin, isWeakPin, setKioskPin } from '@/lib/kiosk';
import type { ActionResult } from '@/app/(auth)/actions';

/**
 * Register a tablet. The setup URL is returned once and never stored — only
 * its hash is kept, the same as any other credential in this system.
 */
export async function registerKioskAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('settings.admin');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { error: 'Name the device so it can be recognised later.' };
    const token = generateKioskToken();
    const device = await db.kioskDevice.create({
      data: {
        name,
        locationId: String(formData.get('locationId') ?? '') || null,
        tokenHash: hashKioskToken(token),
        createdById: ctx.userId,
      },
    });
    await audit(ctx, 'kiosk.device_registered', { targetType: 'KioskDevice', targetId: device.id, metadata: { name } });
    revalidatePath('/admin/kiosks');
    const url = `${env.APP_BASE_URL.replace(/\/$/, '')}/kiosk/setup?token=${encodeURIComponent(token)}`;
    return {
      success: `Registered. Open this link once on the tablet — it is shown only now: ${url}`,
    };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not register the device.' };
  }
}

export async function revokeKioskAction(formData: FormData): Promise<void> {
  const ctx = await requirePermission('settings.admin');
  const id = String(formData.get('deviceId') ?? '');
  const device = await db.kioskDevice.findUnique({ where: { id } });
  if (!device) return;
  await db.kioskDevice.update({ where: { id }, data: { active: false, revokedAt: new Date() } });
  await audit(ctx, 'kiosk.device_revoked', { targetType: 'KioskDevice', targetId: id, metadata: { name: device.name } });
  revalidatePath('/admin/kiosks');
}

/**
 * Set a worker's clock-in PIN.
 *
 * A worker may set their own; HR may set one on their behalf, which is how
 * somebody who has forgotten theirs gets going again. A manager cannot, because
 * a PIN their report uses is a credential the manager should not know.
 */
export async function setKioskPinAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    const workerId = String(formData.get('workerId') ?? '');
    if (!can(ctx, 'people.write')) {
      const access = await workerAccess(ctx, workerId);
      if (!access.self) throw new AuthzError('You can only set your own clock-in PIN.');
    }
    const pin = String(formData.get('pin') ?? '').trim();
    const confirm = String(formData.get('confirmPin') ?? '').trim();
    if (!isValidPin(pin)) return { error: 'A PIN is exactly 4 digits.' };
    if (pin !== confirm) return { error: 'The two PINs do not match.' };
    if (isWeakPin(pin)) return { error: 'Pick a less predictable PIN — no repeats, runs or 1234.' };

    await setKioskPin(workerId, pin);
    await audit(ctx, 'kiosk.pin_set', {
      targetType: 'Worker',
      targetId: workerId,
      metadata: { self: ctx.workerId === workerId },
    });
    revalidatePath(`/people/${workerId}`);
    return { success: 'Clock-in PIN set. It works on any registered kiosk.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not set the PIN.' };
  }
}
