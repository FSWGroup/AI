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
