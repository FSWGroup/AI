import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import { env } from './env';

/**
 * Field-level encryption for highly sensitive values (SSN, bank accounts,
 * tax identifiers, passports, Philippine government IDs).
 *
 * Envelope format: enc:v1:<iv b64>:<ciphertext b64>:<authTag b64>
 * The version prefix allows key rotation: introduce v2 with a new key while
 * v1 values remain decryptable until re-encrypted.
 */
const KEY = () => Buffer.from(env.FIELD_ENCRYPTION_KEY, 'hex');

export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}:${ciphertext.toString('base64')}:${tag.toString('base64')}`;
}

export function decryptField(envelope: string): string {
  const parts = envelope.split(':');
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new Error('Unrecognized encrypted field envelope');
  }
  const [, , ivB64, dataB64, tagB64] = parts;
  const decipher = createDecipheriv('aes-256-gcm', KEY(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

export function last4(value: string): string {
  const digits = value.replace(/\D/g, '');
  const src = digits.length >= 4 ? digits : value;
  return src.slice(-4);
}

// ---------------------------------------------------------------------------
// Opaque tokens (sessions, activation, password reset). Only the SHA-256 hash
// is stored server-side, so a database leak does not leak usable tokens.
// ---------------------------------------------------------------------------

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ---------------------------------------------------------------------------
// Signed expiring URLs for document downloads.
// ---------------------------------------------------------------------------

export function signDownload(params: { versionId: string; userId: string; expiresAt: number }): string {
  const payload = `${params.versionId}.${params.userId}.${params.expiresAt}`;
  const sig = createHmac('sha256', env.DOCUMENT_URL_SIGNING_KEY).update(payload).digest('base64url');
  return `${params.expiresAt}.${sig}`;
}

export function verifyDownload(params: {
  versionId: string;
  userId: string;
  token: string;
}): boolean {
  const [expStr, sig] = params.token.split('.');
  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  const payload = `${params.versionId}.${params.userId}.${expiresAt}`;
  const expected = createHmac('sha256', env.DOCUMENT_URL_SIGNING_KEY).update(payload).digest('base64url');
  return safeEqual(sig ?? '', expected);
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238) — implemented directly on node:crypto so MFA does not
// depend on an external package.
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of str.replace(/=+$/, '').toUpperCase()) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secretBase32: string, timestamp = Date.now(), stepSeconds = 30): string {
  const counter = Math.floor(timestamp / 1000 / stepSeconds);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

/** Accepts the current step and one step either side to absorb clock drift. */
export function verifyTotp(secretBase32: string, code: string, timestamp = Date.now()): boolean {
  const normalized = code.replace(/\s/g, '');
  for (const drift of [-1, 0, 1]) {
    if (safeEqual(totpCode(secretBase32, timestamp + drift * 30_000), normalized)) return true;
  }
  return false;
}

export function totpUri(secretBase32: string, accountEmail: string): string {
  return `otpauth://totp/FSW%20People:${encodeURIComponent(accountEmail)}?secret=${secretBase32}&issuer=FSW%20People&algorithm=SHA1&digits=6&period=30`;
}
