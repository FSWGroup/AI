import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import {
  actorFor,
  createOrgFixture,
  createPublishedCourse,
  createUser,
  freshDatabase,
  testPrisma,
} from "./helpers";
import { getKnowledgeRisks, getManagerBrief } from "@/lib/services/insights";
import { ROLE_KEYS } from "@/lib/permissions";

/**
 * Insight services.
 *
 * These answer "who is the only person who can do this" and "what should a
 * manager do this week", so the properties that matter are the scoping (a
 * manager must never see outside their subtree) and the arithmetic (a risk
 * must not be reported for a skill nobody's position requires).
 */

describe("Knowledge risk", () => {
  let org: Awaited<ReturnType<typeof createOrgFixture>>;

  beforeAll(async () => {
    await freshDatabase();
  });

  beforeEach(async () => {
    await freshDatabase();
    org = await createOrgFixture();
  });

  /** A skill required by the fixture position at the given level. */
  async function requireSkill(name: string, level: number) {
    const skill = await testPrisma.skill.create({ data: { name, category: "Product" } });
    await testPrisma.positionSkillRequirement.create({
      data: { positionId: org.position.id, skillId: skill.id, requiredLevel: level },
    });
    return skill;
  }

  async function grant(userId: string, skillId: string, level: number) {
    await testPrisma.userSkill.create({
      data: { userId, skillId, level, source: "MANAGER_ASSESSMENT" },
    });
  }

  it("flags a skill exactly one person holds as a single point of failure", async () => {
    const skill = await requireSkill("Control Valve Sizing", 4);
    const admin = await createUser({ email: "admin@test.dev", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const expert = await createUser({ email: "expert@test.dev", positionId: org.position.id });
    await createUser({ email: "junior@test.dev", positionId: org.position.id });

    await grant(expert, skill.id, 5);

    const risks = await getKnowledgeRisks(await actorFor(admin));
    const risk = risks.find((r) => r.skillId === skill.id);

    expect(risk).toBeDefined();
    expect(risk!.level).toBe("SINGLE_HOLDER");
    expect(risk!.holders).toHaveLength(1);
    expect(risk!.holders[0]?.name).toContain("expert");
    // Both people's position requires it, so both depend on it.
    expect(risk!.dependentCount).toBe(2);
  });

  it("flags a required skill nobody holds as the worst case, and sorts it first", async () => {
    const held = await requireSkill("Ball Valves", 2);
    const unheld = await requireSkill("Actuation Sizing", 3);
    const admin = await createUser({ email: "admin@test.dev", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const person = await createUser({ email: "person@test.dev", positionId: org.position.id });
    await grant(person, held.id, 2);

    const risks = await getKnowledgeRisks(await actorFor(admin));

    expect(risks[0]?.skillId).toBe(unheld.id);
    expect(risks[0]?.level).toBe("NOBODY");
    expect(risks[0]?.holders).toHaveLength(0);
  });

  it("does not count someone below the required level as a holder", async () => {
    const skill = await requireSkill("Technical Product Selection", 4);
    const admin = await createUser({ email: "admin@test.dev", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const person = await createUser({ email: "person@test.dev", positionId: org.position.id });
    // Level 3 against a requirement of 4 is a gap, not coverage.
    await grant(person, skill.id, 3);

    const risks = await getKnowledgeRisks(await actorFor(admin));
    const risk = risks.find((r) => r.skillId === skill.id);

    expect(risk?.level).toBe("NOBODY");
  });

  it("ignores a skill no position requires, however few people hold it", async () => {
    // Created without a position requirement: valuable, perhaps, but its
    // absence is not a risk the platform can assert.
    const skill = await testPrisma.skill.create({ data: { name: "Bagpipes", category: "Other" } });
    const admin = await createUser({ email: "admin@test.dev", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const person = await createUser({ email: "person@test.dev", positionId: org.position.id });
    await grant(person, skill.id, 5);

    const risks = await getKnowledgeRisks(await actorFor(admin));
    expect(risks.map((r) => r.skillId)).not.toContain(skill.id);
  });

  it("excludes inactive people from the holder count", async () => {
    const skill = await requireSkill("Purchasing", 3);
    const admin = await createUser({ email: "admin@test.dev", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const leaver = await createUser({
      email: "leaver@test.dev",
      positionId: org.position.id,
      status: "INACTIVE",
    });
    await createUser({ email: "staying@test.dev", positionId: org.position.id });
    await grant(leaver, skill.id, 5);

    const risks = await getKnowledgeRisks(await actorFor(admin));
    const risk = risks.find((r) => r.skillId === skill.id);

    // The only holder has left, so the organization holds nothing.
    expect(risk?.level).toBe("NOBODY");
  });

  it("names published courses that would spread the skill", async () => {
    const skill = await requireSkill("Warehouse Receiving", 3);
    const admin = await createUser({ email: "admin@test.dev", roles: [ROLE_KEYS.SUPER_ADMIN] });
    await createUser({ email: "person@test.dev", positionId: org.position.id });

    const course = await createPublishedCourse({ title: "Receiving Fundamentals", createdById: admin });
    await testPrisma.courseSkill.create({
      data: { courseId: course.courseId, skillId: skill.id, levelValue: 3 },
    });

    const risks = await getKnowledgeRisks(await actorFor(admin));
    const risk = risks.find((r) => r.skillId === skill.id);

    expect(risk?.howToSpread.map((c) => c.title)).toContain("Receiving Fundamentals");
  });

  it("scopes a manager to their own reporting line", async () => {
    const skill = await requireSkill("Quoting", 3);
    const manager = await createUser({
      email: "manager@test.dev",
      roles: [ROLE_KEYS.MANAGER],
      positionId: org.position.id,
    });
    const report = await createUser({
      email: "report@test.dev",
      managerId: manager,
      positionId: org.position.id,
    });
    const stranger = await createUser({ email: "stranger@test.dev", positionId: org.position.id });

    // The only holder is outside the manager's subtree.
    await grant(stranger, skill.id, 5);

    const risks = await getKnowledgeRisks(await actorFor(manager));
    const risk = risks.find((r) => r.skillId === skill.id);

    // From this manager's vantage point nobody covers it, and the stranger is
    // never named.
    expect(risk?.level).toBe("NOBODY");
    expect(risk?.holders).toHaveLength(0);
    expect(report).toBeTruthy();
  });

  it("shows someone without team scope only their own coverage", async () => {
    const skill = await requireSkill("Excel", 2);
    // A contractor holds skills.view but not team.view, so their scope is
    // themselves — a colleague's proficiency must never be named to them.
    const contractor = await createUser({
      email: "contractor@test.dev",
      roles: [ROLE_KEYS.CONTRACTOR],
      positionId: org.position.id,
    });
    const colleague = await createUser({ email: "colleague@test.dev", positionId: org.position.id });
    await grant(colleague, skill.id, 5);

    const actor = await actorFor(contractor);
    expect(actor.permissions.has("skills.view")).toBe(true);
    expect(actor.permissions.has("team.view")).toBe(false);

    const risks = await getKnowledgeRisks(actor);
    const risk = risks.find((r) => r.skillId === skill.id);

    expect(risk?.holders).toHaveLength(0);
    expect(risk?.dependentCount).toBe(1);
  });

  it("treats two holders as thin but three as covered", async () => {
    const thin = await requireSkill("Order Processing", 2);
    const covered = await requireSkill("Customer Service", 2);
    const admin = await createUser({ email: "admin@test.dev", roles: [ROLE_KEYS.SUPER_ADMIN] });

    const people: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      people.push(await createUser({ email: `p${i}@test.dev`, positionId: org.position.id }));
    }
    await grant(people[0]!, thin.id, 3);
    await grant(people[1]!, thin.id, 3);
    for (const id of people) await grant(id, covered.id, 3);

    const risks = await getKnowledgeRisks(await actorFor(admin));

    expect(risks.find((r) => r.skillId === thin.id)?.level).toBe("THIN");
    // Three holders is above the default threshold, so it is not reported.
    expect(risks.map((r) => r.skillId)).not.toContain(covered.id);
  });
});

describe("Manager brief", () => {
  let org: Awaited<ReturnType<typeof createOrgFixture>>;

  beforeEach(async () => {
    await freshDatabase();
    org = await createOrgFixture();
  });

  /** A manager with one direct report, which is the shape every case needs. */
  async function managerWithReport(reportName = "Dana Reyes") {
    const manager = await createUser({
      email: "manager@test.dev",
      name: "Morgan Lee",
      roles: [ROLE_KEYS.MANAGER],
    });
    const report = await createUser({
      email: "report@test.dev",
      name: reportName,
      managerId: manager,
      positionId: org.position.id,
    });
    return { manager, report };
  }

  function daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  it("raises an overdue assignment and names the person and the item", async () => {
    const { manager, report } = await managerWithReport();
    const course = await createPublishedCourse({ title: "Cybersecurity Basics", createdById: manager });

    await testPrisma.assignment.create({
      data: {
        userId: report,
        targetType: "COURSE",
        courseId: course.courseId,
        status: "OVERDUE",
        assignedAt: daysAgo(40),
        dueAt: daysAgo(12),
      },
    });

    const brief = await getManagerBrief(await actorFor(manager));

    expect(brief.teamSize).toBe(1);
    expect(brief.totals.overdue).toBe(1);
    const item = brief.items[0]!;
    expect(item.reason).toBe("OVERDUE");
    expect(item.name).toBe("Dana Reyes");
    // The suggestion has to be usable as written, and address them by name.
    expect(item.suggestedConversation).toContain("Dana");
    expect(item.evidence.join(" ")).toContain("Cybersecurity Basics");
    expect(item.evidence.join(" ")).toMatch(/12 days past due/);
  });

  it("raises a started-then-abandoned assignment as stalled", async () => {
    const { manager, report } = await managerWithReport("Sam Okafor");
    const course = await createPublishedCourse({ title: "Quote Process", createdById: manager });

    await testPrisma.assignment.create({
      data: {
        userId: report,
        targetType: "COURSE",
        courseId: course.courseId,
        status: "IN_PROGRESS",
        assignedAt: daysAgo(30),
        startedAt: daysAgo(14),
        // Not yet due, so this is only visible as a stall.
        dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const brief = await getManagerBrief(await actorFor(manager));
    const item = brief.items[0]!;

    expect(item.reason).toBe("STALLED");
    expect(item.evidence.join(" ")).toMatch(/started 14 days ago/);
  });

  it("does not call a recently started assignment stalled", async () => {
    const { manager, report } = await managerWithReport();
    const course = await createPublishedCourse({ title: "Fresh Start", createdById: manager });

    await testPrisma.assignment.create({
      data: {
        userId: report,
        targetType: "COURSE",
        courseId: course.courseId,
        status: "IN_PROGRESS",
        assignedAt: daysAgo(3),
        startedAt: daysAgo(2),
        dueAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      },
    });

    const brief = await getManagerBrief(await actorFor(manager));
    expect(brief.totals.stalled).toBe(0);
    expect(brief.items).toHaveLength(0);
  });

  it("flags someone clear of everything as ready for more", async () => {
    const { manager, report } = await managerWithReport("Priya Raman");
    const course = await createPublishedCourse({ title: "Welcome", createdById: manager });

    await testPrisma.assignment.create({
      data: {
        userId: report,
        targetType: "COURSE",
        courseId: course.courseId,
        status: "COMPLETED",
        assignedAt: daysAgo(30),
        completedAt: daysAgo(2),
      },
    });

    const brief = await getManagerBrief(await actorFor(manager));
    const item = brief.items[0]!;

    expect(item.reason).toBe("READY_FOR_MORE");
    expect(item.suggestedConversation).toContain("Priya");
  });

  it("puts a pending sign-off ahead of an overdue item for the same person", async () => {
    const { manager, report } = await managerWithReport();
    const course = await createPublishedCourse({ title: "Practical Safety", createdById: manager });

    // Overdue as well, so the ordering rule is actually exercised.
    await testPrisma.assignment.create({
      data: {
        userId: report,
        targetType: "COURSE",
        courseId: course.courseId,
        status: "OVERDUE",
        assignedAt: daysAgo(40),
        dueAt: daysAgo(5),
      },
    });

    const section = await testPrisma.courseSection.create({
      data: { courseId: course.courseId, title: "Demonstration", order: 99 },
    });
    const lesson = await testPrisma.lesson.create({
      data: {
        sectionId: section.id,
        title: "Demonstrate a safe isolation",
        type: "MANAGER_SIGNOFF",
        order: 1,
        required: true,
        content: {},
      },
    });
    await testPrisma.lessonProgress.create({
      data: { userId: report, lessonId: lesson.id, courseId: course.courseId, status: "IN_PROGRESS" },
    });

    const brief = await getManagerBrief(await actorFor(manager));

    expect(brief.items).toHaveLength(1);
    const item = brief.items[0]!;
    expect(item.reason).toBe("AWAITING_SIGNOFF");
    expect(item.evidence.join(" ")).toContain("Demonstrate a safe isolation");
    // The manager is the blocker, and the wording should say so.
    expect(item.suggestedConversation).toMatch(/sign-off|blocked/i);
  });

  it("never includes the manager's own training in their brief", async () => {
    const { manager } = await managerWithReport();
    const course = await createPublishedCourse({ title: "Manager's Own Course", createdById: manager });

    await testPrisma.assignment.create({
      data: {
        userId: manager,
        targetType: "COURSE",
        courseId: course.courseId,
        status: "OVERDUE",
        assignedAt: daysAgo(40),
        dueAt: daysAgo(9),
      },
    });

    const brief = await getManagerBrief(await actorFor(manager));
    expect(brief.items.map((i) => i.userId)).not.toContain(manager);
  });

  it("never includes someone outside the manager's reporting line", async () => {
    const { manager } = await managerWithReport();
    const otherManager = await createUser({ email: "other@test.dev", roles: [ROLE_KEYS.MANAGER] });
    const stranger = await createUser({
      email: "stranger@test.dev",
      name: "Not Mine",
      managerId: otherManager,
      positionId: org.position.id,
    });
    const course = await createPublishedCourse({ title: "Someone Else's", createdById: manager });

    await testPrisma.assignment.create({
      data: {
        userId: stranger,
        targetType: "COURSE",
        courseId: course.courseId,
        status: "OVERDUE",
        assignedAt: daysAgo(40),
        dueAt: daysAgo(20),
      },
    });

    const brief = await getManagerBrief(await actorFor(manager));
    expect(brief.items.map((i) => i.name)).not.toContain("Not Mine");
  });

  it("returns an empty brief, not an error, for a manager with no reports", async () => {
    const manager = await createUser({ email: "lonely@test.dev", roles: [ROLE_KEYS.MANAGER] });
    const brief = await getManagerBrief(await actorFor(manager));

    expect(brief.teamSize).toBe(0);
    expect(brief.items).toHaveLength(0);
  });

  it("refuses an actor without team.view", async () => {
    const learner = await createUser({ email: "learner@test.dev", roles: [ROLE_KEYS.LEARNER] });
    const actor = await actorFor(learner);
    expect(actor.permissions.has("team.view")).toBe(false);

    await expect(getManagerBrief(actor)).rejects.toThrow();
  });
});

describe("Data scope does not escalate by combining roles", () => {
  beforeEach(async () => {
    await freshDatabase();
  });

  /*
   * A line manager sees their reporting line. An instructor sees the people
   * they teach. Holding both must not add up to seeing the whole organization —
   * scope is something you are granted, not something that falls out of a
   * combination of capabilities.
   */
  it("keeps a manager who also instructs scoped to their reporting line", async () => {
    const org = await createOrgFixture();
    const skill = await testPrisma.skill.create({ data: { name: "Control Valves", category: "Product" } });
    await testPrisma.positionSkillRequirement.create({
      data: { positionId: org.position.id, skillId: skill.id, requiredLevel: 3 },
    });

    const manager = await createUser({
      email: "teaching.manager@test.dev",
      name: "Teaching Manager",
      roles: [ROLE_KEYS.MANAGER, ROLE_KEYS.INSTRUCTOR, ROLE_KEYS.LEARNER],
    });
    await createUser({
      email: "direct.report@test.dev",
      name: "Direct Report",
      managerId: manager,
      positionId: org.position.id,
    });
    const outsider = await createUser({
      email: "outsider@test.dev",
      name: "Someone Elses Report",
      positionId: org.position.id,
    });
    await testPrisma.userSkill.create({
      data: { userId: outsider, skillId: skill.id, level: 5, source: "MANAGER_ASSESSMENT" },
    });

    const actor = await actorFor(manager);
    const brief = await getManagerBrief(actor);

    // One direct report, and the outsider is not in the brief.
    expect(brief.teamSize).toBe(1);
    expect(brief.items.map((i) => i.name)).not.toContain("Someone Elses Report");

    // Nor is the outsider named as covering a skill.
    const risks = await getKnowledgeRisks(actor);
    const risk = risks.find((r) => r.skillId === skill.id);
    expect(risk?.holders.map((h) => h.name)).not.toContain("Someone Elses Report");
  });
});
