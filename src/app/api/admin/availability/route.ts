/**
 * A person's own interviewing availability.
 *
 * Everyone edits their own; nobody edits anyone else's. Availability is a
 * statement about when you are willing to be interrupted, and having someone
 * else write it for you defeats the purpose.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requireAnyUser } from "@/lib/auth/session";
import { isValidTimeZone } from "@/lib/scheduling/timezone";

export const runtime = "nodejs";

const schema = z.object({
  timeZone: z.string().min(1).max(64).optional(),
  rules: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        startMinute: z.number().int().min(0).max(1440),
        endMinute: z.number().int().min(0).max(1440),
      }),
    )
    .optional(),
  exception: z
    .object({
      date: z.string().min(1),
      startMinute: z.number().int().min(0).max(1440).default(0),
      endMinute: z.number().int().min(0).max(1440).default(1440),
      available: z.boolean().default(false),
      reason: z.string().max(200).nullish(),
    })
    .optional(),
  removeExceptionId: z.string().optional(),
});

export const GET = withErrorHandling(async () => {
  const user = await requireAnyUser();
  const [rules, exceptions, me] = await Promise.all([
    prisma.availabilityRule.findMany({
      where: { userId: user.id, active: true },
      orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    }),
    prisma.availabilityException.findMany({
      where: { userId: user.id, date: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      orderBy: { date: "asc" },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { timeZone: true },
    }),
  ]);
  return apiOk({ rules, exceptions, timeZone: me.timeZone });
});

export const POST = withErrorHandling(async (req) => {
  const user = await requireAnyUser();
  const body = await parseBody(req, schema);

  if (body.timeZone) {
    if (!isValidTimeZone(body.timeZone)) {
      return apiError("That is not a time zone this system recognizes.", 422);
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { timeZone: body.timeZone },
    });
  }

  if (body.rules) {
    for (const r of body.rules) {
      if (r.endMinute <= r.startMinute) {
        return apiError("A window has to end after it starts.", 422);
      }
    }
    // Replace wholesale: the form sends the complete weekly picture, and
    // merging would leave windows the person thought they had deleted.
    await prisma.$transaction([
      prisma.availabilityRule.deleteMany({ where: { userId: user.id } }),
      prisma.availabilityRule.createMany({
        data: body.rules.map((r) => ({ ...r, userId: user.id })),
      }),
    ]);
  }

  if (body.removeExceptionId) {
    await prisma.availabilityException.deleteMany({
      where: { id: body.removeExceptionId, userId: user.id },
    });
  }

  if (body.exception) {
    const date = new Date(`${body.exception.date}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) {
      return apiError("That date is not valid.", 422);
    }
    await prisma.availabilityException.create({
      data: {
        userId: user.id,
        date,
        startMinute: body.exception.startMinute ?? 0,
        endMinute: body.exception.endMinute ?? 1440,
        available: body.exception.available ?? false,
        reason: body.exception.reason ?? null,
      },
    });
  }

  return apiOk({ ok: true });
});
