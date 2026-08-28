import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  actorFor,
  createPublishedCourse,
  createPublishedSop,
  createUser,
  freshDatabase,
  testPrisma,
} from "./helpers";
import { ROLE_KEYS } from "@/lib/permissions";
import { AUDIT_ACTIONS } from "@/lib/audit";
import {
  completeCourse,
  overrideCompletion,
  recordAcknowledgement,
  recordLessonProgress,
} from "@/lib/services/completion";

/**
 * Completion evidence.
 *
 * A completion record is the artefact that answers "was this person trained?"
 * months later, after the course has been edited or retired. These tests verify
 * the properties that make it trustworthy: it cannot be produced without doing
 * the work, it cannot be produced twice, an override is permanently
 * distinguishable, and an acknowledgement records exactly what was agreed to.
 */

beforeEach(async () => {
  await freshDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("completing a course", () => {
  it("refuses to complete while a required lesson is outstanding", async () => {
    const admin = await createUser({ email: "admin@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const learner = await createUser({ email: "learner@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { courseId } = await createPublishedCourse({
      title: "Cybersecurity Fundamentals",
      createdById: admin,
    });

    const actor = await actorFor(learner);
    await expect(completeCourse(actor, courseId)).rejects.toThrow();

    const records = await testPrisma.completionRecord.count({ where: { userId: learner, courseId } });
    expect(records).toBe(0);
  });

  it("writes a full evidence record once the work is done", async () => {
    const admin = await createUser({ email: "admin2@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const learner = await createUser({
      email: "learner2@test.local",
      name: "Jordan Pace",
      roles: [ROLE_KEYS.LEARNER],
    });
    const { courseId, lessonId } = await createPublishedCourse({
      title: "Cybersecurity Fundamentals",
      createdById: admin,
    });

    await testPrisma.user.update({
      where: { id: learner },
      data: { employeeId: "FSW-0011" },
    });

    const actor = await actorFor(learner);
    await recordLessonProgress(actor, lessonId, { markComplete: true });
    await completeCourse(actor, courseId);

    const record = await testPrisma.completionRecord.findFirstOrThrow({
      where: { userId: learner, courseId },
      select: {
        userSnapshot: true,
        titleSnapshot: true,
        versionLabel: true,
        courseVersionId: true,
        completedAt: true,
        certificateId: true,
        overriddenById: true,
      },
    });

    const snapshot = record.userSnapshot as { name?: string; email?: string; employeeId?: string };
    expect(snapshot.name).toBe("Jordan Pace");
    expect(snapshot.email).toBe("learner2@test.local");
    expect(snapshot.employeeId).toBe("FSW-0011");

    expect(record.titleSnapshot).toBe("Cybersecurity Fundamentals");
    expect(record.versionLabel).toBe("1.0");
    expect(record.courseVersionId).toBeTruthy();
    expect(record.completedAt).toBeInstanceOf(Date);
    // A genuine completion is not an override.
    expect(record.overriddenById).toBeNull();
  });

  it("issues a certificate on completion", async () => {
    const admin = await createUser({ email: "admin3@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const learner = await createUser({ email: "learner3@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { courseId, lessonId } = await createPublishedCourse({
      title: "Warehouse Safety",
      createdById: admin,
    });

    const actor = await actorFor(learner);
    await recordLessonProgress(actor, lessonId, { markComplete: true });
    await completeCourse(actor, courseId);

    const certificate = await testPrisma.certificate.findFirstOrThrow({
      where: { userId: learner },
      select: { certificateNumber: true, courseTitleSnapshot: true, userNameSnapshot: true },
    });

    expect(certificate.certificateNumber).toMatch(/^FSW-\d{4}-\d+$/);
    expect(certificate.courseTitleSnapshot).toBe("Warehouse Safety");
    expect(certificate.userNameSnapshot).toBeTruthy();
  });

  it("sets an expiry when the course requires recertification", async () => {
    const admin = await createUser({ email: "admin4@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const learner = await createUser({ email: "learner4@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { courseId, lessonId } = await createPublishedCourse({
      title: "Annual Compliance",
      createdById: admin,
      recertifyMonths: 12,
    });

    const actor = await actorFor(learner);
    await recordLessonProgress(actor, lessonId, { markComplete: true });
    await completeCourse(actor, courseId);

    const record = await testPrisma.completionRecord.findFirstOrThrow({
      where: { userId: learner, courseId },
      select: { completedAt: true, expiresAt: true },
    });

    expect(record.expiresAt).toBeInstanceOf(Date);
    const months =
      (record.expiresAt!.getTime() - record.completedAt.getTime()) / (30.44 * 24 * 3600 * 1000);
    expect(months).toBeGreaterThan(11);
    expect(months).toBeLessThan(13);
  });

  it("leaves no expiry when the course does not expire", async () => {
    const admin = await createUser({ email: "admin5@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const learner = await createUser({ email: "learner5@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { courseId, lessonId } = await createPublishedCourse({
      title: "One Off",
      createdById: admin,
      recertifyMonths: undefined,
    });

    const actor = await actorFor(learner);
    await recordLessonProgress(actor, lessonId, { markComplete: true });
    await completeCourse(actor, courseId);

    const record = await testPrisma.completionRecord.findFirstOrThrow({
      where: { userId: learner, courseId },
      select: { expiresAt: true },
    });
    expect(record.expiresAt).toBeNull();
  });

  it("is idempotent — completing twice does not duplicate the record", async () => {
    const admin = await createUser({ email: "admin6@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const learner = await createUser({ email: "learner6@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { courseId, lessonId } = await createPublishedCourse({
      title: "Idempotent",
      createdById: admin,
    });

    const actor = await actorFor(learner);
    await recordLessonProgress(actor, lessonId, { markComplete: true });

    await completeCourse(actor, courseId);
    await completeCourse(actor, courseId);
    await completeCourse(actor, courseId);

    expect(await testPrisma.completionRecord.count({ where: { userId: learner, courseId } })).toBe(1);
    expect(await testPrisma.certificate.count({ where: { userId: learner } })).toBe(1);
  });

  it("marks the assignment complete", async () => {
    const admin = await createUser({ email: "admin7@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const learner = await createUser({ email: "learner7@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { courseId, lessonId } = await createPublishedCourse({
      title: "Assigned Course",
      createdById: admin,
    });

    await testPrisma.assignment.create({
      data: {
        userId: learner,
        targetType: "COURSE",
        courseId,
        source: "RULE",
        reason: "Assigned because you are in the Sales department",
      },
    });

    const actor = await actorFor(learner);
    await recordLessonProgress(actor, lessonId, { markComplete: true });
    await completeCourse(actor, courseId);

    const assignment = await testPrisma.assignment.findFirstOrThrow({
      where: { userId: learner, courseId },
      select: { status: true, completedAt: true },
    });
    expect(assignment.status).toBe("COMPLETED");
    expect(assignment.completedAt).toBeInstanceOf(Date);
  });
});

describe("completion override", () => {
  it("requires the override capability", async () => {
    const manager = await createUser({ email: "manager@test.local", roles: [ROLE_KEYS.MANAGER] });
    const learner = await createUser({ email: "learner8@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { courseId } = await createPublishedCourse({ title: "Gated", createdById: manager });

    const managerActor = await actorFor(manager);
    // A manager can support their team but must not be able to mark training
    // complete on their behalf.
    expect(managerActor.permissions.has("training.complete_override")).toBe(false);
    await expect(
      overrideCompletion(managerActor, learner, courseId, "They did it in person."),
    ).rejects.toThrow();
  });

  it("requires a stated reason", async () => {
    const admin = await createUser({ email: "admin8@test.local", roles: [ROLE_KEYS.TRAINING_ADMIN] });
    const learner = await createUser({ email: "learner9@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { courseId } = await createPublishedCourse({ title: "Reasoned", createdById: admin });

    const actor = await actorFor(admin);
    await expect(overrideCompletion(actor, learner, courseId, "   ")).rejects.toThrow(/reason/i);
  });

  it("records who overrode it, permanently", async () => {
    const admin = await createUser({ email: "admin9@test.local", roles: [ROLE_KEYS.TRAINING_ADMIN] });
    const learner = await createUser({ email: "learner10@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { courseId } = await createPublishedCourse({
      title: "Overridden Course",
      createdById: admin,
    });

    const actor = await actorFor(admin);
    await overrideCompletion(
      actor,
      learner,
      courseId,
      "Completed in a classroom session on 12 August; attendance sheet filed.",
    );

    const record = await testPrisma.completionRecord.findFirstOrThrow({
      where: { userId: learner, courseId },
      select: { overriddenById: true, titleSnapshot: true },
    });

    // An override is a legitimate action, but it must never look like a normal
    // completion afterwards.
    expect(record.overriddenById).toBe(admin);
    expect(record.titleSnapshot).toBe("Overridden Course");
  });

  it("writes an audit event naming the reason", async () => {
    const admin = await createUser({ email: "admin10@test.local", roles: [ROLE_KEYS.TRAINING_ADMIN] });
    const learner = await createUser({ email: "learner11@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { courseId } = await createPublishedCourse({ title: "Audited", createdById: admin });

    const actor = await actorFor(admin);
    await overrideCompletion(actor, learner, courseId, "Verified against the vendor's certificate.");

    const events = await testPrisma.auditEvent.findMany({
      where: { action: AUDIT_ACTIONS.COMPLETION_OVERRIDDEN },
      select: { actorId: true, entityId: true, metadata: true },
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.actorId).toBe(admin);
    expect(events[0]?.entityId).toBe(courseId);

    // The stated reason is part of the record — an override without a rationale
    // is not auditable.
    const metadata = events[0]?.metadata as { userId?: string; reason?: string } | null;
    expect(metadata?.userId).toBe(learner);
    expect(metadata?.reason).toContain("vendor's certificate");
  });
});

describe("electronic acknowledgements", () => {
  it("records the exact statement, version, and signature metadata", async () => {
    const admin = await createUser({ email: "admin11@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const learner = await createUser({ email: "learner12@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { versionId } = await createPublishedSop({
      code: "POL-900",
      title: "Acceptable Use of Company Technology",
      createdById: admin,
    });

    const statement =
      "I acknowledge that I have read and understand the Acceptable Use of Company " +
      "Technology policy, and I understand my responsibility to report suspected " +
      "security incidents immediately.";

    const actor = await actorFor(learner);
    await recordAcknowledgement(actor, {
      statement,
      sopVersionId: versionId,
      typedSignature: "Jordan Pace",
      ip: "203.0.113.42",
      userAgent: "Mozilla/5.0 (Macintosh)",
    });

    const ack = await testPrisma.acknowledgement.findFirstOrThrow({
      where: { userId: learner },
      select: {
        statement: true,
        sopVersionId: true,
        signatureMethod: true,
        typedSignature: true,
        ipAddress: true,
        userAgent: true,
        acknowledgedAt: true,
      },
    });

    // The exact wording agreed to must be preserved, not a reference to it.
    expect(ack.statement).toBe(statement);
    expect(ack.sopVersionId).toBe(versionId);
    expect(ack.signatureMethod).toBe("typed_signature");
    expect(ack.typedSignature).toBe("Jordan Pace");
    expect(ack.ipAddress).toBe("203.0.113.42");
    expect(ack.userAgent).toContain("Mozilla");
    expect(ack.acknowledgedAt).toBeInstanceOf(Date);
  });

  it("records a checkbox acknowledgement when no signature is typed", async () => {
    const admin = await createUser({ email: "admin12@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const learner = await createUser({ email: "learner13@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { versionId } = await createPublishedSop({
      code: "POL-901",
      title: "Policy",
      createdById: admin,
    });

    const actor = await actorFor(learner);
    await recordAcknowledgement(actor, {
      statement: "I acknowledge that I have read and understand this policy.",
      sopVersionId: versionId,
    });

    const ack = await testPrisma.acknowledgement.findFirstOrThrow({
      where: { userId: learner },
      select: { signatureMethod: true, typedSignature: true },
    });
    expect(ack.signatureMethod).toBe("checkbox");
    expect(ack.typedSignature).toBeNull();
  });

  it("rejects an empty statement", async () => {
    const learner = await createUser({ email: "learner14@test.local", roles: [ROLE_KEYS.LEARNER] });
    const actor = await actorFor(learner);

    await expect(recordAcknowledgement(actor, { statement: "   " })).rejects.toThrow();
    expect(await testPrisma.acknowledgement.count({ where: { userId: learner } })).toBe(0);
  });

  it("appends rather than overwriting when the same policy is re-acknowledged", async () => {
    const admin = await createUser({ email: "admin13@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const learner = await createUser({ email: "learner15@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { sopId, versionId } = await createPublishedSop({
      code: "POL-902",
      title: "Policy",
      createdById: admin,
    });

    const actor = await actorFor(learner);
    await recordAcknowledgement(actor, {
      statement: "I acknowledge version 1.0.",
      sopVersionId: versionId,
    });

    // A material revision requires a fresh acknowledgement.
    const v2 = await testPrisma.sopVersion.create({
      data: {
        sopId,
        versionNumber: "2.0",
        title: "Policy",
        blocks: [],
        meta: {},
        authorId: admin,
        isMaterial: true,
      },
      select: { id: true },
    });

    await recordAcknowledgement(actor, {
      statement: "I acknowledge version 2.0.",
      sopVersionId: v2.id,
    });

    const all = await testPrisma.acknowledgement.findMany({
      where: { userId: learner },
      orderBy: { acknowledgedAt: "asc" },
      select: { statement: true, sopVersion: { select: { versionNumber: true } } },
    });

    // Both remain: the history of what was agreed to, and when, is intact.
    expect(all).toHaveLength(2);
    expect(all[0]?.sopVersion?.versionNumber).toBe("1.0");
    expect(all[1]?.sopVersion?.versionNumber).toBe("2.0");
    expect(all[0]?.statement).toContain("1.0");
    expect(all[1]?.statement).toContain("2.0");
  });
});
