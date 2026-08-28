import "server-only";
import { prisma } from "@/lib/db";
import type { PracticalRating } from "@prisma/client";
import { type Actor, AuthorizationError, canManageUser, canViewUser } from "@/lib/auth/guard";
import { recordAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import type { Permission } from "@/lib/permissions";

/** Skills library, proficiency scale, practical assessment, and gap analysis. */

function requirePermission(actor: Actor, permission: Permission): void {
  if (!actor.permissions.has(permission)) throw new AuthorizationError(permission);
}

// ---------------------------------------------------------------------------
// Skills library CRUD
// ---------------------------------------------------------------------------

export async function listSkills(actor: Actor, filters: { category?: string; q?: string } = {}) {
  requirePermission(actor, "skills.view");
  return prisma.skill.findMany({
    where: {
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.q ? { name: { contains: filters.q, mode: "insensitive" } } : {}),
    },
    orderBy: { name: "asc" },
  });
}

export async function getSkill(actor: Actor, id: string) {
  requirePermission(actor, "skills.view");
  const skill = await prisma.skill.findUnique({
    where: { id },
    include: {
      courses: { include: { course: { select: { id: true, title: true, status: true } } } },
      requirements: { include: { position: { select: { id: true, title: true } } } },
    },
  });
  if (!skill) throw new Error("That skill no longer exists.");
  return skill;
}

export interface SkillInput {
  name: string;
  description?: string | null;
  category?: string | null;
  isActive?: boolean;
}

export async function createSkill(actor: Actor, input: SkillInput) {
  requirePermission(actor, "skills.manage");
  const skill = await prisma.skill.create({ data: input });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "skills.skill_created",
    entityType: "Skill",
    entityId: skill.id,
    metadata: { name: input.name },
  });
  return skill;
}

export async function updateSkill(actor: Actor, id: string, input: Partial<SkillInput>) {
  requirePermission(actor, "skills.manage");
  const skill = await prisma.skill.update({ where: { id }, data: input });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "skills.skill_updated",
    entityType: "Skill",
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  return skill;
}

// ---------------------------------------------------------------------------
// Proficiency scale
// ---------------------------------------------------------------------------

export async function listSkillLevels(actor: Actor) {
  requirePermission(actor, "skills.view");
  return prisma.skillLevel.findMany({ orderBy: { value: "asc" } });
}

export async function upsertSkillLevel(actor: Actor, value: number, name: string) {
  requirePermission(actor, "skills.manage");
  const level = await prisma.skillLevel.upsert({ where: { value }, create: { value, name }, update: { name } });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "skills.level_scale_updated",
    entityType: "SkillLevel",
    entityId: level.id,
    metadata: { value, name },
  });
  return level;
}

export async function deleteSkillLevel(actor: Actor, value: number): Promise<void> {
  requirePermission(actor, "skills.manage");
  await prisma.skillLevel.delete({ where: { value } });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "skills.level_scale_updated",
    entityType: "SkillLevel",
    metadata: { removedValue: value },
  });
}

// ---------------------------------------------------------------------------
// Skill grants and assessments
// ---------------------------------------------------------------------------

/**
 * Applies a completed course's CourseSkill levels to the learner, never
 * lowering a level they already hold. Called by the completion service.
 */
export async function grantSkillFromTraining(userId: string, courseId: string): Promise<void> {
  const courseSkills = await prisma.courseSkill.findMany({
    where: { courseId, levelValue: { not: null } },
    select: { skillId: true, levelValue: true },
  });

  for (const cs of courseSkills) {
    if (cs.levelValue == null) continue;
    const existing = await prisma.userSkill.findUnique({ where: { userId_skillId: { userId, skillId: cs.skillId } } });
    if (existing && existing.level >= cs.levelValue) continue;
    await prisma.userSkill.upsert({
      where: { userId_skillId: { userId, skillId: cs.skillId } },
      create: { userId, skillId: cs.skillId, level: cs.levelValue, source: "TRAINING" },
      update: { level: cs.levelValue, source: "TRAINING" },
    });
  }
}

const RATING_TO_LEVEL: Partial<Record<PracticalRating, number>> = {
  NEEDS_COACHING: 2,
  COMPETENT: 4,
  HIGHLY_COMPETENT: 5,
  // NOT_DEMONSTRATED intentionally omitted — the learner keeps their current level.
};

export interface AssessSkillInput {
  userId: string;
  skillId: string;
  lessonId?: string | null;
  courseId?: string | null;
  rating: PracticalRating;
  comments?: string | null;
  attachmentMediaId?: string | null;
  reassessAt?: Date | null;
}

/** Records a practical sign-off and maps the rating onto the learner's UserSkill level. */
export async function assessSkill(actor: Actor, input: AssessSkillInput): Promise<{ id: string }> {
  requirePermission(actor, "skills.assess");
  const allowed = await canManageUser(actor, input.userId);
  if (!allowed) throw new AuthorizationError("skills.assess");

  const assessment = await prisma.skillAssessment.create({
    data: {
      userId: input.userId,
      assessorId: actor.id,
      skillId: input.skillId,
      lessonId: input.lessonId ?? null,
      courseId: input.courseId ?? null,
      rating: input.rating,
      comments: input.comments ?? null,
      attachmentMediaId: input.attachmentMediaId ?? null,
      reassessAt: input.reassessAt ?? null,
    },
  });

  const newLevel = RATING_TO_LEVEL[input.rating];
  if (newLevel !== undefined) {
    await prisma.userSkill.upsert({
      where: { userId_skillId: { userId: input.userId, skillId: input.skillId } },
      create: {
        userId: input.userId,
        skillId: input.skillId,
        level: newLevel,
        source: "MANAGER_ASSESSMENT",
        verifiedById: actor.id,
        evidence: input.comments ?? null,
      },
      update: { level: newLevel, source: "MANAGER_ASSESSMENT", verifiedById: actor.id, evidence: input.comments ?? null },
    });
  }

  const skill = await prisma.skill.findUnique({ where: { id: input.skillId }, select: { name: true } });
  await notify({
    userId: input.userId,
    type: "SYSTEM",
    title: `Skill assessed: ${skill?.name ?? "Skill"}`,
    body: `${actor.name} rated you "${input.rating.replace(/_/g, " ").toLowerCase()}"${skill ? ` on ${skill.name}` : ""}.`,
    linkUrl: "/skills",
    dedupeKey: `assessment:${assessment.id}`,
  });

  return { id: assessment.id };
}

// ---------------------------------------------------------------------------
// Gap analysis
// ---------------------------------------------------------------------------

export interface SkillGap {
  skillId: string;
  name: string;
  category: string | null;
  requiredLevel: number;
  currentLevel: number;
  gap: number;
  howToClose: { courseId: string; title: string }[];
}

/** Compares a person's position requirements against what they've demonstrated. */
export async function getSkillGaps(actor: Actor, userId: string): Promise<SkillGap[]> {
  requirePermission(actor, "skills.view");
  const allowed = await canViewUser(actor, userId);
  if (!allowed) throw new AuthorizationError("skills.view");

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { positionId: true } });
  if (!user?.positionId) return [];

  const [requirements, userSkills] = await Promise.all([
    prisma.positionSkillRequirement.findMany({
      where: { positionId: user.positionId },
      include: { skill: { select: { name: true, category: true } } },
    }),
    prisma.userSkill.findMany({ where: { userId } }),
  ]);

  const currentBySkill = new Map(userSkills.map((s) => [s.skillId, s.level]));
  const gaps = requirements
    .map((r) => ({ requirement: r, current: currentBySkill.get(r.skillId) ?? 0 }))
    .filter(({ requirement, current }) => current < requirement.requiredLevel);

  if (gaps.length === 0) return [];

  const skillIds = gaps.map((g) => g.requirement.skillId);
  const courseSkills = await prisma.courseSkill.findMany({
    where: { skillId: { in: skillIds }, course: { status: "PUBLISHED" } },
    include: { course: { select: { id: true, title: true } } },
  });
  const coursesBySkill = new Map<string, { courseId: string; title: string }[]>();
  for (const cs of courseSkills) {
    const list = coursesBySkill.get(cs.skillId) ?? [];
    list.push({ courseId: cs.course.id, title: cs.course.title });
    coursesBySkill.set(cs.skillId, list);
  }

  return gaps.map(({ requirement, current }) => ({
    skillId: requirement.skillId,
    name: requirement.skill.name,
    category: requirement.skill.category,
    requiredLevel: requirement.requiredLevel,
    currentLevel: current,
    gap: requirement.requiredLevel - current,
    howToClose: coursesBySkill.get(requirement.skillId) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Team skill matrix
// ---------------------------------------------------------------------------

export interface TeamSkillMatrixCell {
  level: number;
  requiredLevel: number | null;
  gap: boolean;
}

export interface TeamSkillMatrix {
  people: { id: string; name: string; image: string | null }[];
  skills: { id: string; name: string; category: string | null }[];
  cells: Record<string, Record<string, TeamSkillMatrixCell | null>>;
}

export async function getTeamSkillMatrix(actor: Actor, managerId: string): Promise<TeamSkillMatrix> {
  requirePermission(actor, "skills.view");
  if (actor.id !== managerId) {
    const canSee = await canViewUser(actor, managerId);
    if (!canSee) throw new AuthorizationError("team.view");
  }

  const reports = await prisma.user.findMany({
    where: { managerId, status: "ACTIVE" },
    select: { id: true, name: true, image: true, positionId: true },
    orderBy: { name: "asc" },
  });
  if (reports.length === 0) return { people: [], skills: [], cells: {} };

  const userIds = reports.map((r) => r.id);
  const positionIds = [...new Set(reports.map((r) => r.positionId).filter((v): v is string => Boolean(v)))];

  const [userSkills, requirements] = await Promise.all([
    prisma.userSkill.findMany({ where: { userId: { in: userIds } } }),
    prisma.positionSkillRequirement.findMany({ where: { positionId: { in: positionIds } } }),
  ]);

  const skillIdSet = new Set<string>([...requirements.map((r) => r.skillId), ...userSkills.map((s) => s.skillId)]);
  const skills = await prisma.skill.findMany({
    where: { id: { in: [...skillIdSet] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, category: true },
  });

  const requirementByPositionSkill = new Map(requirements.map((r) => [`${r.positionId}:${r.skillId}`, r.requiredLevel]));
  const levelByUserSkill = new Map(userSkills.map((s) => [`${s.userId}:${s.skillId}`, s.level]));

  const cells: TeamSkillMatrix["cells"] = {};
  for (const report of reports) {
    const row: Record<string, TeamSkillMatrixCell | null> = {};
    for (const skill of skills) {
      const level = levelByUserSkill.get(`${report.id}:${skill.id}`) ?? null;
      const requiredLevel = report.positionId
        ? (requirementByPositionSkill.get(`${report.positionId}:${skill.id}`) ?? null)
        : null;
      row[skill.id] =
        level === null && requiredLevel === null
          ? null
          : { level: level ?? 0, requiredLevel, gap: requiredLevel !== null && (level ?? 0) < requiredLevel };
    }
    cells[report.id] = row;
  }

  return { people: reports.map((r) => ({ id: r.id, name: r.name, image: r.image })), skills, cells };
}
