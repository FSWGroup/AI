import "server-only";
import { prisma } from "@/lib/db";
import { addDays, differenceInCalendarDays, endOfDay, startOfDay } from "date-fns";
import type {
  AssignmentRule,
  AssignmentSource,
  Prisma,
  TrainingTargetType,
} from "@prisma/client";
import { type Actor, AuthorizationError, canManageUser } from "@/lib/auth/guard";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { getSettings } from "@/lib/settings";

/**
 * The automatic assignment engine — the core value of FSW Academy.
 *
 * `evaluateCriteria` is a pure function (no DB, no clock reads of its own) so it
 * can be unit-tested directly against fixtures. Everything else in this module
 * builds context, applies rules, and keeps the Assignment table idempotent
 * against its unique constraint (userId, targetType, courseId, sopId, pathId,
 * parentAssignmentId).
 */

// ---------------------------------------------------------------------------
// Criteria evaluation
//
// The pure evaluator lives in ./criteria so it can be unit tested without
// pulling in the database or session layer. Re-exported here so callers have a
// single import site.
// ---------------------------------------------------------------------------

import {
  buildAssignmentReason,
  evaluateCriteria,
  type UserContext,
} from "@/lib/services/criteria";

export {
  buildAssignmentReason,
  evaluateCriteria,
  type CriteriaAll,
  type CriteriaAny,
  type CriteriaCondition,
  type CriteriaField,
  type CriteriaNode,
  type CriteriaNot,
  type CriteriaOp,
  type UserContext,
} from "@/lib/services/criteria";

// ---------------------------------------------------------------------------
// Context assembly (impure — reads the DB and the clock)
// ---------------------------------------------------------------------------

export const USER_CONTEXT_INCLUDE = {
  department: { select: { id: true, name: true } },
  businessUnit: { select: { id: true, slug: true, name: true } },
  team: { select: { id: true, name: true } },
  position: { select: { id: true, title: true } },
  location: { select: { id: true, name: true } },
  manager: { select: { id: true, name: true } },
  roles: { select: { role: { select: { key: true } } } },
} satisfies Prisma.UserInclude;

export type UserForContext = Prisma.UserGetPayload<{ include: typeof USER_CONTEXT_INCLUDE }>;

export function buildUserContext(user: UserForContext): UserContext {
  const anchor = user.startDate ?? user.trainingStartDate ?? user.createdAt;
  return {
    userId: user.id,
    workerType: user.workerType,
    country: user.country,
    state: user.state,
    status: user.status,
    departmentId: user.departmentId,
    departmentName: user.department?.name ?? null,
    teamId: user.teamId,
    teamName: user.team?.name ?? null,
    businessUnitId: user.businessUnitId,
    businessUnitSlug: user.businessUnit?.slug ?? null,
    businessUnitName: user.businessUnit?.name ?? null,
    positionId: user.positionId,
    positionTitle: user.position?.title ?? null,
    locationId: user.locationId,
    locationName: user.location?.name ?? null,
    managerId: user.managerId,
    managerName: user.manager?.name ?? null,
    roleKeys: user.roles.map((r) => r.role.key),
    hireDaysAgo: anchor ? differenceInCalendarDays(new Date(), anchor) : null,
    startDate: user.startDate ? user.startDate.toISOString() : null,
  };
}

async function loadUserForContext(userId: string): Promise<UserForContext | null> {
  return prisma.user.findUnique({ where: { id: userId }, include: USER_CONTEXT_INCLUDE });
}

export async function getUserContext(userId: string): Promise<UserContext | null> {
  const user = await loadUserForContext(userId);
  return user ? buildUserContext(user) : null;
}

// ---------------------------------------------------------------------------
// Assignment upsert core — the single idempotent write path
// ---------------------------------------------------------------------------

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2002"
  );
}

interface EnsureAssignmentInput {
  userId: string;
  targetType: TrainingTargetType;
  courseId?: string | null;
  sopId?: string | null;
  pathId?: string | null;
  parentAssignmentId?: string | null;
  source: AssignmentSource;
  sourceRuleId?: string | null;
  reason?: string | null;
  dueAt?: Date | null;
  assignedById?: string | null;
  /** Recertification restarts a finished cycle instead of being blocked by it. */
  reopenIfTerminal?: boolean;
}

interface EnsureAssignmentResult {
  id: string;
  created: boolean;
  reopened: boolean;
}

/**
 * Find-or-create against the Assignment unique constraint. When
 * `reopenIfTerminal` is set and a COMPLETED/EXPIRED/WAIVED row already
 * occupies that slot, it is reset to ASSIGNED rather than left untouched —
 * the constraint allows only one row per (user, target), so recertification
 * reuses it rather than trying to insert a duplicate.
 */
async function ensureAssignment(input: EnsureAssignmentInput): Promise<EnsureAssignmentResult> {
  const where = {
    userId: input.userId,
    targetType: input.targetType,
    courseId: input.courseId ?? null,
    sopId: input.sopId ?? null,
    pathId: input.pathId ?? null,
    parentAssignmentId: input.parentAssignmentId ?? null,
  };

  const existing = await prisma.assignment.findFirst({ where, select: { id: true, status: true } });
  if (existing) {
    const terminal = existing.status === "COMPLETED" || existing.status === "EXPIRED" || existing.status === "WAIVED";
    if (input.reopenIfTerminal && terminal) {
      await prisma.assignment.update({
        where: { id: existing.id },
        data: {
          status: "ASSIGNED",
          source: input.source,
          sourceRuleId: input.sourceRuleId ?? null,
          reason: input.reason ?? null,
          dueAt: input.dueAt ?? null,
          assignedAt: new Date(),
          assignedById: input.assignedById ?? null,
          startedAt: null,
          completedAt: null,
          waivedAt: null,
          waivedById: null,
          waivedReason: null,
        },
      });
      return { id: existing.id, created: false, reopened: true };
    }
    return { id: existing.id, created: false, reopened: false };
  }

  try {
    const created = await prisma.assignment.create({
      data: {
        ...where,
        source: input.source,
        sourceRuleId: input.sourceRuleId ?? null,
        reason: input.reason ?? null,
        dueAt: input.dueAt ?? null,
        assignedById: input.assignedById ?? null,
      },
      select: { id: true },
    });
    return { id: created.id, created: true, reopened: false };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await prisma.assignment.findFirst({ where, select: { id: true } });
      if (raced) return { id: raced.id, created: false, reopened: false };
    }
    throw error;
  }
}

function linkForTarget(target: { targetType: TrainingTargetType; courseId?: string | null; sopId?: string | null; pathId?: string | null }): string {
  if (target.targetType === "COURSE" && target.courseId) return `/catalog/${target.courseId}`;
  if (target.targetType === "SOP" && target.sopId) return `/sops/${target.sopId}`;
  if (target.targetType === "LEARNING_PATH" && target.pathId) return `/paths/${target.pathId}`;
  return "/my-training";
}

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

async function applyRulesToUser(
  user: UserForContext,
  rules: AssignmentRule[],
): Promise<{ created: number }> {
  if (user.status !== "ACTIVE") return { created: 0 };
  const context = buildUserContext(user);
  let created = 0;
  for (const rule of rules) {
    if (!evaluateCriteria(rule.criteria, context)) continue;
    const result = await ensureAssignment({
      userId: user.id,
      targetType: rule.targetType,
      courseId: rule.courseId,
      sopId: rule.sopId,
      pathId: rule.pathId,
      source: "RULE",
      sourceRuleId: rule.id,
      reason: buildAssignmentReason(rule, context),
      dueAt: rule.dueDays != null ? addDays(new Date(), rule.dueDays) : null,
    });
    if (result.created) {
      created += 1;
      await notify({
        userId: user.id,
        type: "TRAINING_ASSIGNED",
        title: "New training assigned",
        body: buildAssignmentReason(rule, context),
        linkUrl: linkForTarget(rule),
        dedupeKey: `assignment:${result.id}`,
      });
    }
  }
  return { created };
}

/** Apply every active AssignmentRule to a single person. Idempotent. */
export async function evaluateRulesForUser(userId: string): Promise<{ created: number }> {
  const user = await loadUserForContext(userId);
  if (!user) return { created: 0 };
  const rules = await prisma.assignmentRule.findMany({ where: { isActive: true } });
  return applyRulesToUser(user, rules);
}

/**
 * Batch rule evaluation over every active person, paginated by cursor so a
 * 5,000-person org doesn't need to fit in memory at once.
 */
export async function evaluateRulesForAll(pageSize = 200): Promise<{ usersProcessed: number; created: number }> {
  const rules = await prisma.assignmentRule.findMany({ where: { isActive: true } });
  if (rules.length === 0) return { usersProcessed: 0, created: 0 };

  let cursor: string | undefined;
  let usersProcessed = 0;
  let created = 0;

  for (;;) {
    const users: UserForContext[] = await prisma.user.findMany({
      where: { status: "ACTIVE" },
      include: USER_CONTEXT_INCLUDE,
      orderBy: { id: "asc" },
      take: pageSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (users.length === 0) break;

    for (const user of users) {
      const result = await applyRulesToUser(user, rules);
      created += result.created;
      usersProcessed += 1;
    }

    const last = users[users.length - 1];
    cursor = last?.id;
    if (users.length < pageSize) break;
  }

  return { usersProcessed, created };
}

interface PositionRequirementSummary {
  targetType: TrainingTargetType;
  courseId: string | null;
  sopId: string | null;
  pathId: string | null;
  title: string;
}

async function loadPositionRequirements(positionId: string): Promise<PositionRequirementSummary[]> {
  const requirements = await prisma.positionTrainingRequirement.findMany({
    where: { positionId, required: true },
    include: {
      course: { select: { title: true } },
      sop: { select: { title: true } },
      path: { select: { title: true } },
    },
  });
  return requirements.map((r) => ({
    targetType: r.targetType,
    courseId: r.courseId,
    sopId: r.sopId,
    pathId: r.pathId,
    title: r.course?.title ?? r.sop?.title ?? r.path?.title ?? "Untitled training",
  }));
}

/** Assign every required training item attached to a person's position. */
export async function applyPositionRequirements(userId: string): Promise<{ created: number }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, positionId: true, status: true },
  });
  if (!user || !user.positionId || user.status !== "ACTIVE") return { created: 0 };

  const requirements = await loadPositionRequirements(user.positionId);
  let created = 0;
  for (const req of requirements) {
    const result = await ensureAssignment({
      userId,
      targetType: req.targetType,
      courseId: req.courseId,
      sopId: req.sopId,
      pathId: req.pathId,
      source: "POSITION",
      reason: `Assigned because your position requires "${req.title}".`,
    });
    if (result.created) {
      created += 1;
      await notify({
        userId,
        type: "TRAINING_ASSIGNED",
        title: "New training assigned",
        body: `Your position requires "${req.title}".`,
        linkUrl: linkForTarget(req),
        dedupeKey: `assignment:${result.id}`,
      });
    }
  }
  return { created };
}

export interface PositionChangeDiff {
  newlyRequired: PositionRequirementSummary[];
  noLongerRequired: PositionRequirementSummary[];
  retained: PositionRequirementSummary[];
}

/** Diff two positions' training requirements — powers the "what changed" prompt on a position move. */
export async function computePositionChangeDiff(
  _userId: string,
  oldPositionId: string | null,
  newPositionId: string | null,
): Promise<PositionChangeDiff> {
  const [oldReqs, newReqs] = await Promise.all([
    oldPositionId ? loadPositionRequirements(oldPositionId) : Promise.resolve([]),
    newPositionId ? loadPositionRequirements(newPositionId) : Promise.resolve([]),
  ]);
  const keyOf = (r: PositionRequirementSummary) => `${r.targetType}:${r.courseId ?? ""}:${r.sopId ?? ""}:${r.pathId ?? ""}`;
  const oldKeys = new Set(oldReqs.map(keyOf));
  const newKeys = new Set(newReqs.map(keyOf));

  return {
    newlyRequired: newReqs.filter((r) => !oldKeys.has(keyOf(r))),
    noLongerRequired: oldReqs.filter((r) => !newKeys.has(keyOf(r))),
    retained: newReqs.filter((r) => oldKeys.has(keyOf(r))),
  };
}

export interface ProfileSnapshot {
  positionId: string | null;
  departmentId: string | null;
  workerType: string;
  locationId: string | null;
  country: string;
  businessUnitId?: string | null;
  teamId?: string | null;
}

export interface ProfileChangeResult {
  ruleAssignmentsCreated: number;
  positionAssignmentsCreated: number;
  positionDiff: PositionChangeDiff | null;
}

/**
 * Recompute assignments after a profile-affecting field changes. Never
 * removes existing assignments automatically — `positionDiff.noLongerRequired`
 * is returned so the calling UI can prompt an admin to reassign/waive them.
 */
export async function handleProfileChange(
  userId: string,
  before: ProfileSnapshot,
  after: ProfileSnapshot,
): Promise<ProfileChangeResult> {
  let positionDiff: PositionChangeDiff | null = null;
  let positionAssignmentsCreated = 0;

  if (before.positionId !== after.positionId) {
    positionDiff = await computePositionChangeDiff(userId, before.positionId, after.positionId);
    if (after.positionId) {
      const result = await applyPositionRequirements(userId);
      positionAssignmentsCreated = result.created;
    }
  }

  const relevantChange =
    before.positionId !== after.positionId ||
    before.departmentId !== after.departmentId ||
    before.workerType !== after.workerType ||
    before.locationId !== after.locationId ||
    before.country !== after.country ||
    before.businessUnitId !== after.businessUnitId ||
    before.teamId !== after.teamId;

  let ruleAssignmentsCreated = 0;
  if (relevantChange) {
    const result = await evaluateRulesForUser(userId);
    ruleAssignmentsCreated = result.created;
  }

  return { ruleAssignmentsCreated, positionAssignmentsCreated, positionDiff };
}

// ---------------------------------------------------------------------------
// Manual assignment, unassignment, waiving
// ---------------------------------------------------------------------------

export interface AssignTrainingInput {
  userIds: string[];
  targetType: TrainingTargetType;
  courseId?: string | null;
  sopId?: string | null;
  pathId?: string | null;
  dueAt?: Date | null;
  reason?: string | null;
}

export interface AssignTrainingResult {
  assigned: string[];
  alreadyAssigned: string[];
  skipped: { userId: string; reason: string }[];
}

/** Manually assign training to one or more people, permission-checked per target. */
export async function assignTraining(actor: Actor, input: AssignTrainingInput): Promise<AssignTrainingResult> {
  const assigned: string[] = [];
  const alreadyAssigned: string[] = [];
  const skipped: { userId: string; reason: string }[] = [];

  for (const userId of input.userIds) {
    const allowed = await canManageUser(actor, userId);
    if (!allowed) {
      skipped.push({ userId, reason: "You don't have permission to assign training to this person." });
      continue;
    }

    const result = await ensureAssignment({
      userId,
      targetType: input.targetType,
      courseId: input.courseId ?? null,
      sopId: input.sopId ?? null,
      pathId: input.pathId ?? null,
      source: "MANUAL",
      assignedById: actor.id,
      reason: input.reason ?? `Assigned by ${actor.name}.`,
      dueAt: input.dueAt ?? null,
    });

    if (result.created) {
      assigned.push(userId);
      await notify({
        userId,
        type: "TRAINING_ASSIGNED",
        title: "New training assigned",
        body: input.reason ?? `Assigned by ${actor.name}.`,
        linkUrl: linkForTarget(input),
        dedupeKey: `assignment:${result.id}`,
      });
      await recordAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: AUDIT_ACTIONS.ASSIGNMENT_CREATED,
        entityType: "Assignment",
        entityId: result.id,
        metadata: {
          userId,
          targetType: input.targetType,
          courseId: input.courseId,
          sopId: input.sopId,
          pathId: input.pathId,
          source: "MANUAL",
        },
      });
    } else {
      alreadyAssigned.push(userId);
    }
  }

  return { assigned, alreadyAssigned, skipped };
}

/** Remove an assignment outright (distinct from waiving). */
export async function unassign(actor: Actor, assignmentId: string, reason: string): Promise<void> {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, userId: true, targetType: true, courseId: true, sopId: true, pathId: true },
  });
  if (!assignment) throw new Error("That assignment no longer exists.");

  const allowed = await canManageUser(actor, assignment.userId);
  if (!allowed) throw new AuthorizationError("training.assign");

  await prisma.assignment.delete({ where: { id: assignmentId } });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.ASSIGNMENT_REMOVED,
    entityType: "Assignment",
    entityId: assignmentId,
    metadata: { reason, userId: assignment.userId, targetType: assignment.targetType },
  });
}

/** Waive an assignment — the person is exempted, evidence of why is kept. */
export async function waiveAssignment(actor: Actor, assignmentId: string, reason: string): Promise<void> {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, userId: true },
  });
  if (!assignment) throw new Error("That assignment no longer exists.");

  const allowed = await canManageUser(actor, assignment.userId);
  if (!allowed) throw new AuthorizationError("training.assign");

  await prisma.assignment.update({
    where: { id: assignmentId },
    data: { status: "WAIVED", waivedAt: new Date(), waivedById: actor.id, waivedReason: reason },
  });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.ASSIGNMENT_WAIVED,
    entityType: "Assignment",
    entityId: assignmentId,
    metadata: { reason, userId: assignment.userId },
  });
}

// ---------------------------------------------------------------------------
// Job handlers
// ---------------------------------------------------------------------------

/** Flip ASSIGNED/IN_PROGRESS assignments past their due date to OVERDUE, and notify. */
export async function markOverdue(): Promise<{ updated: number }> {
  const now = new Date();
  const overdue = await prisma.assignment.findMany({
    where: { status: { in: ["ASSIGNED", "IN_PROGRESS"] }, dueAt: { lt: now } },
    select: {
      id: true,
      userId: true,
      targetType: true,
      courseId: true,
      sopId: true,
      pathId: true,
      course: { select: { title: true } },
      sop: { select: { title: true } },
      path: { select: { title: true } },
      user: { select: { managerId: true } },
    },
  });

  for (const a of overdue) {
    await prisma.assignment.update({ where: { id: a.id }, data: { status: "OVERDUE" } });
    const title = a.course?.title ?? a.sop?.title ?? a.path?.title ?? "Training";
    const linkUrl = linkForTarget(a);
    await notify({
      userId: a.userId,
      type: "TRAINING_OVERDUE",
      title: `Overdue: ${title}`,
      body: `${title} is now overdue.`,
      linkUrl,
      dedupeKey: `assignment:${a.id}`,
    });
    if (a.user.managerId) {
      await notify({
        userId: a.user.managerId,
        type: "TRAINING_OVERDUE",
        title: `A team member is overdue: ${title}`,
        linkUrl: "/team/status",
        dedupeKey: `assignment:${a.id}:manager`,
      });
    }
  }

  return { updated: overdue.length };
}

/** Notify people whose training is due within the configured reminder windows. */
export async function sendDueReminders(): Promise<{ sent: number }> {
  const settings = await getSettings();
  let sent = 0;

  for (const daysBefore of settings.training.reminderDaysBefore) {
    const windowStart = startOfDay(addDays(new Date(), daysBefore));
    const windowEnd = endOfDay(addDays(new Date(), daysBefore));
    const due = await prisma.assignment.findMany({
      where: { status: { in: ["ASSIGNED", "IN_PROGRESS"] }, dueAt: { gte: windowStart, lte: windowEnd } },
      select: {
        id: true,
        userId: true,
        targetType: true,
        courseId: true,
        sopId: true,
        pathId: true,
        course: { select: { title: true } },
        sop: { select: { title: true } },
        path: { select: { title: true } },
      },
    });

    for (const a of due) {
      const title = a.course?.title ?? a.sop?.title ?? a.path?.title ?? "Training";
      const when = daysBefore === 0 ? "today" : `in ${daysBefore} day${daysBefore === 1 ? "" : "s"}`;
      await notify({
        userId: a.userId,
        type: "TRAINING_DUE_SOON",
        title: `Due soon: ${title}`,
        body: `${title} is due ${when}.`,
        linkUrl: linkForTarget(a),
        dedupeKey: `assignment:${a.id}`,
      });
      sent += 1;
    }
  }

  return { sent };
}

/**
 * Recertification: warn people (and their manager) as a completion's
 * `expiresAt` approaches, then once past expiry ensure exactly one active
 * RECERTIFICATION assignment for that course. CompletionRecord itself is
 * immutable — expiry is a derived state read from `expiresAt`, never a
 * written field.
 */
export async function processRecertification(): Promise<{
  warned: number;
  expired: number;
  recertAssigned: number;
}> {
  const settings = await getSettings();
  let warned = 0;

  for (const daysBefore of settings.training.expiryWarningDays) {
    const windowStart = startOfDay(addDays(new Date(), daysBefore));
    const windowEnd = endOfDay(addDays(new Date(), daysBefore));
    const expiring = await prisma.completionRecord.findMany({
      where: { expiresAt: { gte: windowStart, lte: windowEnd } },
      select: { id: true, userId: true, titleSnapshot: true, user: { select: { managerId: true } } },
    });

    for (const c of expiring) {
      await notify({
        userId: c.userId,
        type: "CERTIFICATE_EXPIRING",
        title: `Expiring soon: ${c.titleSnapshot}`,
        body: `Your completion of "${c.titleSnapshot}" expires in ${daysBefore} day${daysBefore === 1 ? "" : "s"}.`,
        linkUrl: "/certificates",
        dedupeKey: `completion:${c.id}`,
      });
      if (c.user.managerId) {
        await notify({
          userId: c.user.managerId,
          type: "CERTIFICATE_EXPIRING",
          title: `A team member's certification is expiring: ${c.titleSnapshot}`,
          linkUrl: "/team/status",
          dedupeKey: `completion:${c.id}:manager`,
        });
      }
      warned += 1;
    }
  }

  const justExpired = await prisma.completionRecord.findMany({
    where: { expiresAt: { lt: new Date() }, courseId: { not: null } },
    select: { id: true, userId: true, courseId: true, titleSnapshot: true },
  });

  let expired = 0;
  let recertAssigned = 0;
  for (const c of justExpired) {
    if (!c.courseId) continue;
    expired += 1;
    const result = await ensureAssignment({
      userId: c.userId,
      targetType: "COURSE",
      courseId: c.courseId,
      source: "RECERTIFICATION",
      reason: `Recertification required: your completion of "${c.titleSnapshot}" has expired.`,
      dueAt: addDays(new Date(), 30),
      reopenIfTerminal: true,
    });
    if (result.created || result.reopened) {
      recertAssigned += 1;
      await notify({
        userId: c.userId,
        type: "TRAINING_ASSIGNED",
        title: `Recertification required: ${c.titleSnapshot}`,
        body: `Your completion of "${c.titleSnapshot}" has expired. Please retake it.`,
        linkUrl: `/catalog/${c.courseId}`,
        dedupeKey: `assignment:${result.id}`,
      });
    }
  }

  return { warned, expired, recertAssigned };
}

export async function handleEvaluateAssignmentRulesJob(): Promise<void> {
  await evaluateRulesForAll();
}

export async function handleMarkOverdueJob(): Promise<void> {
  await markOverdue();
}

export async function handleSendDueRemindersJob(): Promise<void> {
  await sendDueReminders();
}

export async function handleProcessRecertificationJob(): Promise<void> {
  await processRecertification();
}
