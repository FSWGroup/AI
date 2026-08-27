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

/** Candidate-friendly Record ID like "FW-4821-KQ" (not a secret). */
export function generateRecordId(): string {
  const digits = String(Math.floor(Math.random() * 9000) + 1000);
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ"; // no I/L/O to avoid confusion
  const letters =
    alphabet[randomBytes(1)[0] % alphabet.length] +
    alphabet[randomBytes(1)[0] % alphabet.length];
  return `FW-${digits}-${letters}`;
}

/** Human-readable assessment code, e.g. "FSW-7Q2M9C". */
export function generateAssessmentCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  const buf = randomBytes(6);
  for (let i = 0; i < 6; i++) code += alphabet[buf[i] % alphabet.length];
  return `FSW-${code}`;
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
