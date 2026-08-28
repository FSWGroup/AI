import "server-only";
import { prisma } from "@/lib/db";
import { type Actor, AuthorizationError, getVisibleUserIds } from "@/lib/auth/guard";
import type { Permission } from "@/lib/permissions";

/**
 * Insight that produces an action.
 *
 * Two questions the platform holds the data to answer but no screen asked:
 *
 *  1. Where is knowledge held by so few people that losing one of them hurts?
 *     A skills matrix shows who has what. It does not show that exactly one
 *     active person can size a control valve — which is the succession
 *     conversation, and the reason to cross-train before someone resigns.
 *
 *  2. What should a manager actually do this week? Managers are the point where
 *     training programmes succeed or quietly fail, and a dashboard asks them to
 *     go and interpret it. This returns named people, the evidence, and one
 *     concrete conversation each.
 *
 * Both are scoped through `getVisibleUserIds`, so a manager sees their own
 * reporting subtree and nothing else, while a platform-scoped role sees
 * everyone. Neither reads a sensitive field, and neither is exposed to the AI
 * knowledge base.
 */

function ensure(actor: Actor, permission: Permission): void {
  if (!actor.permissions.has(permission)) throw new AuthorizationError(permission);
}

/** Active people the actor may see, as a reusable scope filter. */
async function visibleActiveUserIds(actor: Actor): Promise<string[]> {
  const visible = await getVisibleUserIds(actor);
  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      ...(visible === "ALL" ? {} : { id: { in: visible } }),
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

// ---------------------------------------------------------------------------
// 1. Knowledge risk
// ---------------------------------------------------------------------------

export type KnowledgeRiskLevel = "NOBODY" | "SINGLE_HOLDER" | "THIN";

export interface KnowledgeRisk {
  skillId: string;
  skillName: string;
  category: string | null;
  /** The highest level any position demands of this skill. */
  requiredLevel: number;
  /** Active, visible people at or above that level. */
  holders: { id: string; name: string; level: number }[];
  /** Active, visible people whose position demands it. */
  dependentCount: number;
  level: KnowledgeRiskLevel;
  /** Published courses that would close the gap for someone else. */
  howToSpread: { courseId: string; title: string }[];
}

/**
 * Skills the organization depends on but few people hold.
 *
 * "Depends on" means a position requires it — that is the organization saying
 * out loud that the work needs it. A skill nobody's position requires may still
 * be valuable, but its absence is not a risk we can assert, so it is left out
 * rather than padded into the list.
 *
 * `thinThreshold` is the holder count at or below which a skill is reported.
 * Two is the useful default: one holder is a single point of failure, two is one
 * holiday away from being one.
 */
export async function getKnowledgeRisks(
  actor: Actor,
  options: { thinThreshold?: number } = {},
): Promise<KnowledgeRisk[]> {
  ensure(actor, "skills.view");
  const thinThreshold = Math.max(1, options.thinThreshold ?? 2);

  const userIds = await visibleActiveUserIds(actor);
  if (userIds.length === 0) return [];

  // Which skills does the work require, and at what level? Take the highest
  // level demanded by any position held by someone in scope.
  const positions = await prisma.user.findMany({
    where: { id: { in: userIds }, positionId: { not: null } },
    select: { id: true, name: true, positionId: true },
  });
  if (positions.length === 0) return [];

  const positionIds = [...new Set(positions.map((p) => p.positionId as string))];
  const requirements = await prisma.positionSkillRequirement.findMany({
    where: { positionId: { in: positionIds }, required: true },
    include: { skill: { select: { id: true, name: true, category: true, isActive: true } } },
  });

  const required = new Map<string, { level: number; name: string; category: string | null }>();
  const dependentsBySkill = new Map<string, Set<string>>();
  const usersByPosition = new Map<string, { id: string; name: string }[]>();
  for (const person of positions) {
    const list = usersByPosition.get(person.positionId as string) ?? [];
    list.push({ id: person.id, name: person.name });
    usersByPosition.set(person.positionId as string, list);
  }

  for (const requirement of requirements) {
    if (!requirement.skill.isActive) continue;
    const existing = required.get(requirement.skillId);
    if (!existing || requirement.requiredLevel > existing.level) {
      required.set(requirement.skillId, {
        level: requirement.requiredLevel,
        name: requirement.skill.name,
        category: requirement.skill.category,
      });
    }
    const dependents = dependentsBySkill.get(requirement.skillId) ?? new Set<string>();
    for (const person of usersByPosition.get(requirement.positionId) ?? []) {
      dependents.add(person.id);
    }
    dependentsBySkill.set(requirement.skillId, dependents);
  }

  if (required.size === 0) return [];

  const skillIds = [...required.keys()];
  const [held, courseSkills, people] = await Promise.all([
    prisma.userSkill.findMany({
      where: { skillId: { in: skillIds }, userId: { in: userIds } },
      select: { userId: true, skillId: true, level: true },
    }),
    prisma.courseSkill.findMany({
      where: { skillId: { in: skillIds }, course: { status: "PUBLISHED", isDeleted: false } },
      select: { skillId: true, course: { select: { id: true, title: true } } },
    }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
  ]);

  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const holdersBySkill = new Map<string, { id: string; name: string; level: number }[]>();
  for (const row of held) {
    const requirement = required.get(row.skillId);
    if (!requirement || row.level < requirement.level) continue;
    const list = holdersBySkill.get(row.skillId) ?? [];
    list.push({ id: row.userId, name: nameById.get(row.userId) ?? "Unknown", level: row.level });
    holdersBySkill.set(row.skillId, list);
  }

  const coursesBySkill = new Map<string, { courseId: string; title: string }[]>();
  for (const cs of courseSkills) {
    const list = coursesBySkill.get(cs.skillId) ?? [];
    list.push({ courseId: cs.course.id, title: cs.course.title });
    coursesBySkill.set(cs.skillId, list);
  }

  const risks: KnowledgeRisk[] = [];
  for (const [skillId, requirement] of required) {
    const holders = (holdersBySkill.get(skillId) ?? []).sort((a, b) => b.level - a.level);
    if (holders.length > thinThreshold) continue;

    risks.push({
      skillId,
      skillName: requirement.name,
      category: requirement.category,
      requiredLevel: requirement.level,
      holders,
      dependentCount: dependentsBySkill.get(skillId)?.size ?? 0,
      level: holders.length === 0 ? "NOBODY" : holders.length === 1 ? "SINGLE_HOLDER" : "THIN",
      howToSpread: coursesBySkill.get(skillId) ?? [],
    });
  }

  // Worst first: nobody, then single holder, then thin; within a level, the
  // skills the most people depend on.
  const order: Record<KnowledgeRiskLevel, number> = { NOBODY: 0, SINGLE_HOLDER: 1, THIN: 2 };
  return risks.sort(
    (a, b) =>
      order[a.level] - order[b.level] ||
      b.dependentCount - a.dependentCount ||
      a.skillName.localeCompare(b.skillName),
  );
}

// ---------------------------------------------------------------------------
// 2. The manager brief
// ---------------------------------------------------------------------------

export type BriefReason = "OVERDUE" | "STALLED" | "AWAITING_SIGNOFF" | "READY_FOR_MORE";

export interface BriefItem {
  userId: string;
  name: string;
  reason: BriefReason;
  /** What to say, in the manager's own next one-to-one. */
  suggestedConversation: string;
  /** Why the platform is saying this — always shown, never just a score. */
  evidence: string[];
}

export interface ManagerBrief {
  generatedAt: Date;
  teamSize: number;
  items: BriefItem[];
  /** Counts across the whole subtree, so the brief can lead with the shape. */
  totals: { overdue: number; stalled: number; awaitingSignoff: number; readyForMore: number };
}

/** An assignment with no progress for this many days is treated as stalled. */
const STALLED_AFTER_DAYS = 10;

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/**
 * What a manager should do this week, as named people and sentences.
 *
 * Ordered by how much a conversation would help, not by severity alone: someone
 * stalled mid-course usually needs a nudge more than someone who has not started
 * something due next month. Every item carries its evidence, so the manager can
 * disagree with the platform — which they sometimes should.
 */
export async function getManagerBrief(actor: Actor): Promise<ManagerBrief> {
  ensure(actor, "team.view");

  const visible = await getVisibleUserIds(actor);
  const team = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      id: { not: actor.id, ...(visible === "ALL" ? {} : { in: visible }) },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (team.length === 0) {
    return {
      generatedAt: new Date(),
      teamSize: 0,
      items: [],
      totals: { overdue: 0, stalled: 0, awaitingSignoff: 0, readyForMore: 0 },
    };
  }

  const teamIds = team.map((t) => t.id);

  const [assignments, approvals] = await Promise.all([
    prisma.assignment.findMany({
      where: { userId: { in: teamIds }, status: { in: ["ASSIGNED", "IN_PROGRESS", "OVERDUE", "COMPLETED"] } },
      select: {
        userId: true,
        status: true,
        dueAt: true,
        startedAt: true,
        assignedAt: true,
        course: { select: { title: true } },
        sop: { select: { title: true } },
        path: { select: { title: true } },
      },
    }),
    /*
     * Manager sign-offs and practical demos waiting on this manager. Same shape
     * as the Approvals queue reads, deliberately: if the two disagree, one of
     * them is lying to the manager.
     */
    prisma.lessonProgress.findMany({
      where: {
        userId: { in: teamIds },
        status: "IN_PROGRESS",
        lesson: { type: { in: ["MANAGER_SIGNOFF", "PRACTICAL_DEMO"] } },
      },
      select: { userId: true, lesson: { select: { title: true } } },
    }),
  ]);

  const titleOf = (a: (typeof assignments)[number]): string =>
    a.course?.title ?? a.sop?.title ?? a.path?.title ?? "training";

  const overdueBy = new Map<string, string[]>();
  const stalledBy = new Map<string, string[]>();
  const outstandingBy = new Map<string, number>();
  const completedBy = new Map<string, number>();

  for (const assignment of assignments) {
    const list = (map: Map<string, string[]>) => {
      const existing = map.get(assignment.userId) ?? [];
      map.set(assignment.userId, existing);
      return existing;
    };

    if (assignment.status === "COMPLETED") {
      completedBy.set(assignment.userId, (completedBy.get(assignment.userId) ?? 0) + 1);
      continue;
    }

    outstandingBy.set(assignment.userId, (outstandingBy.get(assignment.userId) ?? 0) + 1);

    const isOverdue =
      assignment.status === "OVERDUE" || (assignment.dueAt !== null && assignment.dueAt.getTime() < Date.now());
    if (isOverdue) {
      const days = assignment.dueAt ? daysSince(assignment.dueAt) : 0;
      list(overdueBy).push(`${titleOf(assignment)} — ${plural(Math.max(days, 0), "day")} past due`);
      continue;
    }

    // Started, then nothing. This is the group a conversation actually rescues.
    if (assignment.status === "IN_PROGRESS" && assignment.startedAt) {
      const idle = daysSince(assignment.startedAt);
      if (idle >= STALLED_AFTER_DAYS) {
        list(stalledBy).push(`${titleOf(assignment)} — started ${plural(idle, "day")} ago, no progress since`);
      }
    }
  }

  const signoffBy = new Map<string, string[]>();
  for (const record of approvals) {
    const list = signoffBy.get(record.userId) ?? [];
    list.push(record.lesson.title);
    signoffBy.set(record.userId, list);
  }

  const items: BriefItem[] = [];

  for (const person of team) {
    const name = person.name;
    const first = name.split(" ")[0] ?? name;

    const overdue = overdueBy.get(person.id) ?? [];
    const stalled = stalledBy.get(person.id) ?? [];
    const signoffs = signoffBy.get(person.id) ?? [];
    const outstanding = outstandingBy.get(person.id) ?? 0;
    const completed = completedBy.get(person.id) ?? 0;

    // One item per person, on the most useful thing to raise.
    if (signoffs.length > 0) {
      items.push({
        userId: person.id,
        name,
        reason: "AWAITING_SIGNOFF",
        suggestedConversation: `${first} has finished ${signoffs.length === 1 ? signoffs[0] : plural(signoffs.length, "item")} and is waiting on your sign-off. Watch them do it once, then approve it — they are blocked until you do.`,
        evidence: signoffs.map((title) => `${title} — awaiting your sign-off`),
      });
      continue;
    }

    if (overdue.length > 0) {
      items.push({
        userId: person.id,
        name,
        reason: "OVERDUE",
        suggestedConversation: `Ask ${first} what is getting in the way of ${overdue.length === 1 ? "this" : "these"} — a due date that has passed is usually a workload problem, not a willingness one. Agree a date together rather than restating the old one.`,
        evidence: overdue,
      });
      continue;
    }

    if (stalled.length > 0) {
      items.push({
        userId: person.id,
        name,
        reason: "STALLED",
        suggestedConversation: `${first} started and stopped. Ask what the sticking point was — people usually stall on one confusing step, and naming it takes a minute.`,
        evidence: stalled,
      });
      continue;
    }

    if (outstanding === 0 && completed > 0) {
      items.push({
        userId: person.id,
        name,
        reason: "READY_FOR_MORE",
        suggestedConversation: `${first} is clear on everything assigned. Worth asking what they want to learn next — this is when good people start looking elsewhere for a stretch.`,
        evidence: [`${plural(completed, "completion")} recorded, nothing outstanding`],
      });
    }
  }

  const order: Record<BriefReason, number> = {
    AWAITING_SIGNOFF: 0,
    OVERDUE: 1,
    STALLED: 2,
    READY_FOR_MORE: 3,
  };
  items.sort((a, b) => order[a.reason] - order[b.reason] || a.name.localeCompare(b.name));

  return {
    generatedAt: new Date(),
    teamSize: team.length,
    items,
    totals: {
      overdue: items.filter((i) => i.reason === "OVERDUE").length,
      stalled: items.filter((i) => i.reason === "STALLED").length,
      awaitingSignoff: items.filter((i) => i.reason === "AWAITING_SIGNOFF").length,
      readyForMore: items.filter((i) => i.reason === "READY_FOR_MORE").length,
    },
  };
}
