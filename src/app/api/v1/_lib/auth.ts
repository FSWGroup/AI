import { prisma } from "@/lib/db";
import { verifyApiKey } from "@/lib/services/integrations";
import { recordAudit } from "@/lib/audit";
import type { Permission } from "@/lib/permissions";

/**
 * Shared API-key authentication and authorization for the public REST API.
 *
 * Every v1 route calls `authenticateApiRequest(request, requiredPermission)`
 * first. It reads `Authorization: Bearer fsw_...`, hashes and looks up the
 * key (src/lib/services/integrations.ts already checks revoked/expired and
 * bumps lastUsedAt), enforces the key's granted scopes against the
 * permission the endpoint requires, and applies a per-key rate limit backed
 * by RateLimitBucket. Failures are audited; successful mutations are audited
 * by the calling route (so routine reads don't flood the audit log).
 */

export interface ApiAuthContext {
  apiKeyId: string;
  apiKeyName: string;
  scopes: Permission[];
}

const RATE_LIMIT_PER_MINUTE = Number(process.env.API_RATE_LIMIT_PER_MINUTE ?? 120);
const WINDOW_MS = 60_000;

export function apiError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

async function withinRateLimit(apiKeyId: string): Promise<boolean> {
  const key = `apikey:${apiKeyId}`;
  const now = new Date();

  const bucket = await prisma.rateLimitBucket.findUnique({ where: { key } });
  if (!bucket || bucket.resetAt.getTime() <= now.getTime()) {
    await prisma.rateLimitBucket.upsert({
      where: { key },
      create: { key, count: 1, resetAt: new Date(now.getTime() + WINDOW_MS) },
      update: { count: 1, resetAt: new Date(now.getTime() + WINDOW_MS) },
    });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_PER_MINUTE) return false;
  await prisma.rateLimitBucket.update({ where: { key }, data: { count: { increment: 1 } } });
  return true;
}

export async function authenticateApiRequest(
  request: Request,
  requiredPermission: Permission,
): Promise<{ ctx: ApiAuthContext } | { error: Response }> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(fsw_\S+)$/.exec(header.trim());
  if (!match?.[1]) {
    return { error: apiError(401, "unauthorized", "Missing or malformed Authorization header. Expected: Bearer fsw_<key>.") };
  }

  const verified = await verifyApiKey(match[1]);
  if (!verified) {
    await recordAudit({ action: "api.auth_failed", entityType: "API_KEY", metadata: { path: safePath(request) } });
    return { error: apiError(401, "unauthorized", "Invalid, revoked, or expired API key.") };
  }

  if (!verified.scopes.includes(requiredPermission)) {
    await recordAudit({
      action: "api.forbidden",
      entityType: "API_KEY",
      entityId: verified.id,
      metadata: { requiredPermission, path: safePath(request) },
    });
    return { error: apiError(403, "forbidden", `This API key does not have the "${requiredPermission}" scope.`) };
  }

  if (!(await withinRateLimit(verified.id))) {
    return { error: apiError(429, "rate_limited", `Rate limit of ${RATE_LIMIT_PER_MINUTE} requests/minute exceeded. Try again shortly.`) };
  }

  return { ctx: { apiKeyId: verified.id, apiKeyName: verified.name, scopes: verified.scopes } };
}

function safePath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "unknown";
  }
}
