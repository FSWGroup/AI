import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  createPublishedCourse,
  createUser,
  freshDatabase,
  testPrisma,
} from "./helpers";
import { ROLE_KEYS } from "@/lib/permissions";
import { evaluateRulesForUser, applyPositionRequirements } from "@/lib/services/assignment";

/**
 * The assignment engine, end to end against a real database.
 *
 * The pure criteria evaluator is unit tested separately. These tests cover what
 * only a database can show: that rule evaluation is genuinely idempotent, that
 * assignments carry a reason a person can read, and that due dates land where
 * they should.
 */

beforeEach(async () => {
  await freshDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

async function orgFixture() {
  const org = await testPrisma.organization.create({ data: { name: "FSW Group" } });
  const unit = await testPrisma.businessUnit.create({
    data: { organizationId: org.id, name: "Welsford", slug: `welsford-${Date.now()}` },
  });
  const sales = await testPrisma.department.create({
    data: { businessUnitId: unit.id, name: "Sales" },
  });
  const operations = await testPrisma.department.create({
    data: { businessUnitId: unit.id, name: "Operations" },
  });
  const position = await testPrisma.position.create({
    data: { departmentId: sales.id, title: "Inside Sales Representative" },
  });
  return { unit, sales, operations, position };
}

async function createRule(options: {
  name: string;
  criteria: unknown;
  courseId: string;
  dueDays?: number;
  createdById: string;
  isActive?: boolean;
}) {
  return testPrisma.assignmentRule.create({
    data: {
      name: options.name,
      criteria: options.criteria as never,
      targetType: "COURSE",
      courseId: options.courseId,
      dueDays: options.dueDays ?? 14,
      createdById: options.createdById,
      isActive: options.isActive ?? true,
    },
    select: { id: true },
  });
}

describe("rule evaluation assigns the right people", () => {
  it("assigns a department-scoped rule only to that department", async () => {
    const { sales, operations } = await orgFixture();
    const admin = await createUser({ email: "admin@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { courseId } = await createPublishedCourse({
      title: "The Customer Quote Process",
      createdById: admin,
    });

    await createRule({
      name: "Sales department — Customer Quote Process",
      criteria: {
        all: [
          { field: "departmentName", op: "eq", value: "Sales" },
          { field: "status", op: "eq", value: "ACTIVE" },
        ],
      },
      courseId,
      createdById: admin,
    });

    const salesPerson = await createUser({
      email: "sales@test.local",
      roles: [ROLE_KEYS.LEARNER],
      departmentId: sales.id,
    });
    const warehousePerson = await createUser({
      email: "warehouse@test.local",
      roles: [ROLE_KEYS.LEARNER],
      departmentId: operations.id,
    });

    await evaluateRulesForUser(salesPerson);
    await evaluateRulesForUser(warehousePerson);

    const salesAssignments = await testPrisma.assignment.count({
      where: { userId: salesPerson, courseId },
    });
    const warehouseAssignments = await testPrisma.assignment.count({
      where: { userId: warehousePerson, courseId },
    });

    expect(salesAssignments).toBe(1);
    expect(warehouseAssignments).toBe(0);
  });

  it("assigns an all-active rule to everyone active", async () => {
    const admin = await createUser({ email: "admin2@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { courseId } = await createPublishedCourse({
      title: "Cybersecurity Fundamentals",
      createdById: admin,
    });

    await createRule({
      name: "All employees — Cybersecurity Fundamentals",
      criteria: { all: [{ field: "status", op: "eq", value: "ACTIVE" }] },
      courseId,
      createdById: admin,
    });

    const active = await createUser({ email: "active@test.local", roles: [ROLE_KEYS.LEARNER] });
    const contractor = await createUser({
      email: "contractor@test.local",
      roles: [ROLE_KEYS.CONTRACTOR],
      workerType: "PH_CONTRACTOR",
      country: "PH",
    });
    const inactive = await createUser({
      email: "inactive@test.local",
      roles: [ROLE_KEYS.LEARNER],
      status: "INACTIVE",
    });

    for (const userId of [active, contractor, inactive]) {
      await evaluateRulesForUser(userId);
    }

    expect(await testPrisma.assignment.count({ where: { userId: active, courseId } })).toBe(1);
    expect(await testPrisma.assignment.count({ where: { userId: contractor, courseId } })).toBe(1);
    // A deactivated person must not be assigned new training.
    expect(await testPrisma.assignment.count({ where: { userId: inactive, courseId } })).toBe(0);
  });

  it("ignores an inactive rule", async () => {
    const admin = await createUser({ email: "admin3@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { courseId } = await createPublishedCourse({ title: "Paused", createdById: admin });

    await createRule({
      name: "Paused rule",
      criteria: { all: [{ field: "status", op: "eq", value: "ACTIVE" }] },
      courseId,
      createdById: admin,
      isActive: false,
    });

    const learner = await createUser({ email: "learner@test.local", roles: [ROLE_KEYS.LEARNER] });
    await evaluateRulesForUser(learner);

    expect(await testPrisma.assignment.count({ where: { userId: learner, courseId } })).toBe(0);
  });

  it("targets Philippines contractors without catching Philippines employees", async () => {
    const admin = await createUser({ email: "admin4@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { courseId } = await createPublishedCourse({
      title: "Philippines Contractor Onboarding",
      createdById: admin,
    });

    await createRule({
      name: "Philippines contractors",
      criteria: {
        all: [
          { field: "country", op: "eq", value: "PH" },
          { field: "workerType", op: "eq", value: "PH_CONTRACTOR" },
        ],
      },
      courseId,
      createdById: admin,
    });

    const phContractor = await createUser({
      email: "ph-contractor@test.local",
      roles: [ROLE_KEYS.CONTRACTOR],
      workerType: "PH_CONTRACTOR",
      country: "PH",
    });
    const phEmployee = await createUser({
      email: "ph-employee@test.local",
      roles: [ROLE_KEYS.LEARNER],
      workerType: "PH_EMPLOYEE",
      country: "PH",
    });
    const usContractor = await createUser({
      email: "us-contractor@test.local",
      roles: [ROLE_KEYS.CONTRACTOR],
      workerType: "US_CONTRACTOR",
      country: "US",
    });

    for (const userId of [phContractor, phEmployee, usContractor]) {
      await evaluateRulesForUser(userId);
    }

    expect(await testPrisma.assignment.count({ where: { userId: phContractor, courseId } })).toBe(1);
    expect(await testPrisma.assignment.count({ where: { userId: phEmployee, courseId } })).toBe(0);
    expect(await testPrisma.assignment.count({ where: { userId: usContractor, courseId } })).toBe(0);
  });
});

describe("rule evaluation is idempotent", () => {
  it("does not duplicate an assignment across repeated runs", async () => {
    const admin = await createUser({ email: "admin5@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { courseId } = await createPublishedCourse({ title: "Repeated", createdById: admin });

    await createRule({
      name: "Everyone",
      criteria: { all: [{ field: "status", op: "eq", value: "ACTIVE" }] },
      courseId,
      createdById: admin,
    });

    const learner = await createUser({ email: "repeat@test.local", roles: [ROLE_KEYS.LEARNER] });

    // The scheduler runs this daily; running it five times must be harmless.
    for (let i = 0; i < 5; i += 1) {
      await evaluateRulesForUser(learner);
    }

    const count = await testPrisma.assignment.count({ where: { userId: learner, courseId } });
    expect(count).toBe(1);
  });

  it("does not resurrect a completed assignment", async () => {
    const admin = await createUser({ email: "admin6@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { courseId } = await createPublishedCourse({ title: "Finished", createdById: admin });

    await createRule({
      name: "Everyone",
      criteria: { all: [{ field: "status", op: "eq", value: "ACTIVE" }] },
      courseId,
      createdById: admin,
    });

    const learner = await createUser({ email: "done@test.local", roles: [ROLE_KEYS.LEARNER] });
    await evaluateRulesForUser(learner);

    await testPrisma.assignment.updateMany({
      where: { userId: learner, courseId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    await evaluateRulesForUser(learner);

    const assignments = await testPrisma.assignment.findMany({
      where: { userId: learner, courseId },
      select: { status: true },
    });

    // Still exactly one, and still completed — not reopened.
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.status).toBe("COMPLETED");
  });

  it("does not duplicate when two rules target the same course", async () => {
    const { sales } = await orgFixture();
    const admin = await createUser({ email: "admin7@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { courseId } = await createPublishedCourse({ title: "Overlapping", createdById: admin });

    await createRule({
      name: "Rule A — everyone",
      criteria: { all: [{ field: "status", op: "eq", value: "ACTIVE" }] },
      courseId,
      createdById: admin,
    });
    await createRule({
      name: "Rule B — Sales",
      criteria: { all: [{ field: "departmentName", op: "eq", value: "Sales" }] },
      courseId,
      createdById: admin,
    });

    const learner = await createUser({
      email: "overlap@test.local",
      roles: [ROLE_KEYS.LEARNER],
      departmentId: sales.id,
    });
    await evaluateRulesForUser(learner);

    // Both rules match; the person owes the course once.
    expect(await testPrisma.assignment.count({ where: { userId: learner, courseId } })).toBe(1);
  });
});

describe("assignments explain themselves", () => {
  it("records a human-readable reason naming the matched attribute", async () => {
    const { sales } = await orgFixture();
    const admin = await createUser({ email: "admin8@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { courseId } = await createPublishedCourse({ title: "Explained", createdById: admin });

    await createRule({
      name: "Sales department training",
      criteria: {
        all: [
          { field: "status", op: "eq", value: "ACTIVE" },
          { field: "departmentName", op: "eq", value: "Sales" },
        ],
      },
      courseId,
      createdById: admin,
    });

    const learner = await createUser({
      email: "explained@test.local",
      roles: [ROLE_KEYS.LEARNER],
      departmentId: sales.id,
    });
    await evaluateRulesForUser(learner);

    const assignment = await testPrisma.assignment.findFirstOrThrow({
      where: { userId: learner, courseId },
      select: { reason: true, source: true, sourceRuleId: true },
    });

    expect(assignment.reason).toBeTruthy();
    // "status is ACTIVE" is not informative; the department is.
    expect(assignment.reason?.toLowerCase()).toContain("sales");
    expect(assignment.source).toBe("RULE");
    expect(assignment.sourceRuleId).toBeTruthy();
  });

  it("sets a due date from the rule's dueDays", async () => {
    const admin = await createUser({ email: "admin9@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { courseId } = await createPublishedCourse({ title: "Timed", createdById: admin });

    await createRule({
      name: "Due in 14 days",
      criteria: { all: [{ field: "status", op: "eq", value: "ACTIVE" }] },
      courseId,
      dueDays: 14,
      createdById: admin,
    });

    const learner = await createUser({ email: "timed@test.local", roles: [ROLE_KEYS.LEARNER] });
    await evaluateRulesForUser(learner);

    const assignment = await testPrisma.assignment.findFirstOrThrow({
      where: { userId: learner, courseId },
      select: { dueAt: true, assignedAt: true },
    });

    expect(assignment.dueAt).toBeInstanceOf(Date);
    const days =
      (assignment.dueAt!.getTime() - assignment.assignedAt.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(13);
    expect(days).toBeLessThan(15);
  });

  it("notifies the person that training was assigned", async () => {
    const admin = await createUser({ email: "admin10@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { courseId } = await createPublishedCourse({ title: "Notified", createdById: admin });

    await createRule({
      name: "Everyone",
      criteria: { all: [{ field: "status", op: "eq", value: "ACTIVE" }] },
      courseId,
      createdById: admin,
    });

    const learner = await createUser({ email: "notified@test.local", roles: [ROLE_KEYS.LEARNER] });
    await evaluateRulesForUser(learner);

    const notifications = await testPrisma.notification.findMany({
      where: { userId: learner, type: "TRAINING_ASSIGNED" },
      select: { title: true, linkUrl: true },
    });

    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0]?.title).toBeTruthy();
  });
});

describe("position requirements", () => {
  it("assigns the training a position requires", async () => {
    const { position } = await orgFixture();
    const admin = await createUser({ email: "admin11@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { courseId } = await createPublishedCourse({
      title: "Valve Fundamentals",
      createdById: admin,
    });

    await testPrisma.positionTrainingRequirement.create({
      data: { positionId: position.id, targetType: "COURSE", courseId, required: true },
    });

    const learner = await createUser({
      email: "positioned@test.local",
      roles: [ROLE_KEYS.LEARNER],
      positionId: position.id,
    });

    await applyPositionRequirements(learner);

    const assignment = await testPrisma.assignment.findFirstOrThrow({
      where: { userId: learner, courseId },
      select: { source: true, reason: true },
    });

    expect(assignment.source).toBe("POSITION");
    expect(assignment.reason).toBeTruthy();
  });

  it("is idempotent across repeated application", async () => {
    const { position } = await orgFixture();
    const admin = await createUser({ email: "admin12@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { courseId } = await createPublishedCourse({ title: "Repeated Position", createdById: admin });

    await testPrisma.positionTrainingRequirement.create({
      data: { positionId: position.id, targetType: "COURSE", courseId, required: true },
    });

    const learner = await createUser({
      email: "repeat-position@test.local",
      roles: [ROLE_KEYS.LEARNER],
      positionId: position.id,
    });

    for (let i = 0; i < 3; i += 1) {
      await applyPositionRequirements(learner);
    }

    expect(await testPrisma.assignment.count({ where: { userId: learner, courseId } })).toBe(1);
  });

  it("assigns nothing when the person has no position", async () => {
    const admin = await createUser({ email: "admin13@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { courseId } = await createPublishedCourse({ title: "Unpositioned", createdById: admin });
    const { position } = await orgFixture();

    await testPrisma.positionTrainingRequirement.create({
      data: { positionId: position.id, targetType: "COURSE", courseId, required: true },
    });

    const learner = await createUser({ email: "no-position@test.local", roles: [ROLE_KEYS.LEARNER] });
    await applyPositionRequirements(learner);

    expect(await testPrisma.assignment.count({ where: { userId: learner } })).toBe(0);
  });
});
