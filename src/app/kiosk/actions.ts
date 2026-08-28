'use server';

import { db } from '@/lib/db';
import { auditAnonymous } from '@/lib/audit';
import { currentKioskDevice, verifyKioskPin, punch, isValidPin, auditKioskFailure } from '@/lib/kiosk';

export interface PunchState {
  error?: string;
  success?: string;
}

/**
 * The only action a kiosk can take.
 *
 * Note what is absent: no session is created, no cookie is set for the
 * worker, and nothing about them is returned beyond a first name to confirm
 * the right person punched. A kiosk that is stolen off the wall yields the
 * ability to clock people in and out — which the punch log makes visible —
 * and nothing else.
 */
export async function kioskPunchAction(_prev: PunchState | void, formData: FormData): Promise<PunchState> {
  const device = await currentKioskDevice();
  if (!device) {
    await auditKioskFailure('unregistered_device', null);
    return { error: 'This tablet is not registered. Ask an administrator to set it up again.' };
  }

  const employeeNumber = String(formData.get('employeeNumber') ?? '').trim();
  const pin = String(formData.get('pin') ?? '').trim();
  if (!employeeNumber || !isValidPin(pin)) {
    return { error: 'Enter your employee number and 4-digit PIN.' };
  }

  const result = await verifyKioskPin(employeeNumber, pin);
  if (!result.ok) {
    await auditKioskFailure(result.reason.toLowerCase(), device.id);
    if (result.reason === 'LOCKED') {
      return { error: 'Too many attempts. Ask your supervisor — this unlocks in 15 minutes.' };
    }
    // Deliberately the same message whether the number or the PIN was wrong.
    return { error: 'That employee number and PIN did not match.' };
  }

  const punched = await punch(device.id, result.workerId);
  await db.kioskDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  await auditAnonymous('kiosk.punch', {
    metadata: { deviceId: device.id, workerId: result.workerId, kind: punched.kind },
  });

  const time = punched.at.toISOString().slice(11, 16);
  return {
    success:
      punched.kind === 'IN'
        ? `${result.name} — clocked in at ${time}. Have a good shift.`
        : `${result.name} — clocked out at ${time}${punched.hours ? `, ${punched.hours} hours` : ''}. Thanks.`,
  };
}
