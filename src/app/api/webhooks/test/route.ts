import { z } from "zod";
import { authenticateApiRequest } from "@/app/api/v1/_lib/auth";
import { testWebhookDelivery } from "@/lib/services/integrations";

/**
 * POST /api/webhooks/test — fires one test delivery for a configured webhook.
 * API-key gated (reuses the v1 auth helper) so this can be triggered
 * externally as well as from the admin Integrations screen's own server
 * action. Requires the `integrations.manage` scope.
 */

const bodySchema = z.object({ webhookId: z.string().min(1) });

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "integrations.manage");
  if ("error" in auth) return auth.error;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { code: "bad_request", message: "webhookId is required." } }, { status: 400 });

  try {
    const result = await testWebhookDelivery(parsed.data.webhookId);
    return Response.json({ data: result });
  } catch {
    return Response.json({ error: { code: "not_found", message: "That webhook does not exist." } }, { status: 404 });
  }
}
