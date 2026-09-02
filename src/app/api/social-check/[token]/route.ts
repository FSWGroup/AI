/**
 * Candidate consent and profile disclosure.
 *
 * The candidate decides whether to take part and, if so, which public
 * profiles to share. We never search for accounts they did not give us and
 * never ask for private access — both are the difference between a review the
 * candidate agreed to and surveillance.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, rateLimit, withErrorHandling } from "@/lib/api";
import { hashToken } from "@/lib/crypto";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("consent"),
    profiles: z
      .array(
        z.object({
          network: z.string().min(1).max(60),
          url: z.string().url().max(500),
        }),
      )
      .max(10),
  }),
  z.object({ action: z.literal("decline") }),
]);

export const POST = withErrorHandling(async (req, ctx) => {
  const { token } = await ctx.params;
  const ip =
    req.headers.get("x-nf-client-connection-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  if (!rateLimit(`social:${ip}`, 20, 10 * 60_000)) {
    return apiError("Too many attempts. Please try again shortly.", 429);
  }

  const check = await prisma.socialMediaCheck.findUnique({
    where: { consentTokenHash: hashToken(token) },
  });
  if (!check) return apiError("This link is not valid.", 404);
  if (check.status !== "CONSENT_REQUESTED") {
    return apiError("You have already responded to this request.", 409);
  }

  const body = await parseBody(req, schema);

  if (body.action === "decline") {
    await prisma.socialMediaCheck.update({
      where: { id: check.id },
      data: {
        status: "CONSENT_DECLINED",
        consentDeclinedAt: new Date(),
        // Spend the token either way.
        consentTokenHash: null,
      },
    });
    await audit({
      actorLabel: "candidate",
      action: AUDIT_ACTIONS.SOCIAL_CHECK_CONSENT,
      entityType: "SocialMediaCheck",
      entityId: check.id,
      newValue: { decision: "DECLINED" },
    });
    return apiOk({ status: "DECLINED" });
  }

  await prisma.socialMediaCheck.update({
    where: { id: check.id },
    data: {
      status: "AWAITING_REVIEW",
      consentGivenAt: new Date(),
      consentTokenHash: null,
      disclosedProfiles: body.profiles as unknown as Prisma.InputJsonValue,
    },
  });
  await audit({
    actorLabel: "candidate",
    action: AUDIT_ACTIONS.SOCIAL_CHECK_CONSENT,
    entityType: "SocialMediaCheck",
    entityId: check.id,
    newValue: { decision: "GIVEN", profileCount: body.profiles.length },
  });

  return apiOk({ status: "GIVEN" });
});
