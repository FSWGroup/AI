import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_KEYS,
  ROLE_LABELS,
  type RoleKey,
} from "@/lib/permissions";
import type { Actor } from "@/lib/auth/scope";
import type { Permission } from "@/lib/permissions";

/**
 * Integration test helpers.
 *
 * Builds real database rows and real Actor objects, so authorization is
 * exercised the same way it is in production — no mocked permission sets.
 */

export const testPrisma = new PrismaClient();

/** Truncate every table except migration bookkeeping. */
export async function resetDatabase(): Promise<void> {
  const tables = await testPrisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/**
 * Seed roles and their default permissions.
 *
 * Call once per test after resetDatabase(). Deliberately NOT called from
 * createUser: rebuilding the permission rows mid-test would momentarily empty
 * them, and any Actor resolved in that window would appear to hold nothing.
 */
export async function seedRoles(): Promise<Map<RoleKey, string>> {
  const ids = new Map<RoleKey, string>();
  for (const key of Object.values(ROLE_KEYS)) {
    const role = await testPrisma.role.upsert({
      where: { key },
      create: { key, name: ROLE_LABELS[key], isSystem: true },
      update: {},
      select: { id: true, permissions: { select: { permission: true } } },
    });
    ids.set(key, role.id);

    // Only fill in permissions when they are missing, so repeated calls are
    // genuinely idempotent rather than delete-and-recreate.
    if (role.permissions.length === 0) {
      await testPrisma.rolePermission.createMany({
        data: DEFAULT_ROLE_PERMISSIONS[key].map((permission) => ({ roleId: role.id, permission })),
        skipDuplicates: true,
      });
    }
  }
  return ids;
}

/** Reset and seed in one call — the standard test setup. */
export async function freshDatabase(): Promise<Map<RoleKey, string>> {
  await resetDatabase();
  return seedRoles();
}

export interface CreateUserOptions {
  email: string;
  name?: string;
  roles?: RoleKey[];
  managerId?: string;
  departmentId?: string;
  businessUnitId?: string;
  positionId?: string;
  teamId?: string;
  locationId?: string;
  workerType?: "US_EMPLOYEE" | "US_CONTRACTOR" | "PH_EMPLOYEE" | "PH_CONTRACTOR";
  country?: string;
  status?: "ACTIVE" | "INACTIVE" | "INVITED";
  startDate?: Date;
}

/**
 * Create a user with real role rows. Assumes seedRoles() has already run —
 * see the note on seedRoles above.
 */
export async function createUser(options: CreateUserOptions): Promise<string> {
  const passwordHash = await bcrypt.hash("test-password", 4);

  const user = await testPrisma.user.create({
    data: {
      email: options.email,
      name: options.name ?? options.email.split("@")[0] ?? "Test User",
      passwordHash,
      emailVerified: new Date(),
      status: options.status ?? "ACTIVE",
      workerType: options.workerType ?? "US_EMPLOYEE",
      country: options.country ?? "US",
      managerId: options.managerId ?? null,
      departmentId: options.departmentId ?? null,
      businessUnitId: options.businessUnitId ?? null,
      positionId: options.positionId ?? null,
      teamId: options.teamId ?? null,
      locationId: options.locationId ?? null,
      startDate: options.startDate ?? new Date("2025-01-01"),
      trainingStartDate: options.startDate ?? new Date("2025-01-01"),
    },
    select: { id: true },
  });

  const roleKeys = options.roles ?? [ROLE_KEYS.LEARNER];
  const roles = await testPrisma.role.findMany({
    where: { key: { in: roleKeys } },
    select: { id: true },
  });

  if (roles.length !== roleKeys.length) {
    throw new Error(
      `createUser("${options.email}") requested roles [${roleKeys.join(", ")}] but only ` +
        `${roles.length} exist. Call seedRoles() (or freshDatabase()) in your setup first.`,
    );
  }

  await testPrisma.userRole.createMany({
    data: roles.map((role) => ({ userId: user.id, roleId: role.id })),
    skipDuplicates: true,
  });

  return user.id;
}

/** Build a real Actor from the database, exactly as getActor() would. */
export async function actorFor(userId: string): Promise<Actor> {
  const user = await testPrisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      status: true,
      timezone: true,
      language: true,
      businessUnitId: true,
      departmentId: true,
      teamId: true,
      positionId: true,
      locationId: true,
      managerId: true,
      workerType: true,
      country: true,
      roles: {
        select: {
          role: { select: { key: true, permissions: { select: { permission: true } } } },
        },
      },
    },
  });

  const permissions = new Set<Permission>();
  const roleKeys: string[] = [];
  for (const { role } of user.roles) {
    roleKeys.push(role.key);
    for (const { permission } of role.permissions) permissions.add(permission as Permission);
  }

  const { roles: _roles, ...rest } = user;
  return { ...rest, permissions, roleKeys };
}

export async function createOrgFixture(suffix = String(Date.now())) {
  const org = await testPrisma.organization.create({ data: { name: "Test Group" } });
  const businessUnit = await testPrisma.businessUnit.create({
    data: { organizationId: org.id, name: "Test Unit", slug: `unit-${suffix}` },
  });
  const otherUnit = await testPrisma.businessUnit.create({
    data: { organizationId: org.id, name: "Other Unit", slug: `other-${suffix}` },
  });
  const department = await testPrisma.department.create({
    data: { businessUnitId: businessUnit.id, name: "Sales" },
  });
  const position = await testPrisma.position.create({
    data: { departmentId: department.id, title: "Inside Sales Representative" },
  });
  return { org, businessUnit, otherUnit, department, position };
}

export async function createPublishedCourse(options: {
  title: string;
  createdById: string;
  passingScore?: number;
  recertifyMonths?: number;
  departmentId?: string;
  businessUnitId?: string;
}) {
  const course = await testPrisma.course.create({
    data: {
      title: options.title,
      status: "PUBLISHED",
      createdById: options.createdById,
      ownerId: options.createdById,
      passingScore: options.passingScore ?? 80,
      recertifyMonths: options.recertifyMonths ?? null,
      departmentId: options.departmentId ?? null,
      businessUnitId: options.businessUnitId ?? null,
    },
    select: { id: true },
  });

  const section = await testPrisma.courseSection.create({
    data: { courseId: course.id, title: "Section 1", order: 0 },
    select: { id: true },
  });

  const lesson = await testPrisma.lesson.create({
    data: {
      sectionId: section.id,
      title: "Lesson 1",
      type: "RICH_TEXT",
      order: 0,
      required: true,
      content: { blocks: [{ id: "b1", type: "paragraph", text: "Test content." }] },
    },
    select: { id: true },
  });

  const version = await testPrisma.courseVersion.create({
    data: {
      courseId: course.id,
      versionNumber: "1.0",
      title: options.title,
      snapshot: {
        title: options.title,
        sections: [{ title: "Section 1", lessons: [{ title: "Lesson 1", type: "RICH_TEXT" }] }],
      },
      authorId: options.createdById,
    },
    select: { id: true },
  });

  await testPrisma.course.update({
    where: { id: course.id },
    data: { currentVersionId: version.id },
  });

  return { courseId: course.id, sectionId: section.id, lessonId: lesson.id, versionId: version.id };
}

export async function createPublishedSop(options: {
  code: string;
  title: string;
  createdById: string;
  businessUnitId?: string;
  departmentId?: string;
}) {
  const blocks = [{ id: "b1", type: "paragraph", text: "Procedure body for testing." }];
  const meta = {
    purpose: "Testing",
    scope: "Tests",
    definitions: [],
    prerequisites: [],
    requiredTools: [],
    safetyConsiderations: "",
    troubleshooting: [],
    exceptions: "",
    relatedSopIds: [],
    relatedCourseIds: [],
    externalLinks: [],
  };

  const sop = await testPrisma.sop.create({
    data: {
      sopCode: options.code,
      title: options.title,
      status: "PUBLISHED",
      createdById: options.createdById,
      ownerId: options.createdById,
      businessUnitId: options.businessUnitId ?? null,
      departmentId: options.departmentId ?? null,
      draftBlocks: blocks,
      draftMeta: meta,
      reviewCycleDays: 365,
      lastReviewedAt: new Date(),
      nextReviewAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });

  const version = await testPrisma.sopVersion.create({
    data: {
      sopId: sop.id,
      versionNumber: "1.0",
      title: options.title,
      blocks,
      meta,
      authorId: options.createdById,
    },
    select: { id: true },
  });

  await testPrisma.sop.update({
    where: { id: sop.id },
    data: { currentVersionId: version.id },
  });

  return { sopId: sop.id, versionId: version.id };
}
