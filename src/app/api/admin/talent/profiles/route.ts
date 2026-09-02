/**
 * Talent profiles: search, and ask someone whether they want to be kept
 * in mind.
 *
 * Note what is missing. There is no endpoint that sets consent to OPTED_IN.
 * That state is reachable only from the candidate's own link, because it is
 * the one fact in this module that has to come from them.
 */

import { z } from "zod";
import { apiError, apiOk, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { env } from "@/lib/env";
import {
  inviteToPool,
  searchTalent,
  suppressCandidate,
} from "@/lib/talent/service";

export const runtime = "nodejs";

const searchSchema = z.object({
  query: z.string().max(200).nullish(),
  tagIds: z.array(z.string()).default([]),
  poolId: z.string().nullish(),
  consentStatus: z
    .enum(["NOT_ASKED", "INVITED", "OPTED_IN", "OPTED_OUT"])
    .nullish(),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("invite"), candidateId: z.string().min(1) }),
  z.object({
    action: z.literal("suppress"),
    candidateId: z.string().min(1),
    reason: z.string().max(200).optional(),
  }),
]);

export const POST = withErrorHandling(async (req) => {
  const user = await requirePermission("MANAGE_TALENT_POOL");
  const raw = await req.json().catch(() => null);

  if (raw && typeof raw === "object" && "action" in raw) {
    const body = actionSchema.parse(raw);
    if (body.action === "invite") {
      const result = await inviteToPool({
        candidateId: body.candidateId,
        actorId: user.id,
        baseUrl: env.appBaseUrl,
      });
      if ("error" in result) return apiError(result.error, 409);
      return apiOk(result, { status: 201 });
    }
    await suppressCandidate({
      candidateId: body.candidateId,
      actorId: user.id,
      reason: body.reason,
    });
    return apiOk({ ok: true });
  }

  const filters = searchSchema.parse(raw ?? {});
  const profiles = await searchTalent({
    query: filters.query ?? null,
    tagIds: filters.tagIds ?? [],
    poolId: filters.poolId ?? null,
    consentStatus: filters.consentStatus ?? null,
  });
  return apiOk({ profiles });
});
