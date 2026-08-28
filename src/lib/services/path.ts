import "server-only";
import { prisma } from "@/lib/db";
import { z } from "zod";
import type { Actor } from "@/lib/auth/guard";
import { actorHas, AuthorizationError } from "@/lib/auth/guard";
import type { Permission } from "@/lib/permissions";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { computeCourseProgressPercent } from "@/lib/services/course";

export class ServiceError extends Error {}

function requireCap(actor: Actor, permission: Permission): void {
  if (!actorHas(actor, permission)) throw new AuthorizationError(permission);
}

const nonEmpty = (msg: string) => z.string().trim().min(1, msg);

// ---------------------------------------------------------------------------
// Path authoring
// ---------------------------------------------------------------------------

export const pathInputSchema = z.object({
  title: nonEmpty("Title is required").max(200),
  description: z.string().max(4000).optional().nullable(),
  ownerId: z.string().optional().nullable(),
});
export type PathInput = z.infer<typeof pathInputSchema>;

export async function createPath(actor: Actor, rawInput: unknown) {
  requireCap(actor, "path.create");
  const input = pathInputSchema.parse(rawInput);

  const path = await prisma.learningPath.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      ownerId: input.ownerId ?? actor.id,
      status: "DRAFT",
      createdById: actor.id,
    },
  });

  return path;
}

export async function updatePath(actor: Actor, pathId: string, rawInput: unknown) {
  requireCap(actor, "path.create");
  const input = pathInputSchema.partial().parse(rawInput);

  return prisma.learningPath.update({
    where: { id: pathId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
    },
  });
}

export const pathItemInputSchema = z.object({
  label: z.string().max(120).optional().nullable(),
  targetType: z.enum(["COURSE", "SOP", "LEARNING_PATH"]),
  courseId: z.string().optional().nullable(),
  sopId: z.string().optional().nullable(),
  required: z.boolean().optional(),
  isMilestone: z.boolean().optional(),
  dueDaysAfterStart: z.number().int().min(0).max(3650).optional().nullable(),
});
export type PathItemInput = z.infer<typeof pathItemInputSchema>;

export async function addItem(actor: Actor, pathId: string, rawInput: unknown) {
  requireCap(actor, "path.create");
  const input = pathItemInputSchema.parse(rawInput);
  if (input.targetType === "COURSE" && !input.courseId) throw new ServiceError("Select a course.");
  if (input.targetType === "SOP" && !input.sopId) throw new ServiceError("Select an SOP.");

  const last = await prisma.learningPathItem.findFirst({
    where: { pathId },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  return prisma.learningPathItem.create({
    data: {
      pathId,
      order: (last?.order ?? -1) + 1,
      label: input.label ?? null,
      targetType: input.targetType,
      courseId: input.targetType === "COURSE" ? input.courseId : null,
      sopId: input.targetType === "SOP" ? input.sopId : null,
      required: input.required ?? true,
      isMilestone: input.isMilestone ?? false,
      dueDaysAfterStart: input.dueDaysAfterStart ?? null,
    },
  });
}

export async function updateItem(actor: Actor, itemId: string, rawInput: unknown) {
  requireCap(actor, "path.create");
  const input = pathItemInputSchema.partial().parse(rawInput);

  return prisma.learningPathItem.update({
    where: { id: itemId },
    data: {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.required !== undefined ? { required: input.required } : {}),
      ...(input.isMilestone !== undefined ? { isMilestone: input.isMilestone } : {}),
      ...(input.dueDaysAfterStart !== undefined ? { dueDaysAfterStart: input.dueDaysAfterStart } : {}),
    },
  });
}

export async function deleteItem(actor: Actor, itemId: string) {
  requireCap(actor, "path.create");
  await prisma.learningPathItem.delete({ where: { id: itemId } });
}

export async function reorderItems(actor: Actor, pathId: string, orderedItemIds: string[]) {
  requireCap(actor, "path.create");
  await prisma.$transaction(
    orderedItemIds.map((id, index) => prisma.learningPathItem.update({ where: { id, pathId }, data: { order: index } })),
  );
}

export async function publishPath(actor: Actor, pathId: string) {
  requireCap(actor, "path.publish");

  const itemCount = await prisma.learningPathItem.count({ where: { pathId } });
  if (itemCount === 0) throw new ServiceError("Add at least one item before publishing this path.");

  const path = await prisma.learningPath.update({ where: { id: pathId }, data: { status: "PUBLISHED" } });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.PATH_PUBLISHED,
    entityType: "LEARNING_PATH",
    entityId: pathId,
  });

  return path;
}

export async function archivePath(actor: Actor, pathId: string) {
  requireCap(actor, "training.archive");
  return prisma.learningPath.update({ where: { id: pathId }, data: { status: "ARCHIVED" } });
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

export interface AssignPathResult {
  parentAssignmentIds: string[];
  childAssignmentsCreated: number;
  skipped: number;
}

/**
 * Assigns a path to each user: one parent Assignment (targetType
 * LEARNING_PATH) plus one child Assignment per path item, each pointing back
 * to the parent via parentAssignmentId. Due dates are relative to each
 * user's training start date.
 */
export async function assignPath(actor: Actor, pathId: string, userIds: string[]): Promise<AssignPathResult> {
  requireCap(actor, "training.assign");
  if (userIds.length === 0) throw new ServiceError("Select at least one person to assign.");

  const path = await prisma.learningPath.findUnique({
    where: { id: pathId },
    select: {
      id: true,
      title: true,
      status: true,
      items: { orderBy: { order: "asc" }, select: { id: true, targetType: true, courseId: true, sopId: true, required: true, dueDaysAfterStart: true, label: true } },
    },
  });
  if (!path) throw new ServiceError("Learning path not found.");
  if (path.status !== "PUBLISHED") throw new ServiceError("Publish this path before assigning it.");
  if (path.items.length === 0) throw new ServiceError("This path has no items yet.");

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, trainingStartDate: true, startDate: true },
  });

  const parentAssignmentIds: string[] = [];
  let childAssignmentsCreated = 0;
  let skipped = 0;

  for (const user of users) {
    const baseDate = user.trainingStartDate ?? user.startDate ?? new Date();

    let parent = await prisma.assignment.findFirst({
      where: { userId: user.id, targetType: "LEARNING_PATH", pathId },
    });
    if (!parent) {
      parent = await prisma.assignment.create({
        data: {
          userId: user.id,
          targetType: "LEARNING_PATH",
          pathId,
          status: "ASSIGNED",
          source: "LEARNING_PATH",
          reason: `Assigned to the "${path.title}" learning path`,
          assignedById: actor.id,
        },
      });
    }
    parentAssignmentIds.push(parent.id);

    for (const item of path.items) {
      const dueAt = item.dueDaysAfterStart !== null ? addDays(baseDate, item.dueDaysAfterStart) : null;
      const reason = `Assigned as part of the "${path.title}" learning path${item.label ? ` (${item.label})` : ""}`;

      const existingChild = await prisma.assignment.findFirst({
        where: {
          userId: user.id,
          targetType: item.targetType,
          courseId: item.targetType === "COURSE" ? item.courseId : undefined,
          sopId: item.targetType === "SOP" ? item.sopId : undefined,
          parentAssignmentId: parent.id,
        },
      });
      if (existingChild) {
        skipped += 1;
        continue;
      }

      await prisma.assignment.create({
        data: {
          userId: user.id,
          targetType: item.targetType,
          courseId: item.targetType === "COURSE" ? item.courseId : null,
          sopId: item.targetType === "SOP" ? item.sopId : null,
          parentAssignmentId: parent.id,
          status: "ASSIGNED",
          source: "LEARNING_PATH",
          reason,
          assignedById: actor.id,
          dueAt,
        },
      });
      childAssignmentsCreated += 1;

      await notify({
        userId: user.id,
        type: "TRAINING_ASSIGNED",
        title: `New training assigned: ${item.label ?? "Learning path item"}`,
        body: reason,
        linkUrl: `/paths/${pathId}`,
        dedupeKey: `path-item:${parent.id}:${item.id}`,
      });
    }
  }

  await recordAudit({
    actorId: actor.id,
    action: AUDIT_ACTIONS.ASSIGNMENT_CREATED,
    entityType: "LEARNING_PATH",
    entityId: pathId,
    metadata: { userCount: users.length, childAssignmentsCreated },
  });

  return { parentAssignmentIds, childAssignmentsCreated, skipped };
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface PathItemProgress {
  id: string;
  label: string | null;
  targetType: "COURSE" | "SOP" | "LEARNING_PATH";
  targetId: string | null;
  targetTitle: string;
  required: boolean;
  isMilestone: boolean;
  dueAt: Date | null;
  status: string;
  percent: number;
}

export interface PathProgress {
  pathId: string;
  title: string;
  overallPercent: number;
  items: PathItemProgress[];
}

export async function getPathProgress(actor: Actor, pathId: string, userId: string): Promise<PathProgress> {
  const path = await prisma.learningPath.findUnique({
    where: { id: pathId },
    select: {
      id: true,
      title: true,
      items: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          label: true,
          targetType: true,
          courseId: true,
          sopId: true,
          required: true,
          isMilestone: true,
          course: { select: { title: true } },
        },
      },
    },
  });
  if (!path) throw new ServiceError("Learning path not found.");

  // LearningPathItem has no Prisma relation to Sop (only the sopId scalar),
  // so SOP titles are resolved with a separate lookup.
  const sopIds = path.items.map((item) => item.sopId).filter((id): id is string => Boolean(id));
  const sopTitles = sopIds.length
    ? await prisma.sop.findMany({ where: { id: { in: sopIds } }, select: { id: true, title: true } })
    : [];
  const sopTitleById = new Map(sopTitles.map((s) => [s.id, s.title]));

  const parentAssignment = await prisma.assignment.findFirst({
    where: { userId, targetType: "LEARNING_PATH", pathId },
    select: { id: true },
  });

  const childAssignments = parentAssignment
    ? await prisma.assignment.findMany({
        where: { parentAssignmentId: parentAssignment.id },
        select: { targetType: true, courseId: true, sopId: true, status: true, dueAt: true },
      })
    : [];

  const items: PathItemProgress[] = [];
  for (const item of path.items) {
    const assignment = childAssignments.find(
      (a) =>
        a.targetType === item.targetType &&
        (item.targetType === "COURSE" ? a.courseId === item.courseId : a.sopId === item.sopId),
    );

    let percent = 0;
    if (item.targetType === "COURSE" && item.courseId) {
      percent = await computeCourseProgressPercent(userId, item.courseId);
    } else if (assignment?.status === "COMPLETED") {
      percent = 100;
    }

    items.push({
      id: item.id,
      label: item.label,
      targetType: item.targetType,
      targetId: item.courseId ?? item.sopId,
      targetTitle: item.course?.title ?? (item.sopId ? sopTitleById.get(item.sopId) : undefined) ?? "Untitled item",
      required: item.required,
      isMilestone: item.isMilestone,
      dueAt: assignment?.dueAt ?? null,
      status: assignment?.status ?? (percent >= 100 ? "COMPLETED" : "ASSIGNED"),
      percent,
    });
  }

  const overallPercent =
    items.length === 0 ? 0 : Math.round(items.reduce((sum, i) => sum + i.percent, 0) / items.length);

  return { pathId, title: path.title, overallPercent, items };
}
