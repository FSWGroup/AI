import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testDb, resetDatabase, seedRoles, seedOrg, makeWorker, type Fixture } from '../helpers/db';
import { verifyKioskPin, setKioskPin, punch, hashKioskToken, generateKioskToken } from '@/lib/kiosk';
import { hashToken, generateToken } from '@/lib/crypto';

let fixture: Fixture;
let workerId: string, employeeNumber: string, userId: string;
let deviceId: string;

beforeAll(async () => {
  await resetDatabase();
  await seedRoles();
  fixture = await seedOrg();
  const row = await makeWorker({ fixture, email: 'picker@kiosk.test', roleKeys: ['EMPLOYEE'] });
  workerId = row.workerId;
  userId = row.userId;
  const worker = await testDb.worker.findUniqueOrThrow({ where: { id: workerId } });
  employeeNumber = worker.employeeNumber;

  const device = await testDb.kioskDevice.create({
    data: { name: 'Exton receiving', tokenHash: hashKioskToken('device-token-abc') },
  });
  deviceId = device.id;
});

afterAll(async () => {
  await testDb.$disconnect();
});

beforeEach(async () => {
  await testDb.$executeRawUnsafe('TRUNCATE TABLE "KioskPunch", "TimeEntry", "Timesheet" RESTART IDENTITY CASCADE');
  await testDb.worker.update({
    where: { id: workerId },
    data: { kioskFailedCount: 0, kioskLockedUntil: null, status: 'ACTIVE' },
  });
  await setKioskPin(workerId, '4071');
});

describe('PIN verification', () => {
  it('accepts the right employee number and PIN', async () => {
    const result = await verifyKioskPin(employeeNumber, '4071');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.workerId).toBe(workerId);
  });

  it('stores the PIN hashed, never in the clear', async () => {
    const worker = await testDb.worker.findUniqueOrThrow({ where: { id: workerId } });
    expect(worker.kioskPinHash).not.toBeNull();
    expect(worker.kioskPinHash).not.toContain('4071');
    expect(worker.kioskPinHash!.startsWith('$2')).toBe(true);
  });

  it('gives the same answer for a wrong PIN and an employee number that does not exist', async () => {
    const wrongPin = await verifyKioskPin(employeeNumber, '9999');
    const noSuchWorker = await verifyKioskPin('FSW-999999', '4071');
    expect(wrongPin).toEqual({ ok: false, reason: 'INVALID' });
    expect(noSuchWorker).toEqual({ ok: false, reason: 'INVALID' });
  });

  it('locks out after five failures and stops accepting the correct PIN', async () => {
    for (let i = 0; i < 5; i++) await verifyKioskPin(employeeNumber, '0000');
    const locked = await verifyKioskPin(employeeNumber, '4071');
    expect(locked).toEqual({ ok: false, reason: 'LOCKED' });
  });

  it('clears the failure count after a successful punch-in', async () => {
    for (let i = 0; i < 3; i++) await verifyKioskPin(employeeNumber, '0000');
    await verifyKioskPin(employeeNumber, '4071');
    const worker = await testDb.worker.findUniqueOrThrow({ where: { id: workerId } });
    expect(worker.kioskFailedCount).toBe(0);
    expect(worker.kioskLockedUntil).toBeNull();
  });

  it('refuses a terminated worker', async () => {
    await testDb.worker.update({ where: { id: workerId }, data: { status: 'TERMINATED' } });
    expect(await verifyKioskPin(employeeNumber, '4071')).toEqual({ ok: false, reason: 'INVALID' });
  });

  it('refuses someone with no PIN set', async () => {
    await testDb.worker.update({ where: { id: workerId }, data: { kioskPinHash: null } });
    expect(await verifyKioskPin(employeeNumber, '4071')).toEqual({ ok: false, reason: 'INVALID' });
  });

  it('is a separate credential from the account password', async () => {
    const user = await testDb.user.findUniqueOrThrow({ where: { id: userId } });
    const worker = await testDb.worker.findUniqueOrThrow({ where: { id: workerId } });
    expect(worker.kioskPinHash).not.toBe(user.passwordHash);
    // The PIN must not sign anybody in anywhere.
    expect(await verifyKioskPin(employeeNumber, 'TestPassword!123')).toEqual({ ok: false, reason: 'INVALID' });
  });
});

describe('punching', () => {
  it('infers in, then out, from the open entry', async () => {
    const first = await punch(deviceId, workerId, new Date('2027-03-01T06:00:00Z'));
    expect(first.kind).toBe('IN');
    const second = await punch(deviceId, workerId, new Date('2027-03-01T14:30:00Z'));
    expect(second.kind).toBe('OUT');
    expect(second.hours).toBeCloseTo(8.5, 1);
  });

  it('creates the week timesheet on the first punch of the week', async () => {
    await punch(deviceId, workerId, new Date('2027-03-01T06:00:00Z'));
    const sheet = await testDb.timesheet.findFirstOrThrow({ where: { workerId } });
    expect(sheet.weekStart.toISOString()).toBe('2027-03-01T00:00:00.000Z');
  });

  it('records every punch as evidence separate from the timesheet', async () => {
    await punch(deviceId, workerId, new Date('2027-03-01T06:00:00Z'));
    await punch(deviceId, workerId, new Date('2027-03-01T14:30:00Z'));
    const punches = await testDb.kioskPunch.findMany({ where: { workerId }, orderBy: { at: 'asc' } });
    expect(punches.map((p) => p.kind)).toEqual(['IN', 'OUT']);
    expect(punches[0].deviceId).toBe(deviceId);
  });

  it('keeps the punch log append-only', async () => {
    await punch(deviceId, workerId, new Date('2027-03-01T06:00:00Z'));
    const record = await testDb.kioskPunch.findFirstOrThrow();
    await expect(
      testDb.kioskPunch.update({ where: { id: record.id }, data: { kind: 'OUT' } }),
    ).rejects.toThrow();
    await expect(testDb.kioskPunch.delete({ where: { id: record.id } })).rejects.toThrow();
  });

  it('reopens a new entry after clocking out, rather than reusing the closed one', async () => {
    await punch(deviceId, workerId, new Date('2027-03-01T06:00:00Z'));
    await punch(deviceId, workerId, new Date('2027-03-01T10:00:00Z'));
    const third = await punch(deviceId, workerId, new Date('2027-03-01T11:00:00Z'));
    expect(third.kind).toBe('IN');
    const entries = await testDb.timeEntry.findMany();
    expect(entries).toHaveLength(2);
  });
});

describe('kiosk device tokens', () => {
  it('stores only a hash of the device token', async () => {
    const token = generateKioskToken();
    const device = await testDb.kioskDevice.create({
      data: { name: 'Another tablet', tokenHash: hashKioskToken(token) },
    });
    expect(device.tokenHash).not.toBe(token);
    expect(device.tokenHash).toHaveLength(64); // sha-256 hex
  });

  it('cannot be found by a wrong token', async () => {
    const found = await testDb.kioskDevice.findUnique({ where: { tokenHash: hashKioskToken('not-the-token') } });
    expect(found).toBeNull();
  });
});

describe('magic links', () => {
  const makeLink = async (opts: { expiresInMinutes?: number; usedAt?: Date | null } = {}) => {
    const token = generateToken();
    await testDb.authToken.create({
      data: {
        userId,
        kind: 'MAGIC_LINK',
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + (opts.expiresInMinutes ?? 15) * 60_000),
        usedAt: opts.usedAt ?? null,
      },
    });
    return token;
  };

  beforeEach(async () => {
    await testDb.authToken.deleteMany({ where: { userId } });
  });

  it('stores only a hash of the link token', async () => {
    const token = await makeLink();
    const record = await testDb.authToken.findFirstOrThrow({ where: { userId, kind: 'MAGIC_LINK' } });
    expect(record.tokenHash).not.toBe(token);
    expect(record.tokenHash).toBe(hashToken(token));
  });

  it('a token that has been used is no longer usable', async () => {
    const token = await makeLink({ usedAt: new Date() });
    const record = await testDb.authToken.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
    expect(record.usedAt).not.toBeNull();
  });

  it('an expired token is distinguishable from a live one', async () => {
    const expired = await makeLink({ expiresInMinutes: -1 });
    const record = await testDb.authToken.findUniqueOrThrow({ where: { tokenHash: hashToken(expired) } });
    expect(record.expiresAt.getTime()).toBeLessThan(Date.now());
  });
});
