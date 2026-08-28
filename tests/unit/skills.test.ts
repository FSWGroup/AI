import { describe, it, expect } from 'vitest';
import { certificationState, countsTowardCoverage, nextExpiry, EXPIRY_WARNING_DAYS } from '@/lib/skills';

const NOW = new Date('2026-06-01T00:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe('certification state', () => {
  it('treats a skill with no expiry as not a certification concern', () => {
    expect(certificationState(null, NOW)).toBe('NOT_APPLICABLE');
  });

  it('is current well before the renewal date', () => {
    expect(certificationState(days(365), NOW)).toBe('CURRENT');
  });

  it('warns inside the renewal window', () => {
    expect(certificationState(days(EXPIRY_WARNING_DAYS - 1), NOW)).toBe('EXPIRING');
    expect(certificationState(days(EXPIRY_WARNING_DAYS + 1), NOW)).toBe('CURRENT');
  });

  it('is expired the moment the date passes', () => {
    expect(certificationState(days(-1), NOW)).toBe('EXPIRED');
  });
});

describe('what counts toward coverage', () => {
  const plain = { isCertification: false, isCritical: false };
  const criticalCert = { isCertification: true, isCritical: true };
  const holder = (over: Partial<{ level: number; expiresAt: Date | null; verifiedAt: Date | null }> = {}) => ({
    level: 4,
    expiresAt: null,
    verifiedAt: NOW,
    ...over,
  });

  it('counts a proficient holder of an ordinary skill', () => {
    expect(countsTowardCoverage(holder({ verifiedAt: null }), plain, 3, NOW)).toBe(true);
  });

  it('does not count someone below the required level', () => {
    expect(countsTowardCoverage(holder({ level: 2 }), plain, 3, NOW)).toBe(false);
  });

  it('does not count a lapsed certification', () => {
    expect(countsTowardCoverage(holder({ expiresAt: days(-1) }), criticalCert, 3, NOW)).toBe(false);
  });

  it('still counts a certification that is merely expiring soon', () => {
    expect(countsTowardCoverage(holder({ expiresAt: days(10) }), criticalCert, 3, NOW)).toBe(true);
  });

  it('does not stake a critical skill on an unverified claim', () => {
    expect(countsTowardCoverage(holder({ verifiedAt: null }), criticalCert, 3, NOW)).toBe(false);
    expect(countsTowardCoverage(holder({ verifiedAt: NOW }), criticalCert, 3, NOW)).toBe(true);
  });

  it('takes ordinary skills at face value without verification', () => {
    expect(countsTowardCoverage(holder({ verifiedAt: null }), plain, 3, NOW)).toBe(true);
  });
});

describe('renewal dates', () => {
  it('adds the validity period', () => {
    expect(nextExpiry(36, new Date('2026-06-01T00:00:00Z'))?.toISOString()).toBe('2029-06-01T00:00:00.000Z');
  });

  it('returns null when the certification never expires', () => {
    expect(nextExpiry(null, NOW)).toBeNull();
    expect(nextExpiry(0, NOW)).toBeNull();
  });
});
