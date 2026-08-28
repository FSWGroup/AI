import 'server-only';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth/passwords';
import { hashToken, generateToken } from '@/lib/crypto';
import { auditAnonymous } from '@/lib/audit';

/**
 * Kiosk mode: a shared tablet on a warehouse wall.
 *
 * The security model is deliberately different from the rest of the product,
 * because the threat is different. A wall-mounted tablet is physically
 * accessible to everyone in the building and is never in one person's custody,
 * so it must not be able to hold a session or read anybody's record.
 *
 *   - The DEVICE authenticates, with a long random token issued once at setup
 *     and stored as an httpOnly cookie on that tablet.
 *   - The PERSON authenticates with an employee number and a PIN, and that is
 *     enough to punch a clock and nothing else. There is no session, no
 *     cookie for the worker, and no page a kiosk can navigate to that shows
 *     HR data.
 *   - A PIN is bcrypt-hashed, throttled and locked out on repeated failure,
 *     exactly like a password, and is a *separate* credential from the
 *     account password so a shoulder-surfed PIN cannot sign in anywhere.
 *
 * A four-digit PIN is weak by design — it is what a person will actually use
 * with gloves on — so the compensating controls are the narrow blast radius
 * and the lockout, not the entropy.
 */

export const KIOSK_COOKIE = 'fsw_kiosk';
export const PIN_LENGTH = 4;
const MAX_PIN_FAILURES = 5;
const PIN_LOCKOUT_MINUTES = 15;

export function generateKioskToken(): string {
  return generateToken();
}

export function hashKioskToken(token: string): string {
  return hashToken(token);
}

/** The registered, unrevoked device this request is coming from, if any. */
export async function currentKioskDevice() {
  const jar = await cookies();
  const token = jar.get(KIOSK_COOKIE)?.value;
  if (!token) return null;
  const device = await db.kioskDevice.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!device || !device.active || device.revokedAt) return null;
  return device;
}

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

/** Reject the PINs people reach for first. */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true; // 0000, 1111
  const digits = pin.split('').map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  if (ascending || descending) return true; // 1234, 4321
  return ['1234', '0000', '1111', '2580', '1379'].includes(pin);
}

export async function setKioskPin(workerId: string, pin: string): Promise<void> {
  await db.worker.update({
    where: { id: workerId },
    data: {
      kioskPinHash: await hashPassword(pin),
      kioskPinSetAt: new Date(),
      kioskFailedCount: 0,
      kioskLockedUntil: null,
    },
  });
}

export type PinResult =
  | { ok: true; workerId: string; name: string }
  | { ok: false; reason: 'INVALID' | 'LOCKED' | 'NO_PIN' };

/**
 * Verify an employee number and PIN.
 *
 * Every failure path returns the same generic INVALID unless the account is
 * actually locked, so the pad cannot be used to discover which employee
 * numbers exist.
 */
export async function verifyKioskPin(employeeNumber: string, pin: string): Promise<PinResult> {
  const worker = await db.worker.findUnique({
    where: { employeeNumber: employeeNumber.trim().toUpperCase() },
    select: {
      id: true,
      legalFirstName: true,
      preferredName: true,
      lastName: true,
      status: true,
      deletedAt: true,
      kioskPinHash: true,
      kioskFailedCount: true,
      kioskLockedUntil: true,
    },
  });

  // Spend comparable time whether or not the worker exists, so the pad is not
  // a timing oracle for employee numbers.
  if (!worker || !worker.kioskPinHash || worker.deletedAt || !['ACTIVE', 'ON_LEAVE'].includes(worker.status)) {
    await verifyPassword(pin, '$2a$10$ZZZZZZZZZZZZZZZZZZZZZeZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ');
    return { ok: false, reason: 'INVALID' };
  }
  if (worker.kioskLockedUntil && worker.kioskLockedUntil > new Date()) {
    return { ok: false, reason: 'LOCKED' };
  }

  const valid = await verifyPassword(pin, worker.kioskPinHash);
  if (!valid) {
    const failed = worker.kioskFailedCount + 1;
    await db.worker.update({
      where: { id: worker.id },
      data: {
        kioskFailedCount: failed,
        kioskLockedUntil: failed >= MAX_PIN_FAILURES ? new Date(Date.now() + PIN_LOCKOUT_MINUTES * 60_000) : null,
      },
    });
    return { ok: false, reason: failed >= MAX_PIN_FAILURES ? 'LOCKED' : 'INVALID' };
  }

  await db.worker.update({
    where: { id: worker.id },
    data: { kioskFailedCount: 0, kioskLockedUntil: null },
  });
  return {
    ok: true,
    workerId: worker.id,
    name: worker.preferredName || worker.legalFirstName,
  };
}

// ---------------------------------------------------------------------------
// Punching
// ---------------------------------------------------------------------------

/** Monday 00:00 UTC, matching Timesheet.weekStart. */
function weekStartOf(d: Date): Date {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = start.getUTCDay();
  start.setUTCDate(start.getUTCDate() - (day === 0 ? 6 : day - 1));
  return start;
}

export interface PunchResult {
  kind: 'IN' | 'OUT';
  at: Date;
  /** Hours on the entry just closed, when punching out. */
  hours?: number;
}

/**
 * Punch in or out. Which one is inferred from state rather than chosen: an
 * open entry means the next punch closes it. A tired person at 06:00 should
 * not have to pick the right button.
 */
export async function punch(deviceId: string, workerId: string, now = new Date()): Promise<PunchResult> {
  const weekStart = weekStartOf(now);
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const timesheet = await db.timesheet.upsert({
    where: { workerId_weekStart: { workerId, weekStart } },
    create: { workerId, weekStart },
    update: {},
  });

  const open = await db.timeEntry.findFirst({
    where: { timesheetId: timesheet.id, clockIn: { not: null }, clockOut: null },
    orderBy: { clockIn: 'desc' },
  });

  if (open) {
    const hours = Math.max(0, (now.getTime() - open.clockIn!.getTime()) / 3_600_000 - open.breakMinutes / 60);
    await db.timeEntry.update({ where: { id: open.id }, data: { clockOut: now } });
    await db.kioskPunch.create({ data: { deviceId, workerId, kind: 'OUT', at: now, timeEntryId: open.id } });
    return { kind: 'OUT', at: now, hours: Math.round(hours * 100) / 100 };
  }

  const entry = await db.timeEntry.create({
    data: { timesheetId: timesheet.id, date: day, clockIn: now },
  });
  await db.kioskPunch.create({ data: { deviceId, workerId, kind: 'IN', at: now, timeEntryId: entry.id } });
  return { kind: 'IN', at: now };
}

/** Record a rejected kiosk attempt. Never records the employee number tried. */
export async function auditKioskFailure(reason: string, deviceId: string | null): Promise<void> {
  await auditAnonymous('kiosk.attempt_rejected', { metadata: { reason, deviceId } });
}
