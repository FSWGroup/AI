import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma, WorkerType } from "@prisma/client";
import {
  type Actor,
  AuthorizationError,
  canManageUser,
  canViewUser,
  getVisibleUserIds,
} from "@/lib/auth/guard";
import { decryptField, encryptField } from "@/lib/crypto";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { ROLE_KEYS } from "@/lib/permissions";
import {
  applyPositionRequirements,
  evaluateRulesForUser,
  handleProfileChange,
  type ProfileChangeResult,
  type ProfileSnapshot,
} from "@/lib/services/assignment";

/**
 * People directory and lifecycle service.
 *
 * Visibility is always delegated to `getVisibleUserIds`/`canViewUser` from
 * `@/lib/auth/guard` — per CONVENTIONS.md, a plain learner sees only
 * themselves, a manager sees their reporting subtree, and only actors with
 * org-wide reporting access see everyone. This module never re-implements
 * that scoping.
 */

const PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Directory listing
// ---------------------------------------------------------------------------

export interface PeopleFilters {
  q?: string;
  departmentId?: string;
  businessUnitId?: string;
  teamId?: string;
  positionId?: string;
  locationId?: string;
  managerId?: string;
  workerType?: string;
  country?: string;
  status?: string;
}

export interface PersonListItem {
  id: string;
  name: string;
  email: string;
  image: string | null;
  title: string | null;
  workerType: string;
  status: string;
  country: string;
  departmentName: string | null;
  teamName: string | null;
  businessUnitName: string | null;
  locationName: string | null;
  managerId: string | null;
  managerName: string | null;
}

export interface PeoplePage {
  people: PersonListItem[];
  total: number;
  page: number;
  pageSize: number;
}

function requirePermission(actor: Actor, permission: Parameters<Actor["permissions"]["has"]>[0]): void {
  if (!actor.permissions.has(permission)) throw new AuthorizationError(permission);
}

export async function listPeople(actor: Actor, filters: PeopleFilters, page = 1): Promise<PeoplePage> {
  requirePermission(actor, "people.view");

  const visible = await getVisibleUserIds(actor);
  const where: Prisma.UserWhereInput = {};
  if (visible !== "ALL") where.id = { in: visible };
  if (filters.q) {
    const q = filters.q.trim();
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { employeeId: { contains: q, mode: "insensitive" } },
      ];
    }
  }
  if (filters.departmentId) where.departmentId = filters.departmentId;
  if (filters.businessUnitId) where.businessUnitId = filters.businessUnitId;
  if (filters.teamId) where.teamId = filters.teamId;
  if (filters.positionId) where.positionId = filters.positionId;
  if (filters.locationId) where.locationId = filters.locationId;
  if (filters.managerId) where.managerId = filters.managerId;
  if (filters.workerType) where.workerType = filters.workerType as WorkerType;
  if (filters.country) where.country = filters.country;
  if (filters.status) where.status = filters.status as Prisma.UserWhereInput["status"];

  const pageNumber = Math.max(1, Math.floor(page));
  const skip = (pageNumber - 1) * PAGE_SIZE;

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { name: "asc" },
      skip,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        title: true,
        workerType: true,
        status: true,
        country: true,
        managerId: true,
        department: { select: { name: true } },
        team: { select: { name: true } },
        businessUnit: { select: { name: true } },
        location: { select: { name: true } },
        manager: { select: { name: true } },
      },
    }),
  ]);

  return {
    people: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      image: row.image,
      title: row.title,
      workerType: row.workerType,
      status: row.status,
      country: row.country,
      departmentName: row.department?.name ?? null,
      teamName: row.team?.name ?? null,
      businessUnitName: row.businessUnit?.name ?? null,
      locationName: row.location?.name ?? null,
      managerId: row.managerId,
      managerName: row.manager?.name ?? null,
    })),
    total,
    page: pageNumber,
    pageSize: PAGE_SIZE,
  };
}

/**
 * A manager's full reporting subtree (direct and indirect reports), excluding
 * the manager themselves. Used by the /team/* dashboards, which are always
 * scoped to "my team" specifically rather than the broader visibility rules
 * in getVisibleUserIds (which also cover org-wide reporting access).
 */
export async function getTeamMemberIds(managerId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree AS (
      SELECT "id" FROM "User" WHERE "managerId" = ${managerId}
      UNION
      SELECT u."id" FROM "User" u
      INNER JOIN subtree s ON u."managerId" = s."id"
    )
    SELECT "id" FROM subtree
  `;
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export interface PersonProfile {
  id: string;
  email: string;
  name: string;
  legalName: string | null;
  image: string | null;
  title: string | null;
  personalEmail: string | null;
  workPhone: string | null;
  mobilePhone: string | null;
  employeeId: string | null;
  status: string;
  workerType: string;
  country: string;
  state: string | null;
  timezone: string;
  language: string;
  startDate: Date | null;
  deactivatedAt: Date | null;
  businessUnit: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  position: { id: string; title: string } | null;
  location: { id: string; name: string; timezone: string } | null;
  manager: { id: string; name: string; title: string | null; image: string | null } | null;
  reports: { id: string; name: string; title: string | null; image: string | null; status: string }[];
  roles: { key: string; name: string }[];
  skills: { skillId: string; name: string; category: string | null; level: number; levelName: string; source: string }[];
  certificates: { id: string; certificateNumber: string; courseTitleSnapshot: string; issuedAt: Date; expiresAt: Date | null }[];
  assignmentSummary: {
    total: number;
    assigned: number;
    inProgress: number;
    completed: number;
    overdue: number;
    waived: number;
    expired: number;
  };
}

export async function getPerson(actor: Actor, userId: string): Promise<PersonProfile> {
  const allowed = await canViewUser(actor, userId);
  if (!allowed) throw new AuthorizationError("people.view");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      businessUnit: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
      position: { select: { id: true, title: true } },
      location: { select: { id: true, name: true, timezone: true } },
      manager: { select: { id: true, name: true, title: true, image: true } },
    },
  });
  if (!user) throw new Error("That person no longer exists.");

  const [reports, roleLinks, userSkills, skillLevels, certificates, grouped] = await Promise.all([
    prisma.user.findMany({
      where: { managerId: userId },
      select: { id: true, name: true, title: true, image: true, status: true },
      orderBy: { name: "asc" },
    }),
    prisma.userRole.findMany({ where: { userId }, include: { role: { select: { key: true, name: true } } } }),
    prisma.userSkill.findMany({
      where: { userId },
      include: { skill: { select: { name: true, category: true } } },
    }),
    prisma.skillLevel.findMany(),
    prisma.certificate.findMany({
      where: { userId, revokedAt: null },
      orderBy: { issuedAt: "desc" },
      select: { id: true, certificateNumber: true, courseTitleSnapshot: true, issuedAt: true, expiresAt: true },
    }),
    prisma.assignment.groupBy({ by: ["status"], where: { userId }, _count: { _all: true } }),
  ]);

  const levelNameByValue = new Map(skillLevels.map((l) => [l.value, l.name]));
  const assignmentSummary = {
    total: 0,
    assigned: 0,
    inProgress: 0,
    completed: 0,
    overdue: 0,
    waived: 0,
    expired: 0,
  };
  for (const g of grouped) {
    assignmentSummary.total += g._count._all;
    if (g.status === "ASSIGNED") assignmentSummary.assigned = g._count._all;
    else if (g.status === "IN_PROGRESS") assignmentSummary.inProgress = g._count._all;
    else if (g.status === "COMPLETED") assignmentSummary.completed = g._count._all;
    else if (g.status === "OVERDUE") assignmentSummary.overdue = g._count._all;
    else if (g.status === "WAIVED") assignmentSummary.waived = g._count._all;
    else if (g.status === "EXPIRED") assignmentSummary.expired = g._count._all;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    legalName: user.legalName,
    image: user.image,
    title: user.title,
    personalEmail: user.personalEmail,
    workPhone: user.workPhone,
    mobilePhone: user.mobilePhone,
    employeeId: user.employeeId,
    status: user.status,
    workerType: user.workerType,
    country: user.country,
    state: user.state,
    timezone: user.timezone,
    language: user.language,
    startDate: user.startDate,
    deactivatedAt: user.deactivatedAt,
    businessUnit: user.businessUnit,
    department: user.department,
    team: user.team,
    position: user.position,
    location: user.location,
    manager: user.manager,
    reports,
    roles: roleLinks.map((r) => ({ key: r.role.key, name: r.role.name })),
    skills: userSkills.map((s) => ({
      skillId: s.skillId,
      name: s.skill.name,
      category: s.skill.category,
      level: s.level,
      levelName: levelNameByValue.get(s.level) ?? String(s.level),
      source: s.source,
    })),
    certificates,
    assignmentSummary,
  };
}

// ---------------------------------------------------------------------------
// Sensitive fields
// ---------------------------------------------------------------------------

export interface SensitiveFieldValue {
  fieldKey: string;
  label: string;
  value: string;
  updatedAt: Date;
  updatedBy: string;
}

/** Reads and decrypts a person's sensitive fields. Always audited, every call. */
export async function getSensitiveFields(actor: Actor, userId: string): Promise<SensitiveFieldValue[]> {
  requirePermission(actor, "people.sensitive_view");
  const allowed = await canViewUser(actor, userId);
  if (!allowed) throw new AuthorizationError("people.sensitive_view");

  const [fields, definitions] = await Promise.all([
    prisma.sensitiveField.findMany({ where: { userId } }),
    prisma.sensitiveFieldDefinition.findMany(),
  ]);
  const defByKey = new Map(definitions.map((d) => [d.fieldKey, d]));

  const result = fields.map((f) => ({
    fieldKey: f.fieldKey,
    label: defByKey.get(f.fieldKey)?.label ?? f.fieldKey,
    value: decryptField(f.ciphertext),
    updatedAt: f.updatedAt,
    updatedBy: f.updatedBy,
  }));

  // Audited unconditionally — even when the person has no sensitive fields set,
  // the read attempt itself is the event of record.
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.SENSITIVE_VIEWED,
    entityType: "User",
    entityId: userId,
    metadata: { fieldKeys: fields.map((f) => f.fieldKey) },
  });

  return result;
}

export async function setSensitiveField(
  actor: Actor,
  userId: string,
  fieldKey: string,
  value: string,
): Promise<void> {
  requirePermission(actor, "people.sensitive_edit");
  const allowed = await canViewUser(actor, userId);
  if (!allowed) throw new AuthorizationError("people.sensitive_edit");

  const ciphertext = encryptField(value);
  await prisma.sensitiveField.upsert({
    where: { userId_fieldKey: { userId, fieldKey } },
    create: { userId, fieldKey, ciphertext, updatedBy: actor.id },
    update: { ciphertext, updatedBy: actor.id },
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.SENSITIVE_UPDATED,
    entityType: "User",
    entityId: userId,
    metadata: { fieldKey },
  });
}

// ---------------------------------------------------------------------------
// Create / update / roles
// ---------------------------------------------------------------------------

export interface CreatePersonInput {
  email: string;
  name: string;
  title?: string | null;
  employeeId?: string | null;
  workerType: WorkerType;
  country: string;
  state?: string | null;
  timezone?: string;
  language?: string;
  businessUnitId?: string | null;
  departmentId?: string | null;
  teamId?: string | null;
  positionId?: string | null;
  locationId?: string | null;
  managerId?: string | null;
  startDate?: Date | null;
}

function isContractorWorkerType(workerType: string): boolean {
  return workerType.endsWith("_CONTRACTOR");
}

async function createPersonRecord(input: CreatePersonInput): Promise<{ id: string }> {
  const roleKeys: string[] = [ROLE_KEYS.LEARNER];
  if (isContractorWorkerType(input.workerType)) roleKeys.push(ROLE_KEYS.CONTRACTOR);
  const roles = await prisma.role.findMany({ where: { key: { in: roleKeys } }, select: { id: true } });

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      title: input.title ?? null,
      employeeId: input.employeeId ?? null,
      workerType: input.workerType,
      country: input.country,
      state: input.state ?? null,
      timezone: input.timezone ?? "America/New_York",
      language: input.language ?? "en",
      businessUnitId: input.businessUnitId ?? null,
      departmentId: input.departmentId ?? null,
      teamId: input.teamId ?? null,
      positionId: input.positionId ?? null,
      locationId: input.locationId ?? null,
      managerId: input.managerId ?? null,
      startDate: input.startDate ?? null,
      trainingStartDate: input.startDate ?? null,
      status: "ACTIVE",
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
    },
    select: { id: true },
  });

  await evaluateRulesForUser(user.id);
  await applyPositionRequirements(user.id);
  return user;
}

export async function createPerson(actor: Actor, input: CreatePersonInput): Promise<{ id: string }> {
  requirePermission(actor, "people.edit");
  const user = await createPersonRecord(input);
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.PERSON_CREATED,
    entityType: "User",
    entityId: user.id,
    metadata: { email: input.email, workerType: input.workerType },
  });
  return user;
}

export interface UpdatePersonInput {
  name?: string;
  title?: string | null;
  legalName?: string | null;
  personalEmail?: string | null;
  workPhone?: string | null;
  mobilePhone?: string | null;
  employeeId?: string | null;
  workerType?: WorkerType;
  country?: string;
  state?: string | null;
  timezone?: string;
  language?: string;
  businessUnitId?: string | null;
  departmentId?: string | null;
  teamId?: string | null;
  positionId?: string | null;
  locationId?: string | null;
  managerId?: string | null;
  startDate?: Date | null;
}

const PROFILE_SNAPSHOT_SELECT = {
  positionId: true,
  departmentId: true,
  workerType: true,
  locationId: true,
  country: true,
  businessUnitId: true,
  teamId: true,
} satisfies Prisma.UserSelect;

export async function updatePerson(
  actor: Actor,
  userId: string,
  input: UpdatePersonInput,
): Promise<ProfileChangeResult | null> {
  requirePermission(actor, "people.edit");

  const before = await prisma.user.findUnique({ where: { id: userId }, select: PROFILE_SNAPSHOT_SELECT });
  if (!before) throw new Error("That person no longer exists.");

  const data: Prisma.UserUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.title !== undefined) data.title = input.title;
  if (input.legalName !== undefined) data.legalName = input.legalName;
  if (input.personalEmail !== undefined) data.personalEmail = input.personalEmail;
  if (input.workPhone !== undefined) data.workPhone = input.workPhone;
  if (input.mobilePhone !== undefined) data.mobilePhone = input.mobilePhone;
  if (input.employeeId !== undefined) data.employeeId = input.employeeId;
  if (input.workerType !== undefined) data.workerType = input.workerType;
  if (input.country !== undefined) data.country = input.country;
  if (input.state !== undefined) data.state = input.state;
  if (input.timezone !== undefined) data.timezone = input.timezone;
  if (input.language !== undefined) data.language = input.language;
  if (input.startDate !== undefined) data.startDate = input.startDate;
  if (input.businessUnitId !== undefined) {
    data.businessUnit = input.businessUnitId ? { connect: { id: input.businessUnitId } } : { disconnect: true };
  }
  if (input.departmentId !== undefined) {
    data.department = input.departmentId ? { connect: { id: input.departmentId } } : { disconnect: true };
  }
  if (input.teamId !== undefined) {
    data.team = input.teamId ? { connect: { id: input.teamId } } : { disconnect: true };
  }
  if (input.positionId !== undefined) {
    data.position = input.positionId ? { connect: { id: input.positionId } } : { disconnect: true };
  }
  if (input.locationId !== undefined) {
    data.location = input.locationId ? { connect: { id: input.locationId } } : { disconnect: true };
  }
  if (input.managerId !== undefined) {
    data.manager = input.managerId ? { connect: { id: input.managerId } } : { disconnect: true };
  }

  await prisma.user.update({ where: { id: userId }, data });
  const after = await prisma.user.findUnique({ where: { id: userId }, select: PROFILE_SNAPSHOT_SELECT });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.PERSON_UPDATED,
    entityType: "User",
    entityId: userId,
    metadata: { fields: Object.keys(input) },
  });

  if (!after) return null;
  return handleProfileChange(userId, before as ProfileSnapshot, after as ProfileSnapshot);
}

export async function setUserRoles(actor: Actor, userId: string, roleKeys: string[]): Promise<void> {
  requirePermission(actor, "people.edit");

  const [before, roles] = await Promise.all([
    prisma.userRole.findMany({ where: { userId }, select: { role: { select: { key: true } } } }),
    prisma.role.findMany({ where: { key: { in: roleKeys } }, select: { id: true, key: true } }),
  ]);

  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId } }),
    prisma.userRole.createMany({ data: roles.map((r) => ({ userId, roleId: r.id })) }),
  ]);

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.ROLE_CHANGED,
    entityType: "User",
    entityId: userId,
    metadata: { before: before.map((b) => b.role.key), after: roles.map((r) => r.key) },
  });
}

// ---------------------------------------------------------------------------
// Offboarding
// ---------------------------------------------------------------------------

export interface DeactivateOptions {
  reason?: string;
}

export interface OwnedContentItem {
  type: "course" | "sop" | "path";
  id: string;
  title: string;
}

export interface PendingApprovalItem {
  id: string;
  entityType: string;
  entityId: string;
  stage: string;
}

export interface DeactivateResult {
  ownedContent: OwnedContentItem[];
  pendingApprovals: PendingApprovalItem[];
}

/**
 * Offboard a person. Never destroys evidence: the transcript
 * (CompletionRecord/Acknowledgement/Certificate) is untouched, active
 * assignments are waived (not deleted) so the record of what was outstanding
 * survives, and the caller gets back what needs reassignment elsewhere.
 */
export async function deactivatePerson(
  actor: Actor,
  userId: string,
  opts: DeactivateOptions = {},
): Promise<DeactivateResult> {
  requirePermission(actor, "people.deactivate");

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new Error("That person no longer exists.");

  const [ownedCourses, ownedSops, ownedPaths, pendingApprovals] = await Promise.all([
    prisma.course.findMany({ where: { ownerId: userId, isDeleted: false }, select: { id: true, title: true } }),
    prisma.sop.findMany({ where: { ownerId: userId, isDeleted: false }, select: { id: true, title: true } }),
    prisma.learningPath.findMany({ where: { ownerId: userId, isDeleted: false }, select: { id: true, title: true } }),
    prisma.approvalRequest.findMany({
      where: { assignedToId: userId, status: "PENDING" },
      select: { id: true, entityType: true, entityId: true, stage: true },
    }),
  ]);

  const reason = opts.reason ?? "Person deactivated";

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { status: "INACTIVE", deactivatedAt: new Date() } }),
    prisma.assignment.updateMany({
      where: { userId, status: { in: ["ASSIGNED", "IN_PROGRESS"] } },
      data: { status: "WAIVED", waivedAt: new Date(), waivedById: actor.id, waivedReason: reason },
    }),
  ]);

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.PERSON_DEACTIVATED,
    entityType: "User",
    entityId: userId,
    metadata: { reason, ownedContentCount: ownedCourses.length + ownedSops.length + ownedPaths.length },
  });

  return {
    ownedContent: [
      ...ownedCourses.map((c) => ({ type: "course" as const, id: c.id, title: c.title })),
      ...ownedSops.map((s) => ({ type: "sop" as const, id: s.id, title: s.title })),
      ...ownedPaths.map((p) => ({ type: "path" as const, id: p.id, title: p.title })),
    ],
    pendingApprovals,
  };
}

export async function reactivatePerson(actor: Actor, userId: string): Promise<void> {
  requirePermission(actor, "people.deactivate");
  await prisma.user.update({ where: { id: userId }, data: { status: "ACTIVE", deactivatedAt: null } });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.PERSON_REACTIVATED,
    entityType: "User",
    entityId: userId,
  });
  await evaluateRulesForUser(userId);
  await applyPositionRequirements(userId);
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

const WORKER_TYPES = new Set<string>([
  "US_EMPLOYEE",
  "US_CONTRACTOR",
  "PH_EMPLOYEE",
  "PH_CONTRACTOR",
  "INTL_EMPLOYEE",
  "INTL_CONTRACTOR",
]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Minimal RFC4180 CSV parser (quoted fields, embedded commas/newlines, "" escaping). */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const table: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      table.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    table.push(row);
  }

  const nonEmpty = table.filter((r) => r.some((c) => c.trim() !== ""));
  const headerRow = nonEmpty[0] ?? [];
  const headers = headerRow.map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((r) => {
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h] = (r[idx] ?? "").trim();
    });
    return record;
  });
  return { headers, rows };
}

export function toCsv(headers: string[], rows: Record<string, string>[]): string {
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) lines.push(headers.map((h) => escape(row[h] ?? "")).join(","));
  return lines.join("\n");
}

export interface ImportMapping {
  email: string;
  name: string;
  title?: string;
  employeeId?: string;
  workerType?: string;
  country?: string;
  state?: string;
  businessUnitSlug?: string;
  departmentName?: string;
  teamName?: string;
  positionTitle?: string;
  locationName?: string;
  managerEmail?: string;
  startDate?: string;
}

export interface ImportRowError {
  rowNumber: number;
  data: Record<string, string>;
  errors: string[];
}

export interface ImportPreview {
  valid: { rowNumber: number; input: CreatePersonInput }[];
  rejected: ImportRowError[];
}

/** Validates every row against current org data. Nothing is written to the database here. */
export async function validateImportRows(rows: Record<string, string>[], mapping: ImportMapping): Promise<ImportPreview> {
  const [departments, businessUnits, teams, positions, locations, existingUsers] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true } }),
    prisma.businessUnit.findMany({ select: { id: true, slug: true } }),
    prisma.team.findMany({ select: { id: true, name: true } }),
    prisma.position.findMany({ select: { id: true, title: true } }),
    prisma.location.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({ select: { id: true, email: true, employeeId: true } }),
  ]);

  const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));
  const buBySlug = new Map(businessUnits.map((b) => [b.slug.toLowerCase(), b.id]));
  const teamByName = new Map(teams.map((t) => [t.name.toLowerCase(), t.id]));
  const posByTitle = new Map(positions.map((p) => [p.title.toLowerCase(), p.id]));
  const locByName = new Map(locations.map((l) => [l.name.toLowerCase(), l.id]));
  const emailToId = new Map(existingUsers.map((u) => [u.email.toLowerCase(), u.id]));
  const existingEmployeeIds = new Set(existingUsers.map((u) => u.employeeId).filter((v): v is string => Boolean(v)));

  const valid: { rowNumber: number; input: CreatePersonInput }[] = [];
  const rejected: ImportRowError[] = [];
  const seenEmails = new Set<string>();
  const seenEmployeeIds = new Set<string>();

  const resolve = (row: Record<string, string>, column?: string): string => (column ? (row[column] ?? "").trim() : "");
  const lookup = (map: Map<string, string>, raw: string, label: string, errors: string[]): string | null => {
    if (!raw) return null;
    const id = map.get(raw.toLowerCase());
    if (!id) errors.push(`${label} "${raw}" was not found.`);
    return id ?? null;
  };

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // header is row 1
    const errors: string[] = [];

    const email = resolve(row, mapping.email).toLowerCase();
    const name = resolve(row, mapping.name);
    if (!email) errors.push("Email is required.");
    else if (!EMAIL_RE.test(email)) errors.push(`"${email}" is not a valid email address.`);
    else if (emailToId.has(email)) errors.push("A person with this email already exists.");
    else if (seenEmails.has(email)) errors.push("Duplicate email within this file.");
    if (!name) errors.push("Name is required.");

    const employeeId = resolve(row, mapping.employeeId) || null;
    if (employeeId) {
      if (existingEmployeeIds.has(employeeId)) errors.push(`Employee ID "${employeeId}" already exists.`);
      else if (seenEmployeeIds.has(employeeId)) errors.push("Duplicate employee ID within this file.");
    }

    const workerTypeRaw = (resolve(row, mapping.workerType) || "US_EMPLOYEE").toUpperCase();
    if (!WORKER_TYPES.has(workerTypeRaw)) errors.push(`Worker type "${workerTypeRaw}" is not valid.`);

    const departmentId = lookup(deptByName, resolve(row, mapping.departmentName), "Department", errors);
    const businessUnitId = lookup(buBySlug, resolve(row, mapping.businessUnitSlug), "Business unit", errors);
    const teamId = lookup(teamByName, resolve(row, mapping.teamName), "Team", errors);
    const positionId = lookup(posByTitle, resolve(row, mapping.positionTitle), "Position", errors);
    const locationId = lookup(locByName, resolve(row, mapping.locationName), "Location", errors);

    const managerEmailRaw = resolve(row, mapping.managerEmail).toLowerCase();
    let managerId: string | null = null;
    if (managerEmailRaw) {
      managerId = emailToId.get(managerEmailRaw) ?? null;
      if (!managerId) errors.push(`Manager email "${managerEmailRaw}" does not match an existing person.`);
    }

    const startDateRaw = resolve(row, mapping.startDate);
    let startDate: Date | null = null;
    if (startDateRaw) {
      const parsed = new Date(startDateRaw);
      if (Number.isNaN(parsed.getTime())) errors.push(`Start date "${startDateRaw}" is not a valid date.`);
      else startDate = parsed;
    }

    const country = resolve(row, mapping.country) || "US";

    if (errors.length > 0) {
      rejected.push({ rowNumber, data: row, errors });
      return;
    }

    seenEmails.add(email);
    if (employeeId) seenEmployeeIds.add(employeeId);

    valid.push({
      rowNumber,
      input: {
        email,
        name,
        title: resolve(row, mapping.title) || null,
        employeeId,
        workerType: workerTypeRaw as WorkerType,
        country,
        state: resolve(row, mapping.state) || null,
        businessUnitId,
        departmentId,
        teamId,
        positionId,
        locationId,
        managerId,
        startDate,
      },
    });
  });

  return { valid, rejected };
}

export interface ImportCommitResult {
  committed: string[];
  failed: { rowNumber: number; error: string }[];
}

/**
 * Commits previously validated rows. Each row is created and rule-evaluated
 * independently so one unexpected failure (e.g. a concurrent duplicate)
 * doesn't roll back an entire multi-thousand-row batch; `failed` reports any
 * row that could not be committed despite passing validation.
 */
export async function importPeople(
  actor: Actor,
  valid: { rowNumber: number; input: CreatePersonInput }[],
): Promise<ImportCommitResult> {
  requirePermission(actor, "people.import");

  const committed: string[] = [];
  const failed: { rowNumber: number; error: string }[] = [];

  for (const row of valid) {
    try {
      const created = await createPersonRecord(row.input);
      committed.push(created.id);
    } catch (error) {
      failed.push({ rowNumber: row.rowNumber, error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.PERSON_IMPORTED,
    entityType: "User",
    metadata: { committed: committed.length, failed: failed.length },
  });

  return { committed, failed };
}

export function buildRejectedCsv(rejected: ImportRowError[], headers: string[]): string {
  const allHeaders = [...headers, "errors"];
  const rows = rejected.map((r) => ({ ...r.data, errors: r.errors.join("; ") }));
  return toCsv(allHeaders, rows);
}

// ---------------------------------------------------------------------------
// Bulk update
// ---------------------------------------------------------------------------

export interface BulkPatch {
  departmentId?: string | null;
  teamId?: string | null;
  businessUnitId?: string | null;
  locationId?: string | null;
  managerId?: string | null;
  deactivate?: boolean;
}

export interface BulkUpdateResult {
  updated: string[];
  skipped: { userId: string; reason: string }[];
}

export async function bulkUpdate(actor: Actor, userIds: string[], patch: BulkPatch): Promise<BulkUpdateResult> {
  const updated: string[] = [];
  const skipped: { userId: string; reason: string }[] = [];

  for (const userId of userIds) {
    if (patch.deactivate) {
      if (!actor.permissions.has("people.deactivate")) {
        skipped.push({ userId, reason: "Missing permission to deactivate." });
        continue;
      }
      try {
        await deactivatePerson(actor, userId, { reason: "Bulk deactivation" });
        updated.push(userId);
      } catch (error) {
        skipped.push({ userId, reason: error instanceof Error ? error.message : "Deactivation failed." });
      }
      continue;
    }

    if (!actor.permissions.has("people.edit")) {
      skipped.push({ userId, reason: "Missing permission to edit people." });
      continue;
    }
    const visible = await canViewUser(actor, userId);
    if (!visible) {
      skipped.push({ userId, reason: "Outside your visible scope." });
      continue;
    }

    const before = await prisma.user.findUnique({ where: { id: userId }, select: PROFILE_SNAPSHOT_SELECT });
    if (!before) {
      skipped.push({ userId, reason: "Person not found." });
      continue;
    }

    const data: Prisma.UserUpdateInput = {};
    if (patch.departmentId !== undefined) {
      data.department = patch.departmentId ? { connect: { id: patch.departmentId } } : { disconnect: true };
    }
    if (patch.teamId !== undefined) {
      data.team = patch.teamId ? { connect: { id: patch.teamId } } : { disconnect: true };
    }
    if (patch.businessUnitId !== undefined) {
      data.businessUnit = patch.businessUnitId ? { connect: { id: patch.businessUnitId } } : { disconnect: true };
    }
    if (patch.locationId !== undefined) {
      data.location = patch.locationId ? { connect: { id: patch.locationId } } : { disconnect: true };
    }
    if (patch.managerId !== undefined) {
      data.manager = patch.managerId ? { connect: { id: patch.managerId } } : { disconnect: true };
    }

    await prisma.user.update({ where: { id: userId }, data });
    const after = await prisma.user.findUnique({ where: { id: userId }, select: PROFILE_SNAPSHOT_SELECT });
    if (after) await handleProfileChange(userId, before as ProfileSnapshot, after as ProfileSnapshot);
    updated.push(userId);
  }

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.PERSON_UPDATED,
    entityType: "User",
    metadata: { bulk: true, count: updated.length, patchKeys: Object.keys(patch) },
  });

  return { updated, skipped };
}

// ---------------------------------------------------------------------------
// Privacy: export and anonymize
// ---------------------------------------------------------------------------

export async function exportPersonData(actor: Actor, userId: string): Promise<Record<string, unknown>> {
  const isSelf = actor.id === userId;
  if (!isSelf && !actor.permissions.has("privacy.manage")) throw new AuthorizationError("privacy.manage");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      businessUnit: { select: { name: true } },
      department: { select: { name: true } },
      team: { select: { name: true } },
      position: { select: { title: true } },
      location: { select: { name: true } },
      manager: { select: { id: true, name: true, email: true } },
      roles: { include: { role: { select: { key: true } } } },
    },
  });
  if (!user) throw new Error("That person no longer exists.");

  const [
    assignments,
    completions,
    acknowledgements,
    certificates,
    skills,
    skillAssessments,
    quizAttempts,
    notifications,
    favorites,
    contentViews,
    feedback,
    comments,
    exemptions,
    sessionAttendance,
    announcementAcks,
  ] = await Promise.all([
    prisma.assignment.findMany({ where: { userId } }),
    prisma.completionRecord.findMany({ where: { userId } }),
    prisma.acknowledgement.findMany({ where: { userId } }),
    prisma.certificate.findMany({ where: { userId } }),
    prisma.userSkill.findMany({ where: { userId }, include: { skill: { select: { name: true } } } }),
    prisma.skillAssessment.findMany({ where: { userId } }),
    prisma.quizAttempt.findMany({ where: { userId } }),
    prisma.notification.findMany({ where: { userId } }),
    prisma.favorite.findMany({ where: { userId } }),
    prisma.contentView.findMany({ where: { userId } }),
    prisma.contentFeedback.findMany({ where: { userId } }),
    prisma.contentComment.findMany({ where: { authorId: userId } }),
    prisma.trainingExemption.findMany({ where: { userId } }),
    prisma.sessionAttendance.findMany({ where: { userId } }),
    prisma.announcementAck.findMany({ where: { userId } }),
  ]);

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.PERSON_EXPORTED,
    entityType: "User",
    entityId: userId,
  });

  return {
    exportedAt: new Date().toISOString(),
    note: "This export excludes encrypted sensitive fields and contains only this person's data.",
    profile: {
      id: user.id,
      email: user.email,
      name: user.name,
      legalName: user.legalName,
      title: user.title,
      employeeId: user.employeeId,
      workerType: user.workerType,
      country: user.country,
      state: user.state,
      timezone: user.timezone,
      language: user.language,
      startDate: user.startDate,
      status: user.status,
      businessUnit: user.businessUnit?.name ?? null,
      department: user.department?.name ?? null,
      team: user.team?.name ?? null,
      position: user.position?.title ?? null,
      location: user.location?.name ?? null,
      manager: user.manager,
      roles: user.roles.map((r) => r.role.key),
    },
    trainingAssignments: assignments,
    completionRecords: completions,
    acknowledgements,
    certificates,
    skills: skills.map((s) => ({ skill: s.skill.name, level: s.level, source: s.source, evidence: s.evidence, updatedAt: s.updatedAt })),
    skillAssessments,
    quizAttempts,
    notifications,
    favorites,
    contentViews,
    feedback,
    comments,
    trainingExemptions: exemptions,
    liveSessionAttendance: sessionAttendance,
    announcementAcknowledgements: announcementAcks,
  };
}

export async function anonymizePerson(actor: Actor, userId: string): Promise<void> {
  requirePermission(actor, "privacy.manage");

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new Error("That person no longer exists.");

  const token = `anonymized-${userId.slice(-10)}`;
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        name: "Anonymized User",
        legalName: null,
        email: `${token}@anonymized.invalid`,
        personalEmail: null,
        workPhone: null,
        mobilePhone: null,
        image: null,
        employeeId: null,
        status: "INACTIVE",
        deactivatedAt: new Date(),
      },
    }),
    prisma.sensitiveField.deleteMany({ where: { userId } }),
  ]);

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.PERSON_ANONYMIZED,
    entityType: "User",
    entityId: userId,
  });
}
