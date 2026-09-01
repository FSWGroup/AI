/** Create an interview kit with its competencies and questions. */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";

const schema = z.object({
  name: z.string().min(2).max(160),
  description: z.string().max(2000).nullable().optional(),
  durationMinutes: z.number().int().min(5).max(480).default(45),
  competencies: z
    .array(
      z.object({
        name: z.string().min(1).max(160),
        definition: z.string().max(2000).nullable().optional(),
      }),
    )
    .min(1)
    .max(12),
  questions: z
    .array(
      z.object({
        question: z.string().min(3).max(1000),
        listenFor: z.string().max(2000).nullable().optional(),
      }),
    )
    .max(20)
    .default([]),
});

export const POST = withErrorHandling(async (req) => {
  const user = await requirePermission("MANAGE_INTERVIEWS");
  const body = await parseBody(req, schema);

  const kit = await prisma.interviewKit.create({
    data: {
      name: body.name.trim(),
      description: body.description || null,
      durationMinutes: body.durationMinutes,
      createdById: user.id,
      competencies: {
        create: body.competencies.map((c, i) => ({
          name: c.name.trim(),
          definition: c.definition || null,
          orderIndex: i,
        })),
      },
      questions: {
        create: (body.questions ?? []).map((q, i) => ({
          question: q.question.trim(),
          listenFor: q.listenFor || null,
          orderIndex: i,
        })),
      },
    },
  });

  return apiOk({ kitId: kit.id });
});
