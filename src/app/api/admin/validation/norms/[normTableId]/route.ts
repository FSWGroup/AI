/**
 * Activate or retire a norm table.
 *
 * Activation is the moment the platform stops saying "provisional band" and
 * starts saying "stanine" for that dimension. It is gated on sample size in
 * the service layer, and it is audited with the sample it was built from,
 * because a stanine's meaning is inseparable from the group it was normed on.
 */

import { z } from "zod";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { activateNormTable, retireNormTable } from "@/lib/validation/service";

export const runtime = "nodejs";

const schema = z.object({ action: z.enum(["activate", "retire"]) });

export const POST = withErrorHandling(async (req, ctx) => {
  const user = await requirePermission("MANAGE_VALIDATION");
  const { normTableId } = await ctx.params;
  const body = await parseBody(req, schema);

  if (body.action === "retire") {
    await retireNormTable(normTableId, user.id);
    return apiOk({ ok: true });
  }

  const result = await activateNormTable(normTableId, user.id);
  if (!result.ok) return apiError(result.reason, 409);
  return apiOk({ ok: true, retiredId: result.retiredId });
});
