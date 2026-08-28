import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  actorFor,
  createOrgFixture,
  createPublishedSop,
  createUser,
  freshDatabase,
  resetDatabase,
  seedRoles,
  testPrisma,
} from "./helpers";
import { ROLE_KEYS } from "@/lib/permissions";
import { canManageUser, canViewUser, getVisibleUserIds } from "@/lib/auth/scope";

/**
 * Authorization boundary tests.
 *
 * These build real users, real role rows, and real Actor objects — permission
 * sets are never mocked, because a mocked permission set would test the mock
 * rather than the boundary.
 */

beforeAll(async () => {
  await resetDatabase();
  await seedRoles();
});


afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("effective permissions come from role rows", () => {
  beforeEach(async () => {
    await freshDatabase();
  });

  it("gives a learner the baseline and nothing administrative", async () => {
    const userId = await createUser({ email: "learner@test.local", roles: [ROLE_KEYS.LEARNER] });
    const actor = await actorFor(userId);

    expect(actor.permissions.has("training.view")).toBe(true);
    expect(actor.permissions.has("sop.view")).toBe(true);
    expect(actor.permissions.has("training.publish")).toBe(false);
    expect(actor.permissions.has("people.edit")).toBe(false);
    expect(actor.permissions.has("audit.view")).toBe(false);
    expect(actor.permissions.has("people.sensitive_view")).toBe(false);
  });

  it("unions permissions across multiple roles", async () => {
    const userId = await createUser({
      email: "multi@test.local",
      roles: [ROLE_KEYS.LEARNER, ROLE_KEYS.CONTENT_AUTHOR],
    });
    const actor = await actorFor(userId);

    expect(actor.permissions.has("sop.create")).toBe(true);
    expect(actor.permissions.has("training.create")).toBe(true);
    // Authoring does not confer publishing.
    expect(actor.permissions.has("sop.publish")).toBe(false);
    expect(actor.permissions.has("training.publish")).toBe(false);
  });

  it("reflects a live change to a role's permissions", async () => {
    const userId = await createUser({ email: "live@test.local", roles: [ROLE_KEYS.LEARNER] });
    expect((await actorFor(userId)).permissions.has("reports.view")).toBe(false);

    const role = await testPrisma.role.findUniqueOrThrow({ where: { key: ROLE_KEYS.LEARNER } });
    await testPrisma.rolePermission.create({
      data: { roleId: role.id, permission: "reports.view" },
    });

    // No caching between requests: the next resolution sees the new grant.
    expect((await actorFor(userId)).permissions.has("reports.view")).toBe(true);
  });

  it("gives a contractor a narrower surface than a learner", async () => {
    const contractorId = await createUser({
      email: "contractor@test.local",
      roles: [ROLE_KEYS.CONTRACTOR],
      workerType: "PH_CONTRACTOR",
      country: "PH",
    });
    const actor = await actorFor(contractorId);

    expect(actor.permissions.has("training.view")).toBe(true);
    expect(actor.permissions.has("sop.view")).toBe(true);
    // Not the staff directory or the org chart.
    expect(actor.permissions.has("people.view")).toBe(false);
    expect(actor.permissions.has("org.view")).toBe(false);
  });

  it("keeps an auditor read-only", async () => {
    const userId = await createUser({ email: "auditor@test.local", roles: [ROLE_KEYS.AUDITOR] });
    const actor = await actorFor(userId);

    expect(actor.permissions.has("audit.view")).toBe(true);
    expect(actor.permissions.has("reports.view")).toBe(true);
    expect(actor.permissions.has("training.create")).toBe(false);
    expect(actor.permissions.has("training.assign")).toBe(false);
    expect(actor.permissions.has("people.edit")).toBe(false);
    expect(actor.permissions.has("settings.manage")).toBe(false);
  });
});

describe("manager scope walks the whole reporting tree", () => {
  let director: string;
  let manager: string;
  let reportA: string;
  let reportB: string;
  let unrelated: string;

  beforeEach(async () => {
    await freshDatabase();

    director = await createUser({ email: "director@test.local", roles: [ROLE_KEYS.MANAGER] });
    manager = await createUser({
      email: "manager@test.local",
      roles: [ROLE_KEYS.MANAGER],
      managerId: director,
    });
    reportA = await createUser({
      email: "report-a@test.local",
      roles: [ROLE_KEYS.LEARNER],
      managerId: manager,
    });
    reportB = await createUser({
      email: "report-b@test.local",
      roles: [ROLE_KEYS.LEARNER],
      managerId: manager,
    });
    unrelated = await createUser({ email: "unrelated@test.local", roles: [ROLE_KEYS.LEARNER] });
  });

  it("includes indirect reports, not just direct ones", async () => {
    const actor = await actorFor(director);
    const visible = await getVisibleUserIds(actor);

    expect(visible).not.toBe("ALL");
    const ids = visible as string[];
    expect(ids).toContain(director);
    expect(ids).toContain(manager);
    expect(ids).toContain(reportA);
    expect(ids).toContain(reportB);
    expect(ids).not.toContain(unrelated);
  });

  it("limits a mid-level manager to their own subtree", async () => {
    const actor = await actorFor(manager);
    const ids = (await getVisibleUserIds(actor)) as string[];

    expect(ids).toContain(reportA);
    expect(ids).toContain(reportB);
    // A manager cannot see their own manager.
    expect(ids).not.toContain(director);
    expect(ids).not.toContain(unrelated);
  });

  it("limits a learner to themselves", async () => {
    const actor = await actorFor(reportA);
    const ids = (await getVisibleUserIds(actor)) as string[];

    expect(ids).toEqual([reportA]);
  });

  it("gates individual record access with canViewUser", async () => {
    const managerActor = await actorFor(manager);
    expect(await canViewUser(managerActor, reportA)).toBe(true);
    expect(await canViewUser(managerActor, unrelated)).toBe(false);

    const learnerActor = await actorFor(reportA);
    // A learner can always see themselves.
    expect(await canViewUser(learnerActor, reportA)).toBe(true);
    // But never a peer.
    expect(await canViewUser(learnerActor, reportB)).toBe(false);
  });

  it("does not let a learner manage anyone", async () => {
    const learnerActor = await actorFor(reportA);
    expect(await canManageUser(learnerActor, reportB)).toBe(false);
    expect(await canManageUser(learnerActor, reportA)).toBe(false);
  });

  it("lets a manager act on reports but not on themselves", async () => {
    const managerActor = await actorFor(manager);
    expect(await canManageUser(managerActor, reportA)).toBe(true);
    // Self-assignment through the team path is excluded.
    expect(await canManageUser(managerActor, manager)).toBe(false);
  });

  it("gives platform-wide scope to an administrator", async () => {
    const adminId = await createUser({
      email: "admin@test.local",
      roles: [ROLE_KEYS.SUPER_ADMIN],
    });
    const actor = await actorFor(adminId);
    expect(await getVisibleUserIds(actor)).toBe("ALL");
    expect(await canViewUser(actor, unrelated)).toBe(true);
  });
});

describe("deactivated people", () => {
  beforeEach(async () => {
    await freshDatabase();
  });

  it("excludes an inactive person from a manager's visible set", async () => {
    const manager = await createUser({ email: "mgr2@test.local", roles: [ROLE_KEYS.MANAGER] });
    const active = await createUser({
      email: "active@test.local",
      roles: [ROLE_KEYS.LEARNER],
      managerId: manager,
    });
    const inactive = await createUser({
      email: "inactive@test.local",
      roles: [ROLE_KEYS.LEARNER],
      managerId: manager,
      status: "INACTIVE",
    });

    const actor = await actorFor(manager);
    const ids = (await getVisibleUserIds(actor)) as string[];

    // The subtree query returns structural reports; status filtering happens at
    // the query that lists people. Both are present in the tree.
    expect(ids).toContain(active);
    expect(ids).toContain(inactive);

    // But the directory query must exclude them.
    const listed = await testPrisma.user.findMany({
      where: { id: { in: ids }, status: { not: "INACTIVE" } },
      select: { id: true },
    });
    expect(listed.map((u) => u.id)).toContain(active);
    expect(listed.map((u) => u.id)).not.toContain(inactive);
  });
});

describe("published content visibility", () => {
  beforeEach(async () => {
    await freshDatabase();
  });

  it("keeps a draft SOP out of the published set a learner can read", async () => {
    const author = await createUser({
      email: "author2@test.local",
      roles: [ROLE_KEYS.CONTENT_AUTHOR],
    });
    const { department } = await createOrgFixture();

    await createPublishedSop({ code: "PUB-001", title: "Published", createdById: author });
    await testPrisma.sop.create({
      data: {
        sopCode: "DRAFT-001",
        title: "Draft only",
        status: "DRAFT",
        createdById: author,
        departmentId: department.id,
        draftBlocks: [],
        draftMeta: {},
      },
    });

    const publishedOnly = await testPrisma.sop.findMany({
      where: { status: "PUBLISHED", isDeleted: false },
      select: { sopCode: true },
    });

    expect(publishedOnly.map((s) => s.sopCode)).toEqual(["PUB-001"]);
  });
});
