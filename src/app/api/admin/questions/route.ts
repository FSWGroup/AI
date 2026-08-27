import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import type { Construct, QuestionKind } from "@prisma/client";

const createSchema = z.object({
  construct: z.string().min(1).max(50),
  subtype: z.string().min(1).max(60),
  kind: z.enum(["MULTIPLE_CHOICE", "LIKERT_STATEMENT", "STRING_COMPARISON"]),
  prompt: z.string().min(3).max(4000),
  choices: z.array(z.string().min(1).max(500)).min(2).max(6).optional(),
  correctIndex: z.number().int().min(0).max(5).optional(),
  explanation: z.string().max(2000).optional(),
  difficulty: z.number().int().min(1).max(3).optional(),
  reverseCoded: z.boolean().optional(),
  /** For dated current-awareness items (admin workflow). */
  currentAwarenessExpiry: z.string().datetime().optional(),
});

export const POST = withErrorHandling(async (req) => {
  const user = await requirePermission("MANAGE_QUESTIONS");
  const body = await parseBody(req, createSchema);

  const question = await prisma.question.create({
    data: {
      construct: body.construct as Construct,
      subtype: body.subtype,
      kind: body.kind as QuestionKind,
      status: "DRAFT",
      createdById: user.id,
      currentAwarenessExpiry: body.currentAwarenessExpiry
        ? new Date(body.currentAwarenessExpiry)
        : undefined,
      versions: {
        create: {
          version: 1,
          construct: body.construct as Construct,
          subtype: body.subtype,
          kind: body.kind as QuestionKind,
          prompt: body.prompt,
          choices: body.choices,
          correctIndex: body.correctIndex,
          explanation: body.explanation,
          difficulty: body.difficulty ?? 2,
          reverseCoded: body.reverseCoded ?? false,
        },
      },
    },
  });
  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.QUESTION_CREATED,
    entityType: "Question",
    entityId: question.id,
    newValue: { construct: body.construct, subtype: body.subtype },
  });
  return apiOk({ id: question.id });
});
