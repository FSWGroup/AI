/**
 * Checkr webhook verification.
 *
 * Signature is an HMAC-SHA256 of the raw request body using the webhook
 * secret. Two details matter and are easy to get wrong:
 *
 *  - Sign the RAW body. Parsing to JSON and re-serializing changes the bytes
 *    and every signature fails.
 *  - Compare in constant time. A byte-by-byte early return leaks the expected
 *    signature to anyone willing to measure.
 *
 * The header name should be confirmed against Checkr's partner documentation
 * at integration time; both spellings seen in the wild are accepted, and the
 * name is overridable without a deploy.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADERS = [
  "x-checkr-signature",
  "checkr-signature",
] as const;

export function isWebhookConfigured(): boolean {
  return Boolean(process.env.CHECKR_WEBHOOK_SECRET);
}

export function readSignature(headers: Headers): string | null {
  const override = process.env.CHECKR_SIGNATURE_HEADER?.toLowerCase();
  if (override) return headers.get(override);
  for (const name of SIGNATURE_HEADERS) {
    const value = headers.get(name);
    if (value) return value;
  }
  return null;
}

export function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.CHECKR_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  // Some senders prefix the algorithm; accept either form.
  const provided = signature.includes("=") ? signature.split("=").pop()! : signature;

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided.trim(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface CheckrWebhookEvent {
  id?: string;
  type: string;
  created_at?: string;
  data?: { object?: Record<string, unknown> };
}

/** Event types this integration acts on. Others are recorded and ignored. */
export const HANDLED_EVENTS = new Set([
  "invitation.created",
  "invitation.completed",
  "invitation.expired",
  "report.created",
  "report.updated",
  "report.completed",
  "report.suspended",
  "report.resumed",
]);
