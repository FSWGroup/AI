"use server";

import { assertPermission } from "@/lib/auth/guard";
import { ok, fail, runAction, type ActionResult } from "@/lib/action-result";
import {
  saveIntegrationConfig,
  disconnectIntegration,
  createApiKey,
  revokeApiKey,
  createWebhook,
  setWebhookActive,
  deleteWebhook,
  testWebhookDelivery,
  listWebhookDeliveries,
  type WebhookDeliveryView,
} from "@/lib/services/integrations";
import { revalidatePath } from "next/cache";

const PATH = "/admin/integrations";

export async function saveIntegrationConfigAction(key: string, config: Record<string, unknown>): Promise<ActionResult<{ detail: string }>> {
  return runAction("integrations.save", async () => {
    const actor = await assertPermission("integrations.manage");
    const result = await saveIntegrationConfig(actor, key, config);
    revalidatePath(PATH);
    return result.ok ? ok({ detail: result.detail }) : fail(result.detail);
  });
}

export async function disconnectIntegrationAction(key: string): Promise<ActionResult> {
  return runAction("integrations.disconnect", async () => {
    const actor = await assertPermission("integrations.manage");
    await disconnectIntegration(actor, key);
    revalidatePath(PATH);
    return ok();
  });
}

export async function createApiKeyAction(input: { name: string; scopes: string[] }): Promise<ActionResult<{ id: string; prefix: string; secret: string }>> {
  return runAction("apikey.create", async () => {
    const actor = await assertPermission("integrations.manage");
    if (!input.name.trim()) return fail("Give the key a name so you can recognize it later.");
    const created = await createApiKey(actor, input);
    revalidatePath(PATH);
    return ok({ id: created.id, prefix: created.prefix, secret: created.secret });
  });
}

export async function revokeApiKeyAction(id: string): Promise<ActionResult> {
  return runAction("apikey.revoke", async () => {
    const actor = await assertPermission("integrations.manage");
    await revokeApiKey(actor, id);
    revalidatePath(PATH);
    return ok();
  });
}

export async function createWebhookAction(input: { url: string; events: string[] }): Promise<ActionResult<{ id: string; secret: string }>> {
  return runAction("webhook.create", async () => {
    const actor = await assertPermission("integrations.manage");
    if (!/^https?:\/\//.test(input.url)) return fail("Enter a valid URL starting with http:// or https://.");
    if (input.events.length === 0) return fail("Choose at least one event.");
    const created = await createWebhook(actor, input);
    revalidatePath(PATH);
    return ok(created);
  });
}

export async function setWebhookActiveAction(id: string, isActive: boolean): Promise<ActionResult> {
  return runAction("webhook.toggle", async () => {
    const actor = await assertPermission("integrations.manage");
    await setWebhookActive(actor, id, isActive);
    revalidatePath(PATH);
    return ok();
  });
}

export async function deleteWebhookAction(id: string): Promise<ActionResult> {
  return runAction("webhook.delete", async () => {
    const actor = await assertPermission("integrations.manage");
    await deleteWebhook(actor, id);
    revalidatePath(PATH);
    return ok();
  });
}

export async function testWebhookAction(id: string): Promise<ActionResult<{ ok: boolean; responseCode: number | null }>> {
  return runAction("webhook.test", async () => {
    await assertPermission("integrations.manage");
    const result = await testWebhookDelivery(id);
    revalidatePath(PATH);
    return ok(result);
  });
}

export async function loadWebhookDeliveriesAction(webhookId: string): Promise<ActionResult<{ deliveries: WebhookDeliveryView[] }>> {
  return runAction("webhook.deliveries", async () => {
    await assertPermission("integrations.manage");
    const deliveries = await listWebhookDeliveries(webhookId);
    return ok({ deliveries });
  });
}
