import { describe, it, expect } from 'vitest';
import {
  encryptField, decryptField, last4, hashToken, generateToken, safeEqual,
  signDownload, verifyDownload, generateTotpSecret, totpCode, verifyTotp, base32Decode, base32Encode,
} from '@/lib/crypto';
import { checkPasswordStrength, hashPassword, verifyPassword } from '@/lib/auth/passwords';

describe('field encryption', () => {
  it('round-trips a value', () => {
    const secret = '123-45-6789';
    const envelope = encryptField(secret);
    expect(envelope).not.toContain(secret);
    expect(envelope.startsWith('enc:v1:')).toBe(true);
    expect(decryptField(envelope)).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptField('same value');
    const b = encryptField('same value');
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe(decryptField(b));
  });

  it('rejects a tampered ciphertext (GCM auth tag)', () => {
    const envelope = encryptField('123-45-6789');
    const parts = envelope.split(':');
    const data = Buffer.from(parts[3], 'base64');
    data[0] ^= 0xff;
    parts[3] = data.toString('base64');
    expect(() => decryptField(parts.join(':'))).toThrow();
  });

  it('rejects an unrecognized envelope', () => {
    expect(() => decryptField('plaintext')).toThrow(/envelope/i);
  });

  it('masks to the last four characters', () => {
    expect(last4('123-45-6789')).toBe('6789');
    expect(last4('000123456789')).toBe('6789');
  });
});

describe('opaque tokens', () => {
  it('hashes deterministically and never stores the raw token', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).toHaveLength(64);
  });

  it('compares in constant time without throwing on length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcdef')).toBe(false);
  });
});

describe('signed document URLs', () => {
  const params = { versionId: 'ver_1', userId: 'user_1' };

  it('accepts a fresh token for the same user', () => {
    const expiresAt = Date.now() + 60_000;
    const token = signDownload({ ...params, expiresAt });
    expect(verifyDownload({ ...params, token })).toBe(true);
  });

  it('rejects an expired token', () => {
    const token = signDownload({ ...params, expiresAt: Date.now() - 1000 });
    expect(verifyDownload({ ...params, token })).toBe(false);
  });

  it('rejects a token minted for a different user or document', () => {
    const token = signDownload({ ...params, expiresAt: Date.now() + 60_000 });
    expect(verifyDownload({ ...params, userId: 'user_2', token })).toBe(false);
    expect(verifyDownload({ ...params, versionId: 'ver_2', token })).toBe(false);
  });

  it('rejects a forged signature', () => {
    expect(verifyDownload({ ...params, token: `${Date.now() + 60_000}.forged` })).toBe(false);
  });
});

describe('TOTP', () => {
  it('base32 round-trips', () => {
    const buf = Buffer.from('hello world');
    expect(base32Decode(base32Encode(buf)).toString()).toBe('hello world');
  });

  it('accepts the current code and rejects a wrong one', () => {
    const secret = generateTotpSecret();
    const code = totpCode(secret);
    expect(verifyTotp(secret, code)).toBe(true);
    expect(verifyTotp(secret, '000000')).toBe(false);
  });

  it('tolerates one step of clock drift but not two', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now - 90_000), now)).toBe(false);
  });
});

describe('passwords', () => {
  it('hashes and verifies with bcrypt', async () => {
    const hash = await hashPassword('CorrectHorse!42');
    expect(hash).not.toContain('CorrectHorse');
    expect(await verifyPassword('CorrectHorse!42', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('enforces a minimum strength bar', () => {
    expect(checkPasswordStrength('short').ok).toBe(false);
    expect(checkPasswordStrength('alllowercase123').ok).toBe(false);
    expect(checkPasswordStrength('password12345A').ok).toBe(false);
    expect(checkPasswordStrength('CorrectHorse!42').ok).toBe(true);
  });
});
