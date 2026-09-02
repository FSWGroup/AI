/**
 * Past applicants worth another look for an open requisition.
 *
 * Returns reasons, not scores. See src/lib/talent/matching.ts for why.
 */

import { apiError, apiOk, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { matchesForRequisition } from "@/lib/talent/service";

export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = withErrorHandling(async (req) => {
  await requirePermission("MANAGE_TALENT_POOL");
  const url = new URL(req.url);
  const requisitionId = url.searchParams.get("requisitionId");
  if (!requisitionId) return apiError("Which requisition?", 400);
  const tags = (url.searchParams.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  return apiOk({ matches: await matchesForRequisition(requisitionId, tags) });
});
