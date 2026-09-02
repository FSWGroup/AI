/** Create a scheduling request and get the candidate's booking link. */

import { z } from "zod";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { createSchedulingRequest } from "@/lib/scheduling/service";

export const runtime = "nodejs";

const schema = z.object({
  applicationId: z.string().min(1),
  title: z.string().min(1).max(200),
  durationMinutes: z.number().int().min(15).max(480).default(45),
  kitId: z.string().nullish(),
  stageId: z.string().nullish(),
  notes: z.string().max(4000).nullish(),
  meetingDetail: z.string().max(500).nullish(),
  daysAhead: z.number().int().min(1).max(60).default(14),
  minNoticeHours: z.number().int().min(0).max(168).default(12),
  panelists: z
    .array(z.object({ userId: z.string().min(1), required: z.boolean().default(true) }))
    .min(1),
});

export const POST = withErrorHandling(async (req) => {
  const user = await requirePermission("MANAGE_INTERVIEWS");
  const body = await parseBody(req, schema);

  const now = new Date();
  const result = await createSchedulingRequest({
    applicationId: body.applicationId,
    title: body.title,
    durationMinutes: body.durationMinutes ?? 45,
    kitId: body.kitId ?? null,
    stageId: body.stageId ?? null,
    notes: body.notes ?? null,
    meetingDetail: body.meetingDetail ?? null,
    earliestAt: now,
    latestAt: new Date(now.getTime() + (body.daysAhead ?? 14) * 86_400_000),
    minNoticeHours: body.minNoticeHours ?? 12,
    panelists: (body.panelists ?? []).map((p) => ({
      userId: p.userId,
      required: p.required ?? true,
    })),
    actorId: user.id,
    baseUrl: env.appBaseUrl,
  });
  if ("error" in result) return apiError(result.error, 422);
  return apiOk(result, { status: 201 });
});
