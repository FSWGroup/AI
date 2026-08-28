import 'server-only';
import { db } from '@/lib/db';
import { decryptField } from '@/lib/crypto';
import { signWebhook, nextAttemptDelayMs, MAX_WEBHOOK_ATTEMPTS } from '@/lib/api-keys';
import type { Prisma } from '@/generated/prisma/client';

/**
 * Outbound webhooks.
 *
 * Queue first, deliver second. An HR action must never fail or hang because
 * somebody's endpoint is down, so `queueWebhooks` only writes rows, and the
 * maintenance sweep drains them. A delivery that fails is retried with
 * exponential backoff and then abandoned — visibly, in the delivery log,
 * rather than by disappearing.
 *
 * Payloads carry ids and the event, not personnel data. A receiver that needs
 * detail calls the read API with its own scoped key, which keeps one
 * authorization path instead of two.
 */

const HTTP_TIMEOUT_MS = 10_000;
/** Consecutive failures after which an endpoint is switched off. */
const DISABLE_AFTER_FAILURES = 20;

export interface WebhookPayload {
  event: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

/** Enqueue an event for every endpoint subscribed to it. Never throws. */
export async function queueWebhooks(event: string, data: Record<string, unknown>): Promise<number> {
  try {
    const endpoints = await db.webhookEndpoint.findMany({ where: { active: true } });
    const subscribed = endpoints.filter((e) => {
      const events = (e.events ?? []) as string[];
      return events.length === 0 || events.includes(event);
    });
    if (subscribed.length === 0) return 0;

    const payload: WebhookPayload = { event, occurredAt: new Date().toISOString(), data };
    await db.webhookDelivery.createMany({
      data: subscribed.map((endpoint) => ({
        endpointId: endpoint.id,
        event,
        payload: payload as unknown as Prisma.InputJsonValue,
        nextAttemptAt: new Date(),
      })),
    });
    return subscribed.length;
  } catch (error) {
    // A webhook is a courtesy to another system. It must never be the reason
    // an HR action fails.
    console.error('Could not queue webhooks', error);
    return 0;
  }
}

export interface DrainResult {
  attempted: number;
  delivered: number;
  failed: number;
  abandoned: number;
}

/** Deliver everything due. Called by the maintenance sweep. */
export async function drainWebhooks(now = new Date(), limit = 50): Promise<DrainResult> {
  const due = await db.webhookDelivery.findMany({
    where: { status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: now } },
    include: { endpoint: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  const result: DrainResult = { attempted: 0, delivered: 0, failed: 0, abandoned: 0 };
  for (const delivery of due) {
    if (!delivery.endpoint.active) {
      await db.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'ABANDONED', error: 'Endpoint is disabled.' },
      });
      result.abandoned += 1;
      continue;
    }

    result.attempted += 1;
    const attempt = delivery.attempts + 1;
    const body = JSON.stringify(delivery.payload);
    const timestamp = Math.floor(Date.now() / 1000);

    let secret: string;
    try {
      secret = decryptField(delivery.endpoint.secretEnc);
    } catch {
      await db.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'ABANDONED', attempts: attempt, error: 'Endpoint secret could not be decrypted.' },
      });
      result.abandoned += 1;
      continue;
    }

    let responseCode: number | null = null;
    let error: string | null = null;
    try {
      const response = await fetch(delivery.endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-fsw-event': delivery.event,
          'x-fsw-timestamp': String(timestamp),
          'x-fsw-signature': signWebhook(secret, body, timestamp),
        },
        body,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      responseCode = response.status;
      if (!response.ok) error = `Endpoint returned ${response.status}.`;
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 300) : 'Delivery failed.';
    }

    if (!error) {
      await db.$transaction([
        db.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: 'DELIVERED', attempts: attempt, responseCode, deliveredAt: new Date(), error: null },
        }),
        db.webhookEndpoint.update({
          where: { id: delivery.endpoint.id },
          data: { lastSuccessAt: new Date(), consecutiveFailures: 0 },
        }),
      ]);
      result.delivered += 1;
      continue;
    }

    const exhausted = attempt >= MAX_WEBHOOK_ATTEMPTS;
    const failures = delivery.endpoint.consecutiveFailures + 1;
    await db.$transaction([
      db.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: exhausted ? 'ABANDONED' : 'FAILED',
          attempts: attempt,
          responseCode,
          error,
          nextAttemptAt: exhausted ? null : new Date(Date.now() + nextAttemptDelayMs(attempt)),
        },
      }),
      db.webhookEndpoint.update({
        where: { id: delivery.endpoint.id },
        data: {
          lastFailureAt: new Date(),
          consecutiveFailures: failures,
          // An endpoint that has failed twenty times running is gone. Switch
          // it off rather than retrying forever against a dead host.
          ...(failures >= DISABLE_AFTER_FAILURES ? { active: false } : {}),
        },
      }),
    ]);
    if (exhausted) result.abandoned += 1;
    else result.failed += 1;
  }
  return result;
}
