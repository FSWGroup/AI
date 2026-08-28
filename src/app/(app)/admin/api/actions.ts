'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { encryptField, generateToken } from '@/lib/crypto';
import { generateApiKey, ALL_API_SCOPES } from '@/lib/api-keys';
import { WORKFLOW_TRIGGERS } from '@/lib/workflows';
import type { ActionResult } from '@/app/(auth)/actions';

/**
 * Issue an API key. The plaintext is returned exactly once — it is stored
 * only as a SHA-256 hash, so there is no "show key" button anywhere and no
 * way to recover it later.
 */
export async function createApiKeyAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('api.admin');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { error: 'Name the key after the system that will use it.' };
    const scopes = formData.getAll('scopes').map(String).filter((s) => ALL_API_SCOPES.includes(s as never));
    if (scopes.length === 0) return { error: 'Grant at least one scope.' };

    const expiresDays = Number(formData.get('expiresDays'));
    const { key, hash, prefix } = generateApiKey();
    const record = await db.apiKey.create({
      data: {
        name,
        keyHash: hash,
        prefix,
        scopes,
        createdById: ctx.userId,
        expiresAt: Number.isFinite(expiresDays) && expiresDays > 0
          ? new Date(Date.now() + expiresDays * 86_400_000)
          : null,
      },
    });
    await audit(ctx, 'api.key_created', {
      targetType: 'ApiKey',
      targetId: record.id,
      metadata: { name, scopes, prefix },
    });
    revalidatePath('/admin/api');
    return { success: `Key created. Copy it now — it is never shown again: ${key}` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not create the key.' };
  }
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const ctx = await requirePermission('api.admin');
  const id = String(formData.get('keyId') ?? '');
  const key = await db.apiKey.findUnique({ where: { id } });
  if (!key) return;
  await db.apiKey.update({
    where: { id },
    data: { active: false, revokedAt: new Date(), revokedById: ctx.userId },
  });
  await audit(ctx, 'api.key_revoked', { targetType: 'ApiKey', targetId: id, metadata: { name: key.name } });
  revalidatePath('/admin/api');
}

export async function createWebhookAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('api.admin');
    const name = String(formData.get('name') ?? '').trim();
    const url = String(formData.get('url') ?? '').trim();
    if (!name || !url) return { error: 'Give the endpoint a name and a URL.' };

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { error: 'That is not a valid URL.' };
    }
    // An http:// endpoint would send signed HR events in the clear.
    if (parsed.protocol !== 'https:') return { error: 'Webhook endpoints must be https.' };

    const events = formData.getAll('events').map(String).filter(Boolean);
    const secret = generateToken();
    const endpoint = await db.webhookEndpoint.create({
      data: {
        name,
        url,
        secretEnc: encryptField(secret),
        events,
        createdById: ctx.userId,
      },
    });
    await audit(ctx, 'api.webhook_created', {
      targetType: 'WebhookEndpoint',
      targetId: endpoint.id,
      metadata: { name, host: parsed.host, events },
    });
    revalidatePath('/admin/api');
    return {
      success: `Endpoint created. Signing secret — copy it now, it is not shown again: ${secret}`,
    };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not create the endpoint.' };
  }
}

export async function toggleWebhookAction(formData: FormData): Promise<void> {
  const ctx = await requirePermission('api.admin');
  const id = String(formData.get('endpointId') ?? '');
  const endpoint = await db.webhookEndpoint.findUnique({ where: { id } });
  if (!endpoint) return;
  await db.webhookEndpoint.update({
    where: { id },
    data: { active: !endpoint.active, ...(endpoint.active ? {} : { consecutiveFailures: 0 }) },
  });
  await audit(ctx, endpoint.active ? 'api.webhook_disabled' : 'api.webhook_enabled', {
    targetType: 'WebhookEndpoint',
    targetId: id,
  });
  revalidatePath('/admin/api');
}

export { ALL_API_SCOPES, WORKFLOW_TRIGGERS };
