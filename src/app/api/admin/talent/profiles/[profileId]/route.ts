/** Tag a profile, add it to a pool, or record an approach. */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { addToPool, recordOutreach } from "@/lib/talent/service";

export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("tag"),
    label: z.string().min(1).max(60),
    category: z.string().max(30).default("OTHER"),
  }),
  z.object({ action: z.literal("untag"), tagId: z.string().min(1) }),
  z.object({
    action: z.literal("add_to_pool"),
    poolId: z.string().min(1),
    note: z.string().max(1000).nullish(),
  }),
  z.object({
    action: z.literal("remove_from_pool"),
    poolId: z.string().min(1),
  }),
  z.object({
    action: z.literal("outreach"),
    requisitionId: z.string().nullish(),
    channel: z.enum(["EMAIL", "PHONE", "MESSAGE", "OTHER"]).default("EMAIL"),
    note: z.string().max(2000).nullish(),
  }),
  z.object({ action: z.literal("note"), summary: z.string().max(4000) }),
]);

export const POST = withErrorHandling(async (req, ctx) => {
  const user = await requirePermission("MANAGE_TALENT_POOL");
  const { profileId } = await ctx.params;
  const body = await parseBody(req, schema);

  // One guard for every branch below. Without it a bad profile id surfaces as
  // a foreign-key violation or a P2025 — a 500 that reads like the server is
  // broken rather than like the request was wrong.
  const profile = await prisma.talentProfile.findUnique({
    where: { id: profileId },
    select: { id: true, consentStatus: true },
  });
  if (!profile) return apiError("That talent profile does not exist.", 404);

  // Nothing that enriches the record of someone who asked not to be kept.
  //
  // add_to_pool and outreach already refuse through the consent gate; tag and
  // note wrote with raw Prisma and never consulted it, against this module's
  // own claim that every write path passes through it. The row survives an
  // opt-out only so the opt-out itself can be honoured, not so it can go on
  // being built up. Removing things stays allowed.
  const ENRICHING = ["tag", "note"];
  if (profile.consentStatus === "OPTED_OUT" && ENRICHING.includes(body.action)) {
    return apiError(
      "This person asked not to be kept in the talent pool. Their record stays only so that decision can be honoured — nothing more is added to it.",
      409,
    );
  }

  switch (body.action) {
    case "tag": {
      const label = body.label.trim();
      const tag = await prisma.talentTag.upsert({
        where: { label },
        create: { label, category: body.category ?? "OTHER" },
        update: {},
      });
      await prisma.talentProfileTag.upsert({
        where: { profileId_tagId: { profileId, tagId: tag.id } },
        create: { profileId, tagId: tag.id, addedById: user.id },
        update: {},
      });
      return apiOk({ tagId: tag.id, label: tag.label });
    }
    case "untag":
      await prisma.talentProfileTag.deleteMany({
        where: { profileId, tagId: body.tagId },
      });
      return apiOk({ ok: true });
    case "add_to_pool": {
      const result = await addToPool({
        poolId: body.poolId,
        profileId,
        note: body.note ?? null,
        actorId: user.id,
      });
      if (!result.ok) return apiError(result.reason, 409);
      return apiOk({ ok: true });
    }
    case "remove_from_pool":
      await prisma.talentPoolMember.deleteMany({
        where: { profileId, poolId: body.poolId },
      });
      return apiOk({ ok: true });
    case "outreach": {
      const result = await recordOutreach({
        profileId,
        requisitionId: body.requisitionId ?? null,
        channel: body.channel ?? "EMAIL",
        note: body.note ?? null,
        actorId: user.id,
      });
      if (!result.ok) return apiError(result.reason, 409);
      return apiOk({ ok: true });
    }
    case "note":
      await prisma.talentProfile.update({
        where: { id: profileId },
        data: { summary: body.summary },
      });
      return apiOk({ ok: true });
  }
});
