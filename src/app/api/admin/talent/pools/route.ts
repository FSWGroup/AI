/** Talent pools: list and create. */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";

export const runtime = "nodejs";

const schema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).nullish(),
  jobProfileId: z.string().min(1).nullish(),
});

export const GET = withErrorHandling(async () => {
  await requirePermission("MANAGE_TALENT_POOL");
  const pools = await prisma.talentPool.findMany({
    include: {
      jobProfile: { select: { name: true } },
      _count: { select: { members: true } },
    },
    orderBy: { name: "asc" },
  });
  return apiOk({ pools });
});

export const POST = withErrorHandling(async (req) => {
  const user = await requirePermission("MANAGE_TALENT_POOL");
  const body = await parseBody(req, schema);
  const pool = await prisma.talentPool.create({
    data: {
      name: body.name,
      description: body.description ?? null,
      jobProfileId: body.jobProfileId ?? null,
      createdById: user.id,
    },
  });
  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.TALENT_POOL_CREATED,
    entityType: "TalentPool",
    entityId: pool.id,
    newValue: { name: pool.name },
  });
  return apiOk({ id: pool.id }, { status: 201 });
});
