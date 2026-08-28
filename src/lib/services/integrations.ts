import "server-only";
import { prisma } from "@/lib/db";
import { encryptJson, decryptJson, encryptField, decryptField, sha256, randomToken, signPayload } from "@/lib/crypto";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { enqueueJob, JOB_TYPES, type ClaimedJob } from "@/lib/jobs/queue";
import type { Actor } from "@/lib/auth/guard";
import { ALL_PERMISSIONS, type Permission } from "@/lib/permissions";

/**
 * Configurable (non-env) integrations, API keys, and outbound webhooks.
 *
 * Environment-driven capabilities (AI providers, email, SSO, S3, Slack/Teams
 * env webhooks) are read directly from src/lib/providers/registry.ts and are
 * never duplicated here. This module covers what an administrator configures
 * at runtime: HRIS sync, API keys for the public REST API, and outbound
 * webhook subscriptions — all secrets are encrypted at rest.
 */

export interface ConfigurableIntegrationDescriptor {
  key: string;
  name: string;
  description: string;
  fields: { key: string; label: string; secret?: boolean; placeholder?: string }[];
}

export const CONFIGURABLE_INTEGRATIONS: ConfigurableIntegrationDescriptor[] = [
  {
    key: "hris",
    name: "HRIS sync",
    description:
      "Pulls roster changes (new hires, transfers, terminations) from an HR system of record on a schedule.",
    fields: [
      { key: "baseUrl", label: "API base URL", placeholder: "https://api.yourhris.com" },
      { key: "apiKey", label: "API key", secret: true },
    ],
  },
  {
    key: "custom_webhook_sink",
    name: "Generic outbound relay",
    description: "A single always-on relay endpoint that mirrors every webhook-eligible event, for a SIEM or data warehouse ingestion pipeline.",
    fields: [
      { key: "url", label: "Endpoint URL", placeholder: "https://example.com/ingest" },
      { key: "token", label: "Bearer token", secret: true },
    ],
  },
];

export interface IntegrationView {
  key: string;
  name: string;
  description: string;
  status: "NOT_CONNECTED" | "CONNECTED" | "NEEDS_ATTENTION";
  configuredFields: string[];
  lastCheckedAt: Date | null;
  updatedAt: Date | null;
}

export async function listConfigurableIntegrations(): Promise<IntegrationView[]> {
  const rows = await prisma.integration.findMany({
    where: { key: { in: CONFIGURABLE_INTEGRATIONS.map((c) => c.key) } },
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));

  return CONFIGURABLE_INTEGRATIONS.map((descriptor) => {
    const row = byKey.get(descriptor.key);
    let configuredFields: string[] = [];
    if (row?.configCiphertext) {
      try {
        const config = decryptJson<Record<string, unknown>>(row.configCiphertext);
        configuredFields = Object.keys(config).filter((k) => config[k]);
      } catch {
        configuredFields = [];
      }
    }
    return {
      key: descriptor.key,
      name: descriptor.name,
      description: descriptor.description,
      status: (row?.status as IntegrationView["status"]) ?? "NOT_CONNECTED",
      configuredFields,
      lastCheckedAt: row?.lastCheckedAt ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

async function testConfigurableIntegration(
  key: string,
  config: Record<string, unknown>,
): Promise<{ ok: boolean; detail: string }> {
  if (key === "hris") {
    const baseUrl = typeof config.baseUrl === "string" ? config.baseUrl : "";
    if (!baseUrl) return { ok: false, detail: "No base URL configured." };
    try {
      const response = await fetch(new URL("/health", baseUrl).toString(), {
        method: "GET",
        headers: config.apiKey ? { Authorization: `Bearer ${String(config.apiKey)}` } : {},
        signal: AbortSignal.timeout(5000),
      });
      return response.ok
        ? { ok: true, detail: `Reached ${baseUrl} (HTTP ${response.status}).` }
        : { ok: false, detail: `${baseUrl} responded with HTTP ${response.status}.` };
    } catch (error) {
      return { ok: false, detail: `Could not reach ${baseUrl}: ${error instanceof Error ? error.message : "unknown error"}` };
    }
  }

  if (key === "custom_webhook_sink") {
    const url = typeof config.url === "string" ? config.url : "";
    if (!url) return { ok: false, detail: "No endpoint URL configured." };
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.token ? { Authorization: `Bearer ${String(config.token)}` } : {}),
        },
        body: JSON.stringify({ type: "connection_test", sentAt: new Date().toISOString() }),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok
        ? { ok: true, detail: `Relay accepted the test event (HTTP ${response.status}).` }
        : { ok: false, detail: `Relay responded with HTTP ${response.status}.` };
    } catch (error) {
      return { ok: false, detail: `Could not reach the relay: ${error instanceof Error ? error.message : "unknown error"}` };
    }
  }

  return { ok: Object.values(config).some(Boolean), detail: "Configuration saved. No live connection test is available for this integration yet." };
}

export interface SaveIntegrationResult {
  ok: boolean;
  status: IntegrationView["status"];
  detail: string;
}

export async function saveIntegrationConfig(
  actor: Actor,
  key: string,
  config: Record<string, unknown>,
): Promise<SaveIntegrationResult> {
  const descriptor = CONFIGURABLE_INTEGRATIONS.find((c) => c.key === key);
  if (!descriptor) return { ok: false, status: "NOT_CONNECTED", detail: "Unknown integration." };

  const test = await testConfigurableIntegration(key, config);
  const status: IntegrationView["status"] = test.ok ? "CONNECTED" : "NEEDS_ATTENTION";

  await prisma.integration.upsert({
    where: { key },
    create: { key, name: descriptor.name, status, configCiphertext: encryptJson(config), lastCheckedAt: new Date() },
    update: { status, configCiphertext: encryptJson(config), lastCheckedAt: new Date() },
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.INTEGRATION_CHANGED,
    entityType: "INTEGRATION",
    entityId: key,
    metadata: { fields: Object.keys(config), status },
  });

  return { ok: test.ok, status, detail: test.detail };
}

export async function disconnectIntegration(actor: Actor, key: string): Promise<void> {
  await prisma.integration.upsert({
    where: { key },
    create: { key, name: key, status: "NOT_CONNECTED", configCiphertext: null },
    update: { status: "NOT_CONNECTED", configCiphertext: null, lastCheckedAt: new Date() },
  });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.INTEGRATION_CHANGED,
    entityType: "INTEGRATION",
    entityId: key,
    metadata: { disconnected: true },
  });
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: Permission[];
  createdById: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export async function listApiKeys(): Promise<ApiKeyView[]> {
  const rows = await prisma.apiKey.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: (Array.isArray(r.scopes) ? r.scopes : []) as Permission[],
    createdById: r.createdById,
    lastUsedAt: r.lastUsedAt,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
    createdAt: r.createdAt,
  }));
}

export interface CreateApiKeyInput {
  name: string;
  scopes: string[];
  expiresAt?: Date | null;
}

/** Returns the plaintext secret exactly once. It is never recoverable afterward. */
export async function createApiKey(
  actor: Actor,
  input: CreateApiKeyInput,
): Promise<{ id: string; name: string; prefix: string; secret: string }> {
  const validScopes = input.scopes.filter((s): s is Permission => (ALL_PERMISSIONS as string[]).includes(s));
  const secret = `fsw_${randomToken(24)}`;
  const prefix = secret.slice(0, 12);

  const row = await prisma.apiKey.create({
    data: {
      name: input.name,
      keyHash: sha256(secret),
      prefix,
      scopes: validScopes,
      createdById: actor.id,
      expiresAt: input.expiresAt ?? null,
    },
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.API_KEY_CREATED,
    entityType: "API_KEY",
    entityId: row.id,
    metadata: { name: input.name, scopes: validScopes },
  });

  return { id: row.id, name: row.name, prefix: row.prefix, secret };
}

export async function revokeApiKey(actor: Actor, id: string): Promise<void> {
  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.API_KEY_REVOKED,
    entityType: "API_KEY",
    entityId: id,
  });
}

export interface VerifiedApiKey {
  id: string;
  name: string;
  scopes: Permission[];
}

/** Looks up a raw `fsw_...` secret, rejecting revoked/expired keys. Used by the v1 API auth guard. */
export async function verifyApiKey(rawKey: string): Promise<VerifiedApiKey | null> {
  if (!rawKey.startsWith("fsw_")) return null;
  const row = await prisma.apiKey.findUnique({ where: { keyHash: sha256(rawKey) } });
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

  await prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { id: row.id, name: row.name, scopes: (Array.isArray(row.scopes) ? row.scopes : []) as Permission[] };
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export const WEBHOOK_EVENTS = [
  "training.assigned",
  "training.completed",
  "training.overdue",
  "sop.published",
  "certificate.issued",
  "certificate.revoked",
  "person.created",
  "person.deactivated",
] as const;

export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookView {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: Date;
}

export async function listWebhooks(): Promise<WebhookView[]> {
  const rows = await prisma.webhook.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    events: Array.isArray(r.events) ? (r.events as string[]) : [],
    isActive: r.isActive,
    createdAt: r.createdAt,
  }));
}

export interface CreateWebhookInput {
  url: string;
  events: string[];
}

/** Returns the plaintext signing secret exactly once, like an API key. */
export async function createWebhook(actor: Actor, input: CreateWebhookInput): Promise<{ id: string; secret: string }> {
  const secret = randomToken(24);
  const row = await prisma.webhook.create({
    data: {
      url: input.url,
      secret: encryptField(secret),
      events: input.events.filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e)),
      createdById: actor.id,
    },
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.INTEGRATION_CHANGED,
    entityType: "WEBHOOK",
    entityId: row.id,
    metadata: { url: input.url, events: input.events },
  });

  return { id: row.id, secret };
}

export async function setWebhookActive(actor: Actor, id: string, isActive: boolean): Promise<void> {
  await prisma.webhook.update({ where: { id }, data: { isActive } });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.INTEGRATION_CHANGED,
    entityType: "WEBHOOK",
    entityId: id,
    metadata: { isActive },
  });
}

export async function deleteWebhook(actor: Actor, id: string): Promise<void> {
  await prisma.webhook.delete({ where: { id } });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.INTEGRATION_CHANGED,
    entityType: "WEBHOOK",
    entityId: id,
    metadata: { deleted: true },
  });
}

export interface WebhookDeliveryView {
  id: string;
  event: string;
  status: string;
  attempts: number;
  responseCode: number | null;
  lastAttemptAt: Date | null;
  createdAt: Date;
}

export async function listWebhookDeliveries(webhookId: string, limit = 25): Promise<WebhookDeliveryView[]> {
  const rows = await prisma.webhookDelivery.findMany({
    where: { webhookId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    event: r.event,
    status: r.status,
    attempts: r.attempts,
    responseCode: r.responseCode,
    lastAttemptAt: r.lastAttemptAt,
    createdAt: r.createdAt,
  }));
}

const MAX_WEBHOOK_ATTEMPTS = 5;

/** Signs and POSTs one delivery attempt, updating its row with the outcome. */
async function attemptDelivery(deliveryId: string): Promise<{ ok: boolean; responseCode: number | null; error?: string }> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { webhook: true },
  });
  if (!delivery) return { ok: false, responseCode: null, error: "Delivery not found" };
  if (!delivery.webhook.isActive) return { ok: false, responseCode: null, error: "Webhook is disabled" };

  const secret = decryptField(delivery.webhook.secret);
  const body = JSON.stringify({ event: delivery.event, deliveryId: delivery.id, payload: delivery.payload });
  const signature = signPayload(secret, body);

  try {
    const response = await fetch(delivery.webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-FSW-Event": delivery.event,
        "X-FSW-Signature": `sha256=${signature}`,
        "X-FSW-Delivery": delivery.id,
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    return { ok: response.ok, responseCode: response.status };
  } catch (error) {
    return { ok: false, responseCode: null, error: error instanceof Error ? error.message : "Network error" };
  }
}

/** Delivers one webhook attempt immediately and returns the outcome, for the admin "Test delivery" button. */
export async function testWebhookDelivery(webhookId: string): Promise<{ ok: boolean; responseCode: number | null }> {
  const webhook = await prisma.webhook.findUniqueOrThrow({ where: { id: webhookId } });
  const delivery = await prisma.webhookDelivery.create({
    data: {
      webhookId,
      event: "webhook.test",
      payload: { message: "This is a test delivery from FSW Academy.", sentAt: new Date().toISOString() },
      status: "PENDING",
      attempts: 1,
      lastAttemptAt: new Date(),
    },
  });
  const result = await attemptDelivery(delivery.id);
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status: result.ok ? "DELIVERED" : "FAILED",
      responseCode: result.responseCode,
      lastAttemptAt: new Date(),
    },
  });
  return { ok: result.ok, responseCode: result.responseCode };
}

/** Fans an application event out to every active webhook subscribed to it. Called by domain code elsewhere in the app. */
export async function triggerWebhookEvent(event: WebhookEventName, payload: Record<string, unknown>): Promise<void> {
  const webhooks = await prisma.webhook.findMany({ where: { isActive: true } });
  for (const webhook of webhooks) {
    const events = Array.isArray(webhook.events) ? (webhook.events as string[]) : [];
    if (!events.includes(event)) continue;
    const delivery = await prisma.webhookDelivery.create({
      data: { webhookId: webhook.id, event, payload: payload as never, status: "PENDING" },
    });
    await enqueueJob(JOB_TYPES.DELIVER_WEBHOOK, { deliveryId: delivery.id }, { maxAttempts: MAX_WEBHOOK_ATTEMPTS });
  }
}

/**
 * Job handler: attempts one delivery. Throws on a retryable failure so the
 * generic job-queue backoff (src/lib/jobs/queue.ts) reschedules it; gives up
 * quietly once the delivery's own attempt count is exhausted.
 */
export async function handleDeliverWebhookJob(job: ClaimedJob): Promise<void> {
  const deliveryId = job.payload.deliveryId;
  if (typeof deliveryId !== "string") throw new Error("deliver_webhook job missing deliveryId");

  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
  if (!delivery) return; // Deleted since being queued — nothing to do.
  if (delivery.status === "DELIVERED") return;

  const attempts = delivery.attempts + 1;
  const result = await attemptDelivery(deliveryId);

  if (result.ok) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: "DELIVERED", attempts, responseCode: result.responseCode, lastAttemptAt: new Date() },
    });
    return;
  }

  const exhausted = attempts >= MAX_WEBHOOK_ATTEMPTS;
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: exhausted ? "FAILED" : "PENDING",
      attempts,
      responseCode: result.responseCode,
      lastAttemptAt: new Date(),
    },
  });

  if (!exhausted) {
    throw new Error(result.error ?? `Webhook delivery failed (HTTP ${result.responseCode ?? "network error"})`);
  }
}
