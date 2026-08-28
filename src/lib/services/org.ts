import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma, TrainingTargetType } from "@prisma/client";
import { type Actor, AuthorizationError, getVisibleUserIds } from "@/lib/auth/guard";
import { recordAudit } from "@/lib/audit";
import { applyPositionRequirements } from "@/lib/services/assignment";
import type { Permission } from "@/lib/permissions";

/**
 * Organization structure CRUD — business units, departments, teams,
 * locations, positions — plus the org chart and position-profile reads that
 * the rest of the platform (assignment rules, the training matrix, the
 * people directory) depends on.
 *
 * Structural entities are never hard-deleted (Users and content reference
 * them by id); "removing" one means toggling `isActive`.
 */

function requirePermission(actor: Actor, permission: Permission): void {
  if (!actor.permissions.has(permission)) throw new AuthorizationError(permission);
}

function asStringArray(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

// ---------------------------------------------------------------------------
// Business units
// ---------------------------------------------------------------------------

export async function listBusinessUnits(actor: Actor) {
  requirePermission(actor, "org.view");
  return prisma.businessUnit.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { departments: true, users: true } } },
  });
}

export interface BusinessUnitInput {
  name: string;
  slug: string;
  description?: string | null;
  isActive?: boolean;
}

export async function createBusinessUnit(actor: Actor, input: BusinessUnitInput) {
  requirePermission(actor, "org.manage");
  const organization = await prisma.organization.findFirst({ select: { id: true } });
  if (!organization) throw new Error("No organization record exists yet.");
  const bu = await prisma.businessUnit.create({
    data: { organizationId: organization.id, name: input.name, slug: input.slug, description: input.description ?? null },
  });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "org.business_unit_created",
    entityType: "BusinessUnit",
    entityId: bu.id,
    metadata: { name: input.name, slug: input.slug },
  });
  return bu;
}

export async function updateBusinessUnit(actor: Actor, id: string, input: Partial<BusinessUnitInput>) {
  requirePermission(actor, "org.manage");
  const bu = await prisma.businessUnit.update({ where: { id }, data: input });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "org.business_unit_updated",
    entityType: "BusinessUnit",
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  return bu;
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

export async function listDepartments(actor: Actor, businessUnitId?: string) {
  requirePermission(actor, "org.view");
  return prisma.department.findMany({
    where: businessUnitId ? { businessUnitId } : undefined,
    orderBy: { name: "asc" },
    include: { businessUnit: { select: { id: true, name: true } }, _count: { select: { teams: true, users: true, positions: true } } },
  });
}

export interface DepartmentInput {
  name: string;
  businessUnitId: string;
  description?: string | null;
  isActive?: boolean;
}

export async function createDepartment(actor: Actor, input: DepartmentInput) {
  requirePermission(actor, "org.manage");
  const department = await prisma.department.create({ data: input });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "org.department_created",
    entityType: "Department",
    entityId: department.id,
    metadata: { name: input.name },
  });
  return department;
}

export async function updateDepartment(actor: Actor, id: string, input: Partial<DepartmentInput>) {
  requirePermission(actor, "org.manage");
  const department = await prisma.department.update({ where: { id }, data: input });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "org.department_updated",
    entityType: "Department",
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  return department;
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export async function listTeams(actor: Actor, departmentId?: string) {
  requirePermission(actor, "org.view");
  return prisma.team.findMany({
    where: departmentId ? { departmentId } : undefined,
    orderBy: { name: "asc" },
    include: { department: { select: { id: true, name: true } }, _count: { select: { users: true } } },
  });
}

export interface TeamInput {
  name: string;
  departmentId: string;
  description?: string | null;
  isActive?: boolean;
}

export async function createTeam(actor: Actor, input: TeamInput) {
  requirePermission(actor, "org.manage");
  const team = await prisma.team.create({ data: input });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "org.team_created",
    entityType: "Team",
    entityId: team.id,
    metadata: { name: input.name },
  });
  return team;
}

export async function updateTeam(actor: Actor, id: string, input: Partial<TeamInput>) {
  requirePermission(actor, "org.manage");
  const team = await prisma.team.update({ where: { id }, data: input });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "org.team_updated",
    entityType: "Team",
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  return team;
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export async function listLocations(actor: Actor) {
  requirePermission(actor, "org.view");
  return prisma.location.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { users: true } } } });
}

export interface LocationInput {
  name: string;
  country: string;
  state?: string | null;
  city?: string | null;
  timezone?: string;
  isActive?: boolean;
}

export async function createLocation(actor: Actor, input: LocationInput) {
  requirePermission(actor, "org.manage");
  const location = await prisma.location.create({ data: input });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "org.location_created",
    entityType: "Location",
    entityId: location.id,
    metadata: { name: input.name, country: input.country },
  });
  return location;
}

export async function updateLocation(actor: Actor, id: string, input: Partial<LocationInput>) {
  requirePermission(actor, "org.manage");
  const location = await prisma.location.update({ where: { id }, data: input });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "org.location_updated",
    entityType: "Location",
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  return location;
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

export async function listPositions(actor: Actor, departmentId?: string) {
  requirePermission(actor, "org.view");
  return prisma.position.findMany({
    where: departmentId ? { departmentId } : undefined,
    orderBy: { title: "asc" },
    include: {
      department: { select: { id: true, name: true } },
      _count: { select: { users: true, skillRequirements: true, trainingRequirements: true } },
    },
  });
}

export interface PositionInput {
  title: string;
  departmentId?: string | null;
  description?: string | null;
  responsibilities?: string[];
  toolsUsed?: string[];
  isActive?: boolean;
}

export async function createPosition(actor: Actor, input: PositionInput) {
  requirePermission(actor, "org.manage");
  const position = await prisma.position.create({
    data: {
      title: input.title,
      departmentId: input.departmentId ?? null,
      description: input.description ?? null,
      responsibilities: (input.responsibilities ?? []) as Prisma.InputJsonValue,
      toolsUsed: (input.toolsUsed ?? []) as Prisma.InputJsonValue,
    },
  });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "org.position_created",
    entityType: "Position",
    entityId: position.id,
    metadata: { title: input.title },
  });
  return position;
}

export async function updatePosition(actor: Actor, id: string, input: Partial<PositionInput>) {
  requirePermission(actor, "org.manage");
  const data: Prisma.PositionUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.departmentId !== undefined) {
    data.department = input.departmentId ? { connect: { id: input.departmentId } } : { disconnect: true };
  }
  if (input.responsibilities !== undefined) data.responsibilities = input.responsibilities as Prisma.InputJsonValue;
  if (input.toolsUsed !== undefined) data.toolsUsed = input.toolsUsed as Prisma.InputJsonValue;

  const position = await prisma.position.update({ where: { id }, data });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "org.position_updated",
    entityType: "Position",
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  return position;
}

export interface SkillRequirementInput {
  skillId: string;
  requiredLevel: number;
  required?: boolean;
}

/** Replaces the full skill requirement set for a position. */
export async function setPositionSkillRequirements(
  actor: Actor,
  positionId: string,
  requirements: SkillRequirementInput[],
): Promise<void> {
  requirePermission(actor, "org.manage");
  await prisma.$transaction([
    prisma.positionSkillRequirement.deleteMany({ where: { positionId } }),
    prisma.positionSkillRequirement.createMany({
      data: requirements.map((r) => ({
        positionId,
        skillId: r.skillId,
        requiredLevel: r.requiredLevel,
        required: r.required ?? true,
      })),
    }),
  ]);
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "org.position_skills_updated",
    entityType: "Position",
    entityId: positionId,
    metadata: { count: requirements.length },
  });
}

export interface TrainingRequirementInput {
  targetType: TrainingTargetType;
  courseId?: string | null;
  sopId?: string | null;
  pathId?: string | null;
  required?: boolean;
}

/**
 * Replaces the full training requirement set for a position, then applies
 * the new requirements to every active person already holding it.
 */
export async function setPositionTrainingRequirements(
  actor: Actor,
  positionId: string,
  requirements: TrainingRequirementInput[],
): Promise<void> {
  requirePermission(actor, "org.manage");
  await prisma.$transaction([
    prisma.positionTrainingRequirement.deleteMany({ where: { positionId } }),
    prisma.positionTrainingRequirement.createMany({
      data: requirements.map((r) => ({
        positionId,
        targetType: r.targetType,
        courseId: r.courseId ?? null,
        sopId: r.sopId ?? null,
        pathId: r.pathId ?? null,
        required: r.required ?? true,
      })),
    }),
  ]);
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "org.position_training_updated",
    entityType: "Position",
    entityId: positionId,
    metadata: { count: requirements.length },
  });

  const holders = await prisma.user.findMany({ where: { positionId, status: "ACTIVE" }, select: { id: true } });
  for (const holder of holders) {
    await applyPositionRequirements(holder.id);
  }
}

export interface PositionProfile {
  id: string;
  title: string;
  description: string | null;
  isActive: boolean;
  headcount: number;
  department: { id: string; name: string; businessUnitName: string | null } | null;
  responsibilities: string[];
  toolsUsed: string[];
  skillRequirements: { skillId: string; name: string; category: string | null; requiredLevel: number; required: boolean }[];
  trainingRequirements: {
    id: string;
    targetType: TrainingTargetType;
    courseId: string | null;
    sopId: string | null;
    pathId: string | null;
    title: string;
    required: boolean;
  }[];
}

export async function getPositionProfile(actor: Actor, positionId: string): Promise<PositionProfile> {
  requirePermission(actor, "org.view");

  const [position, headcount] = await Promise.all([
    prisma.position.findUnique({
      where: { id: positionId },
      include: {
        department: { include: { businessUnit: { select: { name: true } } } },
        skillRequirements: { include: { skill: { select: { name: true, category: true } } } },
        trainingRequirements: {
          include: {
            course: { select: { title: true } },
            sop: { select: { title: true } },
            path: { select: { title: true } },
          },
        },
      },
    }),
    prisma.user.count({ where: { positionId, status: "ACTIVE" } }),
  ]);
  if (!position) throw new Error("That position no longer exists.");

  return {
    id: position.id,
    title: position.title,
    description: position.description,
    isActive: position.isActive,
    headcount,
    department: position.department
      ? { id: position.department.id, name: position.department.name, businessUnitName: position.department.businessUnit?.name ?? null }
      : null,
    responsibilities: asStringArray(position.responsibilities),
    toolsUsed: asStringArray(position.toolsUsed),
    skillRequirements: position.skillRequirements.map((r) => ({
      skillId: r.skillId,
      name: r.skill.name,
      category: r.skill.category,
      requiredLevel: r.requiredLevel,
      required: r.required,
    })),
    trainingRequirements: position.trainingRequirements.map((r) => ({
      id: r.id,
      targetType: r.targetType,
      courseId: r.courseId,
      sopId: r.sopId,
      pathId: r.pathId,
      title: r.course?.title ?? r.sop?.title ?? r.path?.title ?? "Untitled training",
      required: r.required,
    })),
  };
}

// ---------------------------------------------------------------------------
// Org chart
// ---------------------------------------------------------------------------

export interface OrgChartNode {
  id: string;
  name: string;
  title: string | null;
  image: string | null;
  departmentName: string | null;
  directReportCount: number;
  children: OrgChartNode[];
}

/** Reporting tree scoped to whatever the actor may see (see getVisibleUserIds). */
export async function getOrgChart(actor: Actor): Promise<OrgChartNode[]> {
  requirePermission(actor, "org.view");

  const visible = await getVisibleUserIds(actor);
  const where: Prisma.UserWhereInput = { status: { not: "INACTIVE" } };
  if (visible !== "ALL") where.id = { in: visible };

  const users = await prisma.user.findMany({
    where,
    select: { id: true, name: true, title: true, image: true, managerId: true, department: { select: { name: true } } },
    orderBy: { name: "asc" },
  });

  const byId = new Map<string, OrgChartNode>(
    users.map((u) => [
      u.id,
      {
        id: u.id,
        name: u.name,
        title: u.title,
        image: u.image,
        departmentName: u.department?.name ?? null,
        directReportCount: 0,
        children: [],
      },
    ]),
  );

  const roots: OrgChartNode[] = [];
  for (const u of users) {
    const node = byId.get(u.id);
    if (!node) continue;
    const parent = u.managerId ? byId.get(u.managerId) : undefined;
    if (parent) {
      parent.children.push(node);
      parent.directReportCount += 1;
    } else {
      roots.push(node);
    }
  }

  return roots;
}
