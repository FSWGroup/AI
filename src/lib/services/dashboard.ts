import "server-only";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/auth/guard";
import { getSettings } from "@/lib/settings";
import { listActiveAnnouncementsForActor, type ActiveAnnouncement } from "@/lib/services/announcements";
import { getContentHealth } from "@/lib/services/reports";
import { getAiActivitySummary } from "@/lib/services/analytics";

/**
 * The three dashboards. Each function issues one batch of concurrent queries
 * (Promise.all) rather than looping per row — no N+1s hiding in a per-item
 * fetch. Percentages and rates are computed in JS from the batched results.
 */

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

// ---------------------------------------------------------------------------
// Learner dashboard
// ---------------------------------------------------------------------------

export interface ContinueLearningItem {
  lessonId: string;
  lessonTitle: string;
  courseId: string;
  courseTitle: string;
  sectionTitle: string;
  updatedAt: Date;
}

export interface AssignmentItem {
  assignmentId: string;
  title: string;
  type: "COURSE" | "SOP" | "LEARNING_PATH";
  targetId: string;
  dueAt: Date | null;
}

export interface PathProgressItem {
  assignmentId: string;
  pathId: string;
  title: string;
  percentComplete: number;
  dueAt: Date | null;
}

export interface RecentSopView {
  sopId: string;
  title: string;
  sopCode: string;
  viewedAt: Date;
}

export interface RecommendedItem {
  type: "COURSE" | "SOP" | "LEARNING_PATH";
  id: string;
  title: string;
  reason: string;
}

export interface CertificateSummary {
  id: string;
  courseTitle: string;
  certificateNumber: string;
  issuedAt: Date;
  expiresAt: Date | null;
}

export interface SkillSummary {
  skillId: string;
  name: string;
  level: number;
}

export interface StreakInfo {
  currentStreakDays: number;
  totalCompletions: number;
  totalCertificates: number;
}

export interface LeaderboardEntry {
  name: string;
  completions: number;
}

export interface LearnerDashboard {
  continueLearning: ContinueLearningItem | null;
  dueSoon: AssignmentItem[];
  overdue: AssignmentItem[];
  paths: PathProgressItem[];
  recentSops: RecentSopView[];
  recommended: RecommendedItem[];
  certificates: CertificateSummary[];
  skills: SkillSummary[];
  announcements: ActiveAnnouncement[];
  streak: StreakInfo;
  leaderboard: LeaderboardEntry[] | null;
  isFirstLogin: boolean;
}

function titleOfAssignment(a: {
  targetType: string;
  course: { title: string } | null;
  sop: { title: string; sopCode: string } | null;
  path: { title: string } | null;
}): string {
  if (a.course) return a.course.title;
  if (a.sop) return `${a.sop.sopCode} — ${a.sop.title}`;
  if (a.path) return a.path.title;
  return "Untitled";
}

export async function getLearnerDashboard(actor: Actor): Promise<LearnerDashboard> {
  const settings = await getSettings();
  const dueSoonHorizon = new Date(Date.now() + Math.max(...settings.training.reminderDaysBefore, 14) * 24 * 60 * 60 * 1000);

  const [
    latestProgress,
    dueSoonAssignments,
    overdueAssignments,
    pathAssignments,
    recentViews,
    positionRequirements,
    myAssignmentTargetIds,
    certificates,
    skills,
    announcements,
    completionDates,
    totalCompletions,
    totalCertificates,
  ] = await Promise.all([
    prisma.lessonProgress.findFirst({
      where: { userId: actor.id, status: "IN_PROGRESS" },
      orderBy: { updatedAt: "desc" },
      include: { lesson: { select: { title: true, section: { select: { title: true, course: { select: { id: true, title: true } } } } } } },
    }),
    prisma.assignment.findMany({
      where: { userId: actor.id, status: { in: ["ASSIGNED", "IN_PROGRESS"] }, dueAt: { not: null, lte: dueSoonHorizon, gte: new Date() } },
      orderBy: { dueAt: "asc" },
      take: 8,
      include: { course: { select: { title: true } }, sop: { select: { title: true, sopCode: true } }, path: { select: { title: true } } },
    }),
    prisma.assignment.findMany({
      where: { userId: actor.id, OR: [{ status: "OVERDUE" }, { status: { in: ["ASSIGNED", "IN_PROGRESS"] }, dueAt: { lt: new Date() } }] },
      orderBy: { dueAt: "asc" },
      take: 8,
      include: { course: { select: { title: true } }, sop: { select: { title: true, sopCode: true } }, path: { select: { title: true } } },
    }),
    prisma.assignment.findMany({
      where: { userId: actor.id, targetType: "LEARNING_PATH" },
      orderBy: { assignedAt: "desc" },
      take: 5,
      include: { path: { select: { title: true, items: { where: { required: true }, select: { id: true } } } } },
    }),
    prisma.contentView.findMany({
      where: { userId: actor.id, entityType: "SOP" },
      orderBy: { viewedAt: "desc" },
      take: 20,
    }),
    actor.positionId
      ? prisma.positionTrainingRequirement.findMany({
          where: { positionId: actor.positionId },
          include: { course: { select: { id: true, title: true } }, sop: { select: { id: true, title: true, sopCode: true } }, path: { select: { id: true, title: true } } },
        })
      : Promise.resolve([]),
    prisma.assignment.findMany({ where: { userId: actor.id }, select: { courseId: true, sopId: true, pathId: true } }),
    prisma.certificate.findMany({
      where: { userId: actor.id, revokedAt: null },
      orderBy: { issuedAt: "desc" },
      take: 5,
    }),
    prisma.userSkill.findMany({ where: { userId: actor.id }, orderBy: { level: "desc" }, take: 8, include: { skill: { select: { name: true } } } }),
    listActiveAnnouncementsForActor(actor, 5),
    prisma.completionRecord.findMany({ where: { userId: actor.id }, select: { completedAt: true }, orderBy: { completedAt: "desc" }, take: 90 }),
    prisma.completionRecord.count({ where: { userId: actor.id } }),
    prisma.certificate.count({ where: { userId: actor.id, revokedAt: null } }),
  ]);

  // De-duplicate recently viewed SOPs by entityId, keep most recent, cap 5.
  const seenSops = new Set<string>();
  const uniqueSopIds: string[] = [];
  for (const view of recentViews) {
    if (!seenSops.has(view.entityId)) {
      seenSops.add(view.entityId);
      uniqueSopIds.push(view.entityId);
    }
    if (uniqueSopIds.length >= 5) break;
  }
  const sopDetails = uniqueSopIds.length
    ? await prisma.sop.findMany({ where: { id: { in: uniqueSopIds } }, select: { id: true, title: true, sopCode: true } })
    : [];
  const sopById = new Map(sopDetails.map((s) => [s.id, s]));
  const recentSops: RecentSopView[] = uniqueSopIds
    .map((id) => {
      const detail = sopById.get(id);
      const viewedAt = recentViews.find((v) => v.entityId === id)?.viewedAt;
      return detail && viewedAt ? { sopId: id, title: detail.title, sopCode: detail.sopCode, viewedAt } : null;
    })
    .filter((v): v is RecentSopView => v !== null);

  // Learning path progress: batch child-assignment completion counts in one query.
  const parentIds = pathAssignments.map((a) => a.id);
  const childCounts = parentIds.length
    ? await prisma.assignment.groupBy({ by: ["parentAssignmentId"], where: { parentAssignmentId: { in: parentIds }, status: "COMPLETED" }, _count: { _all: true } })
    : [];
  const completedByParent = new Map(childCounts.map((c) => [c.parentAssignmentId as string, c._count._all]));
  const paths: PathProgressItem[] = pathAssignments.map((a) => ({
    assignmentId: a.id,
    pathId: a.pathId ?? "",
    title: a.path?.title ?? "—",
    percentComplete: pct(completedByParent.get(a.id) ?? 0, a.path?.items.length ?? 0),
    dueAt: a.dueAt,
  }));

  // Recommended: position requirements not already assigned.
  const assignedCourseIds = new Set(myAssignmentTargetIds.map((a) => a.courseId).filter(Boolean));
  const assignedSopIds = new Set(myAssignmentTargetIds.map((a) => a.sopId).filter(Boolean));
  const assignedPathIds = new Set(myAssignmentTargetIds.map((a) => a.pathId).filter(Boolean));
  const recommended: RecommendedItem[] = positionRequirements
    .filter((req) => {
      if (req.targetType === "COURSE") return req.courseId && !assignedCourseIds.has(req.courseId);
      if (req.targetType === "SOP") return req.sopId && !assignedSopIds.has(req.sopId);
      return req.pathId && !assignedPathIds.has(req.pathId);
    })
    .slice(0, 6)
    .map((req) => ({
      type: req.targetType === "COURSE" ? "COURSE" : req.targetType === "SOP" ? "SOP" : "LEARNING_PATH",
      id: (req.courseId ?? req.sopId ?? req.pathId) as string,
      title: req.course?.title ?? (req.sop ? `${req.sop.sopCode} — ${req.sop.title}` : req.path?.title) ?? "—",
      reason: "Required for your position",
    }));

  // Completion streak: consecutive calendar days (UTC) with at least one completion, ending today or yesterday.
  const completionDays = new Set(completionDates.map((c) => c.completedAt.toISOString().slice(0, 10)));
  let currentStreakDays = 0;
  {
    const cursor = new Date();
    cursor.setUTCHours(0, 0, 0, 0);
    const todayKey = cursor.toISOString().slice(0, 10);
    if (!completionDays.has(todayKey)) cursor.setUTCDate(cursor.getUTCDate() - 1);
    while (completionDays.has(cursor.toISOString().slice(0, 10))) {
      currentStreakDays += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
  }

  let leaderboard: LeaderboardEntry[] | null = null;
  if (settings.features.leaderboards) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const teamIds = actor.teamId ? await prisma.user.findMany({ where: { teamId: actor.teamId }, select: { id: true, name: true } }) : [];
    if (teamIds.length > 0) {
      const counts = await prisma.completionRecord.groupBy({
        by: ["userId"],
        where: { userId: { in: teamIds.map((u) => u.id) }, completedAt: { gte: since } },
        _count: { _all: true },
      });
      const nameById = new Map(teamIds.map((u) => [u.id, u.name]));
      leaderboard = counts
        .map((c) => ({ name: nameById.get(c.userId) ?? "—", completions: c._count._all }))
        .sort((a, b) => b.completions - a.completions)
        .slice(0, 5);
    }
  }

  const isFirstLogin = totalCompletions === 0 && pathAssignments.length > 0;

  return {
    continueLearning: latestProgress
      ? {
          lessonId: latestProgress.lessonId,
          lessonTitle: latestProgress.lesson.title,
          courseId: latestProgress.courseId,
          courseTitle: latestProgress.lesson.section.course.title,
          sectionTitle: latestProgress.lesson.section.title,
          updatedAt: latestProgress.updatedAt,
        }
      : null,
    dueSoon: dueSoonAssignments.map((a) => ({ assignmentId: a.id, title: titleOfAssignment(a), type: a.targetType as "COURSE" | "SOP" | "LEARNING_PATH", targetId: (a.courseId ?? a.sopId ?? a.pathId) as string, dueAt: a.dueAt })),
    overdue: overdueAssignments.map((a) => ({ assignmentId: a.id, title: titleOfAssignment(a), type: a.targetType as "COURSE" | "SOP" | "LEARNING_PATH", targetId: (a.courseId ?? a.sopId ?? a.pathId) as string, dueAt: a.dueAt })),
    paths,
    recentSops,
    recommended,
    certificates: certificates.map((c) => ({ id: c.id, courseTitle: c.courseTitleSnapshot, certificateNumber: c.certificateNumber, issuedAt: c.issuedAt, expiresAt: c.expiresAt })),
    skills: skills.map((s) => ({ skillId: s.skillId, name: s.skill.name, level: s.level })),
    announcements,
    streak: { currentStreakDays, totalCompletions, totalCertificates },
    leaderboard,
    isFirstLogin,
  };
}

// ---------------------------------------------------------------------------
// First-login onboarding welcome
// ---------------------------------------------------------------------------

export interface OnboardingWelcome {
  manager: { id: string; name: string; title: string | null; email: string } | null;
  team: { id: string; name: string; title: string | null }[];
  position: { title: string; toolsUsed: string[] } | null;
  onboardingPath: { id: string; title: string; percentComplete: number } | null;
  todayTraining: { lessonId: string; lessonTitle: string; courseId: string; courseTitle: string }[];
  firstWeekChecklist: { label: string; targetType: string; targetId: string; required: boolean }[];
  importantSops: { id: string; sopCode: string; title: string; acknowledged: boolean }[];
}

export async function getOnboardingWelcome(actor: Actor): Promise<OnboardingWelcome> {
  const [manager, position, pathAssignment, positionSops, acks] = await Promise.all([
    actor.managerId ? prisma.user.findUnique({ where: { id: actor.managerId }, select: { id: true, name: true, title: true, email: true } }) : null,
    actor.positionId
      ? prisma.position.findUnique({ where: { id: actor.positionId }, select: { title: true, toolsUsed: true } })
      : null,
    prisma.assignment.findFirst({
      where: { userId: actor.id, targetType: "LEARNING_PATH" },
      orderBy: { assignedAt: "asc" },
      include: { path: { select: { id: true, title: true, items: { orderBy: { order: "asc" }, include: { course: { select: { id: true, title: true } } } } } } },
    }),
    actor.positionId
      ? prisma.positionTrainingRequirement.findMany({ where: { positionId: actor.positionId, targetType: "SOP" }, include: { sop: { select: { id: true, sopCode: true, title: true } } } })
      : Promise.resolve([]),
    prisma.acknowledgement.findMany({ where: { userId: actor.id, sopVersionId: { not: null } }, select: { sopVersion: { select: { sopId: true } } } }),
  ]);

  const team = actor.teamId
    ? await prisma.user.findMany({ where: { teamId: actor.teamId, id: { not: actor.id }, status: "ACTIVE" }, select: { id: true, name: true, title: true }, take: 12 })
    : [];

  const items = pathAssignment?.path?.items ?? [];
  const completedChildCount = pathAssignment
    ? await prisma.assignment.count({ where: { parentAssignmentId: pathAssignment.id, status: "COMPLETED" } })
    : 0;
  const requiredCount = items.filter((i) => i.required).length;

  const todayTraining: OnboardingWelcome["todayTraining"] = [];
  const firstItem = items.find((i) => i.courseId && i.course);
  const firstItemCourseId = firstItem?.courseId;
  if (firstItem?.course && firstItemCourseId) {
    const firstLesson = await prisma.lesson.findFirst({
      where: { section: { courseId: firstItemCourseId } },
      orderBy: [{ section: { order: "asc" } }, { order: "asc" }],
      select: { id: true, title: true },
    });
    if (firstLesson) {
      todayTraining.push({ lessonId: firstLesson.id, lessonTitle: firstLesson.title, courseId: firstItemCourseId, courseTitle: firstItem.course.title });
    }
  }

  const acknowledgedSopIds = new Set(acks.map((a) => a.sopVersion?.sopId).filter((id): id is string => Boolean(id)));

  return {
    manager: manager ?? null,
    team,
    position: position ? { title: position.title, toolsUsed: Array.isArray(position.toolsUsed) ? (position.toolsUsed as string[]) : [] } : null,
    onboardingPath: pathAssignment?.path ? { id: pathAssignment.path.id, title: pathAssignment.path.title, percentComplete: pct(completedChildCount, requiredCount) } : null,
    todayTraining,
    firstWeekChecklist: items
      .filter((i) => (i.dueDaysAfterStart ?? 999) <= 7)
      .map((i) => ({ label: i.label ?? i.course?.title ?? "Step", targetType: i.targetType, targetId: (i.courseId ?? i.sopId ?? "") as string, required: i.required })),
    importantSops: positionSops.map((req) => ({
      id: req.sop!.id,
      sopCode: req.sop!.sopCode,
      title: req.sop!.title,
      acknowledged: acknowledgedSopIds.has(req.sop!.id),
    })),
  };
}

// ---------------------------------------------------------------------------
// Manager dashboard
// ---------------------------------------------------------------------------

async function getTeamUserIds(managerId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree AS (
      SELECT "id" FROM "User" WHERE "managerId" = ${managerId}
      UNION
      SELECT u."id" FROM "User" u INNER JOIN subtree s ON u."managerId" = s."id"
    )
    SELECT "id" FROM subtree
  `;
  return rows.map((r) => r.id);
}

export interface ManagerDashboard {
  teamSize: number;
  teamCompletionRate: number;
  overduePeople: { id: string; name: string; overdueCount: number }[];
  upcomingDeadlines: { id: string; person: string; title: string; dueAt: Date }[];
  onboarding: { id: string; name: string; startDate: Date | null; percentComplete: number }[];
  skillGapCount: number;
  certificatesExpiring: { id: string; person: string; course: string; expiresAt: Date }[];
  awaitingSignOff: { lessonId: string; lessonTitle: string; person: string; courseId: string }[];
  recentlyCompleted: { person: string; title: string; completedAt: Date }[];
  matrixSummary: { person: string; completionRate: number; overdueCount: number }[];
}

export async function getManagerDashboard(actor: Actor): Promise<ManagerDashboard> {
  const teamIds = await getTeamUserIds(actor.id);
  if (teamIds.length === 0) {
    return {
      teamSize: 0,
      teamCompletionRate: 0,
      overduePeople: [],
      upcomingDeadlines: [],
      onboarding: [],
      skillGapCount: 0,
      certificatesExpiring: [],
      awaitingSignOff: [],
      recentlyCompleted: [],
      matrixSummary: [],
    };
  }

  const soon = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const expiringHorizon = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  const onboardingSince = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const recentSince = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const [
    assignmentTotals,
    overdueAssignments,
    upcoming,
    newHires,
    certificatesExpiring,
    signOffLessons,
    recentCompletions,
    positionsWithReqs,
  ] = await Promise.all([
    prisma.assignment.groupBy({ by: ["status"], where: { userId: { in: teamIds } }, _count: { _all: true } }),
    prisma.assignment.findMany({
      where: { userId: { in: teamIds }, OR: [{ status: "OVERDUE" }, { status: { in: ["ASSIGNED", "IN_PROGRESS"] }, dueAt: { lt: new Date() } }] },
      select: { userId: true, user: { select: { name: true } } },
    }),
    prisma.assignment.findMany({
      where: { userId: { in: teamIds }, status: { in: ["ASSIGNED", "IN_PROGRESS"] }, dueAt: { not: null, gte: new Date(), lte: soon } },
      orderBy: { dueAt: "asc" },
      take: 10,
      include: { user: { select: { name: true } }, course: { select: { title: true } }, sop: { select: { title: true, sopCode: true } }, path: { select: { title: true } } },
    }),
    prisma.user.findMany({ where: { id: { in: teamIds }, startDate: { gte: onboardingSince } }, select: { id: true, name: true, startDate: true } }),
    prisma.certificate.findMany({
      where: { userId: { in: teamIds }, revokedAt: null, expiresAt: { not: null, lte: expiringHorizon } },
      orderBy: { expiresAt: "asc" },
      take: 10,
      include: { user: { select: { name: true } } },
    }),
    prisma.lesson.findMany({ where: { type: { in: ["MANAGER_SIGNOFF", "PRACTICAL_DEMO"] } }, select: { id: true, title: true, section: { select: { courseId: true, course: { select: { title: true } } } } } }),
    prisma.completionRecord.findMany({
      where: { userId: { in: teamIds }, completedAt: { gte: recentSince } },
      orderBy: { completedAt: "desc" },
      take: 10,
      include: { user: { select: { name: true } } },
    }),
    prisma.user.findMany({
      where: { id: { in: teamIds }, positionId: { not: null } },
      select: {
        id: true,
        name: true,
        position: { select: { skillRequirements: { select: { skillId: true, requiredLevel: true } } } },
        skills: { select: { skillId: true, level: true } },
      },
    }),
  ]);

  const assigned = assignmentTotals.reduce((sum, r) => sum + r._count._all, 0);
  const completed = assignmentTotals.find((r) => r.status === "COMPLETED")?._count._all ?? 0;

  const overdueByPerson = new Map<string, { name: string; count: number }>();
  for (const a of overdueAssignments) {
    const bucket = overdueByPerson.get(a.userId) ?? { name: a.user.name, count: 0 };
    bucket.count += 1;
    overdueByPerson.set(a.userId, bucket);
  }

  const lessonIds = signOffLessons.map((l) => l.id);
  const pendingSignOffs = lessonIds.length
    ? await prisma.lessonProgress.findMany({
        where: { lessonId: { in: lessonIds }, userId: { in: teamIds }, status: "IN_PROGRESS" },
        include: { user: { select: { name: true } } },
        take: 10,
      })
    : [];
  const lessonById = new Map(signOffLessons.map((l) => [l.id, l]));

  // Onboarding progress per new hire's earliest learning-path assignment.
  const onboardingPathAssignments = newHires.length
    ? await prisma.assignment.findMany({
        where: { userId: { in: newHires.map((u) => u.id) }, targetType: "LEARNING_PATH" },
        orderBy: { assignedAt: "asc" },
        distinct: ["userId"],
        include: { path: { select: { items: { where: { required: true }, select: { id: true } } } } },
      })
    : [];
  const pathAssignmentByUser = new Map(onboardingPathAssignments.map((a) => [a.userId, a]));
  const onboardingParentIds = onboardingPathAssignments.map((a) => a.id);
  const onboardingCompletedCounts = onboardingParentIds.length
    ? await prisma.assignment.groupBy({ by: ["parentAssignmentId"], where: { parentAssignmentId: { in: onboardingParentIds }, status: "COMPLETED" }, _count: { _all: true } })
    : [];
  const onboardingCompletedByParent = new Map(onboardingCompletedCounts.map((c) => [c.parentAssignmentId as string, c._count._all]));

  // Skill gaps across the team (count only, computed in JS from batched data).
  let skillGapCount = 0;
  for (const u of positionsWithReqs) {
    const levelBySkill = new Map(u.skills.map((s) => [s.skillId, s.level]));
    for (const req of u.position?.skillRequirements ?? []) {
      if ((levelBySkill.get(req.skillId) ?? 0) < req.requiredLevel) skillGapCount += 1;
    }
  }

  // Per-person matrix summary (assignment completion rate), capped to a readable list.
  const perPersonTotals = await prisma.assignment.groupBy({ by: ["userId", "status"], where: { userId: { in: teamIds } }, _count: { _all: true } });
  const perPersonMap = new Map<string, { assigned: number; completed: number; overdue: number }>();
  for (const row of perPersonTotals) {
    const bucket = perPersonMap.get(row.userId) ?? { assigned: 0, completed: 0, overdue: 0 };
    bucket.assigned += row._count._all;
    if (row.status === "COMPLETED") bucket.completed += row._count._all;
    if (row.status === "OVERDUE") bucket.overdue += row._count._all;
    perPersonMap.set(row.userId, bucket);
  }
  const teamMembers = await prisma.user.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true }, take: 50 });

  return {
    teamSize: teamIds.length,
    teamCompletionRate: pct(completed, assigned),
    overduePeople: [...overdueByPerson.entries()].map(([id, v]) => ({ id, name: v.name, overdueCount: v.count })).sort((a, b) => b.overdueCount - a.overdueCount).slice(0, 10),
    upcomingDeadlines: upcoming.map((a) => ({ id: a.id, person: a.user.name, title: titleOfAssignment(a), dueAt: a.dueAt as Date })),
    onboarding: newHires.map((u) => {
      const pathAssignment = pathAssignmentByUser.get(u.id);
      const total = pathAssignment?.path?.items.length ?? 0;
      const done = pathAssignment ? (onboardingCompletedByParent.get(pathAssignment.id) ?? 0) : 0;
      return { id: u.id, name: u.name, startDate: u.startDate, percentComplete: pct(done, total) };
    }),
    skillGapCount,
    certificatesExpiring: certificatesExpiring.map((c) => ({ id: c.id, person: c.user.name, course: c.courseTitleSnapshot, expiresAt: c.expiresAt as Date })),
    awaitingSignOff: pendingSignOffs.map((p) => {
      const lesson = lessonById.get(p.lessonId);
      return { lessonId: p.lessonId, lessonTitle: lesson?.title ?? "—", person: p.user.name, courseId: lesson?.section.courseId ?? "" };
    }),
    recentlyCompleted: recentCompletions.map((c) => ({ person: c.user.name, title: c.titleSnapshot, completedAt: c.completedAt })),
    matrixSummary: teamMembers
      .map((u) => {
        const stats = perPersonMap.get(u.id) ?? { assigned: 0, completed: 0, overdue: 0 };
        return { person: u.name, completionRate: pct(stats.completed, stats.assigned), overdueCount: stats.overdue };
      })
      .sort((a, b) => a.completionRate - b.completionRate),
  };
}

// ---------------------------------------------------------------------------
// Admin dashboard
// ---------------------------------------------------------------------------

export interface AdminDashboard {
  overallCompletionRate: number;
  overdueCount: number;
  newHiresOnboarding: number;
  coursePerformance: { courseId: string; title: string; completionRate: number; assigned: number }[];
  quizFailureRate: number;
  topFailingQuizzes: { title: string; value: number; detail: string }[];
  sopReviewStatus: { current: number; dueSoon: number; overdue: number };
  contentHealth: { noOwnerCount: number; brokenLinksCount: number; mostReportedCount: number };
  activityOverTime: { date: string; count: number }[];
  certificatesExpiringCount: number;
  compliance: { activeRules: number; activeExemptions: number; overallCompletionRate: number };
  aiActivity: { questionsAsked: number; searchesPerformed: number; aiJobsQueued: number; aiJobsCompleted: number; aiJobsFailed: number };
}

export async function getAdminDashboard(_actor: Actor): Promise<AdminDashboard> {
  const now = new Date();
  const dueSoonHorizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const newHireSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const expiringHorizon = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const activitySince = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  activitySince.setUTCHours(0, 0, 0, 0);

  const [
    assignmentTotals,
    overdueCount,
    newHiresOnboarding,
    courses,
    quizTotals,
    sopReview,
    contentHealth,
    dailyCompletions,
    certificatesExpiringCount,
    activeRules,
    activeExemptions,
    aiActivity,
  ] = await Promise.all([
    prisma.assignment.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.assignment.count({ where: { OR: [{ status: "OVERDUE" }, { status: { in: ["ASSIGNED", "IN_PROGRESS"] }, dueAt: { lt: now } }] } }),
    prisma.user.count({ where: { startDate: { gte: newHireSince }, status: "ACTIVE" } }),
    prisma.course.findMany({ where: { isDeleted: false, status: "PUBLISHED" }, select: { id: true, title: true }, take: 200 }),
    prisma.quizAttempt.groupBy({ by: ["status"], where: { status: { in: ["PASSED", "FAILED"] } }, _count: { _all: true } }),
    Promise.all([
      prisma.sop.count({ where: { isDeleted: false, status: "PUBLISHED", nextReviewAt: { gt: dueSoonHorizon } } }),
      prisma.sop.count({ where: { isDeleted: false, status: "PUBLISHED", nextReviewAt: { gte: now, lte: dueSoonHorizon } } }),
      prisma.sop.count({ where: { isDeleted: false, status: "PUBLISHED", nextReviewAt: { lt: now } } }),
    ]),
    getContentHealth(5),
    prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT date_trunc('day', "completedAt") AS day, COUNT(*)::bigint AS count
      FROM "CompletionRecord"
      WHERE "completedAt" >= ${activitySince}
      GROUP BY day ORDER BY day ASC
    `,
    prisma.certificate.count({ where: { revokedAt: null, expiresAt: { not: null, lte: expiringHorizon } } }),
    prisma.complianceRule.count({ where: { isActive: true } }),
    prisma.trainingExemption.count({ where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
    getAiActivitySummary(30),
  ]);

  const totalAssigned = assignmentTotals.reduce((sum, r) => sum + r._count._all, 0);
  const totalCompleted = assignmentTotals.find((r) => r.status === "COMPLETED")?._count._all ?? 0;

  const courseIds = courses.map((c) => c.id);
  const [courseAssigned, courseCompleted] = await Promise.all([
    prisma.assignment.groupBy({ by: ["courseId"], where: { courseId: { in: courseIds } }, _count: { _all: true } }),
    prisma.completionRecord.groupBy({ by: ["courseId"], where: { courseId: { in: courseIds } }, _count: { _all: true } }),
  ]);
  const assignedByCourseCount = new Map(courseAssigned.map((c) => [c.courseId as string, c._count._all]));
  const completedByCourseCount = new Map(courseCompleted.map((c) => [c.courseId as string, c._count._all]));
  const coursePerformance = courses
    .map((c) => ({
      courseId: c.id,
      title: c.title,
      assigned: assignedByCourseCount.get(c.id) ?? 0,
      completionRate: pct(completedByCourseCount.get(c.id) ?? 0, assignedByCourseCount.get(c.id) ?? 0),
    }))
    .filter((c) => c.assigned > 0)
    .sort((a, b) => a.completionRate - b.completionRate)
    .slice(0, 8);

  const quizTotal = quizTotals.reduce((sum, r) => sum + r._count._all, 0);
  const quizFailed = quizTotals.find((r) => r.status === "FAILED")?._count._all ?? 0;

  const activityByDay = new Map(dailyCompletions.map((r) => [r.day.toISOString().slice(0, 10), Number(r.count)]));
  const activityOverTime: { date: string; count: number }[] = [];
  for (let i = 0; i < 30; i += 1) {
    const d = new Date(activitySince);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    activityOverTime.push({ date: key, count: activityByDay.get(key) ?? 0 });
  }

  return {
    overallCompletionRate: pct(totalCompleted, totalAssigned),
    overdueCount,
    newHiresOnboarding,
    coursePerformance,
    quizFailureRate: pct(quizFailed, quizTotal),
    topFailingQuizzes: contentHealth.mostFailedQuizzes.map((b) => ({ title: b.title, value: b.value, detail: b.detail })),
    sopReviewStatus: { current: sopReview[0], dueSoon: sopReview[1], overdue: sopReview[2] },
    contentHealth: {
      noOwnerCount: contentHealth.noOwner.length,
      brokenLinksCount: contentHealth.brokenLinks.length,
      mostReportedCount: contentHealth.mostReported.length,
    },
    activityOverTime,
    certificatesExpiringCount,
    compliance: { activeRules, activeExemptions, overallCompletionRate: pct(totalCompleted, totalAssigned) },
    aiActivity,
  };
}
