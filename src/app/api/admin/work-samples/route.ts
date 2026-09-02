/**
 * Work-sample definitions.
 *
 * A definition and its rubric are created together, and the rubric is
 * validated on the way in. That ordering is the point: the rubric has to
 * exist before anyone does the task, because a rubric written afterwards is
 * written knowing what the answers looked like.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { MAX_LEVEL, MIN_LEVEL, validateRubric } from "@/lib/worksample/rubric";

export const runtime = "nodejs";

const criterionSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).nullish(),
  weight: z.number().positive().max(10).default(1),
  anchors: z
    .array(
      z.object({
        level: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL),
        text: z.string().min(1).max(600),
      }),
    )
    .min(1),
});

const createSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().max(2000).nullish(),
  instructions: z.string().min(1).max(20000),
  successCriteria: z.string().max(4000).nullish(),
  submissionKind: z.enum(["TEXT", "FILE", "TEXT_AND_FILE"]).default("TEXT"),
  timeLimitMinutes: z.number().int().min(5).max(600).nullish(),
  dueInDays: z.number().int().min(1).max(30).default(5),
  allowedFileTypes: z.array(z.string().max(10)).default([]),
  requiredGraders: z.number().int().min(1).max(5).default(2),
  jobProfileId: z.string().min(1).nullish(),
  criteria: z.array(criterionSchema).min(1),
});

export const GET = withErrorHandling(async () => {
  await requirePermission("VIEW_REQUISITIONS");
  const samples = await prisma.workSample.findMany({
    include: {
      jobProfile: { select: { name: true } },
      criteria: { orderBy: { orderIndex: "asc" } },
      _count: { select: { assignments: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  return apiOk({ samples });
});

export const POST = withErrorHandling(async (req) => {
  const user = await requirePermission("MANAGE_WORK_SAMPLES");
  const body = await parseBody(req, createSchema);

  const problems = validateRubric(
    body.criteria.map((c, i) => ({
      id: `new-${i}`,
      name: c.name,
      description: c.description ?? null,
      anchors: c.anchors,
      weight: c.weight ?? 1,
      orderIndex: i,
    })),
  );
  if (problems.length > 0) {
    return apiError(
      `The rubric is not ready: ${problems.map((p) => (p.criterionName ? `${p.criterionName} — ${p.message}` : p.message)).join(" ")}`,
      422,
    );
  }

  if (body.submissionKind !== "TEXT" && (body.allowedFileTypes ?? []).length === 0) {
    return apiError(
      "A task that asks for a file needs a list of accepted file types. Accepting anything means accepting an executable.",
      422,
    );
  }

  const sample = await prisma.workSample.create({
    data: {
      title: body.title,
      summary: body.summary ?? null,
      instructions: body.instructions,
      successCriteria: body.successCriteria ?? null,
      submissionKind: body.submissionKind ?? "TEXT",
      timeLimitMinutes: body.timeLimitMinutes ?? null,
      dueInDays: body.dueInDays ?? 5,
      allowedFileTypes: (body.allowedFileTypes ?? []).map((t) =>
        t.toLowerCase().replace(/^\./, ""),
      ),
      requiredGraders: body.requiredGraders ?? 2,
      jobProfileId: body.jobProfileId ?? null,
      createdById: user.id,
      criteria: {
        create: body.criteria.map((c, i) => ({
          name: c.name,
          description: c.description ?? null,
          weight: c.weight ?? 1,
          orderIndex: i,
          anchors: c.anchors,
        })),
      },
    },
  });

  await audit({
    userId: user.id,
    action: "work_sample.created",
    entityType: "WorkSample",
    entityId: sample.id,
    newValue: { title: sample.title, criteria: body.criteria.length },
  });

  return apiOk({ id: sample.id }, { status: 201 });
});
