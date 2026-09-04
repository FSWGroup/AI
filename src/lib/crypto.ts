import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { env } from "./env";

/** High-entropy URL-safe token (default 256 bits). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** SHA-256 hex digest — used to store invitation/resume tokens at rest. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Alphabet for every human-readable reference and code in the product.
 *
 * I, L, O, 0 and 1 are all excluded. These strings get read aloud on calls
 * and typed back in from a screenshot, and those five are the characters
 * people mishear and mistype for each other.
 */
export const REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Letters only, for the trailing pair of a Record ID. */
const RECORD_ID_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";

/** `length` characters from `alphabet`. Readable, NOT a secret — see below. */
export function randomCode(
  length: number,
  alphabet: string = REFERENCE_ALPHABET,
): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/**
 * A prefixed reference like "REQ-7Q2M9C".
 *
 * References identify a record to a human; they never authenticate one. The
 * modulo above is very slightly biased and 6 characters is only ~30 bits, so
 * nothing that guards access may ever be minted here — use `generateToken`.
 */
export function reference(prefix: string, length = 6): string {
  return `${prefix}-${randomCode(length)}`;
}

/** Candidate-friendly Record ID like "FW-4821-KQ" (not a secret). */
export function generateRecordId(): string {
  const digits = String(Math.floor(Math.random() * 9000) + 1000);
  return `FW-${digits}-${randomCode(2, RECORD_ID_LETTERS)}`;
}

/** Human-readable assessment code, e.g. "FSW-7Q2M9C". */
export function generateAssessmentCode(): string {
  return reference("FSW");
}

/** HMAC-SHA256 signature over a payload string using APP_SECRET. */
export function sign(payload: string): string {
  return createHmac("sha256", env.appSecret).update(payload).digest("base64url");
}

export function verifySignature(payload: string, signature: string): boolean {
  const expected = sign(payload);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Create an expiring signed value, e.g. for recording playback URLs.
 * Format: base64url(payload).expiresEpoch.signature
 */
export function createSignedValue(payload: string, ttlSeconds: number): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = `${Buffer.from(payload).toString("base64url")}.${expires}`;
  return `${body}.${sign(body)}`;
}

export function verifySignedValue(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [payloadB64, expiresStr, signature] = parts;
  const body = `${payloadB64}.${expiresStr}`;
  if (!verifySignature(body, signature)) return null;
  const expires = parseInt(expiresStr, 10);
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return Buffer.from(payloadB64, "base64url").toString();
}
