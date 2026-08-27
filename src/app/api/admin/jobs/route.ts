import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";

const schema = z.object({
  name: z.string().min(2).max(150),
  description: z.string().max(2000).optional(),
  isSalesRole: z.boolean().default(false),
  leadershipModuleEnabled: z.boolean().default(false),
  openingTitle: z.string().min(2).max(150),
});

export const POST = withErrorHandling(async (req) => {
  const user = await requirePermission("MANAGE_BENCHMARKS");
  const body = await parseBody(req, schema);

  const profile = await prisma.jobProfile.create({
    data: {
      name: body.name,
      description: body.description,
      isSalesRole: body.isSalesRole ?? false,
      leadershipModuleEnabled: body.leadershipModuleEnabled ?? false,
      openings: { create: { title: body.openingTitle } },
    },
    include: { openings: true },
  });
  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.JOB_PROFILE_CREATED,
    entityType: "JobProfile",
    entityId: profile.id,
    newValue: { name: profile.name },
  });
  return apiOk({ id: profile.id });
});
