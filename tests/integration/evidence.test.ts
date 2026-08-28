import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  createPublishedCourse,
  createPublishedSop,
  createUser,
  freshDatabase,
  testPrisma,
} from "./helpers";
import { ROLE_KEYS } from "@/lib/permissions";

/**
 * Training evidence must survive later changes to the content it refers to.
 *
 * These tests assert the guarantee an auditor actually cares about: that a
 * completion record still says what happened after the course was renamed,
 * restructured, or archived.
 */

beforeEach(async () => {
  await freshDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("completion records survive content changes", () => {
  it("keeps the recorded title after the course is renamed", async () => {
    const userId = await createUser({ email: "learner@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { courseId, versionId } = await createPublishedCourse({
      title: "Original Course Title",
      createdById: userId,
    });

    const record = await testPrisma.completionRecord.create({
      data: {
        userId,
        userSnapshot: { name: "Test Learner", email: "learner@test.local", employeeId: "E-1" },
        targetType: "COURSE",
        courseId,
        courseVersionId: versionId,
        titleSnapshot: "Original Course Title",
        versionLabel: "1.0",
        scorePercent: 92,
      },
      select: { id: true },
    });

    await testPrisma.course.update({
      where: { id: courseId },
      data: { title: "Completely Different Title" },
    });

    const after = await testPrisma.completionRecord.findUniqueOrThrow({
      where: { id: record.id },
      select: { titleSnapshot: true, versionLabel: true, scorePercent: true },
    });

    expect(after.titleSnapshot).toBe("Original Course Title");
    expect(after.versionLabel).toBe("1.0");
    expect(after.scorePercent).toBe(92);
  });

  it("keeps the person snapshot after the person is renamed", async () => {
    const userId = await createUser({
      email: "before@test.local",
      name: "Before Rename",
      roles: [ROLE_KEYS.LEARNER],
    });
    const { courseId, versionId } = await createPublishedCourse({
      title: "Course",
      createdById: userId,
    });

    const record = await testPrisma.completionRecord.create({
      data: {
        userId,
        userSnapshot: { name: "Before Rename", email: "before@test.local", employeeId: "E-9" },
        targetType: "COURSE",
        courseId,
        courseVersionId: versionId,
        titleSnapshot: "Course",
      },
      select: { id: true },
    });

    await testPrisma.user.update({
      where: { id: userId },
      data: { name: "After Rename", email: "after@test.local" },
    });

    const after = await testPrisma.completionRecord.findUniqueOrThrow({
      where: { id: record.id },
      select: { userSnapshot: true },
    });

    const snapshot = after.userSnapshot as { name: string; email: string };
    expect(snapshot.name).toBe("Before Rename");
    expect(snapshot.email).toBe("before@test.local");
  });

  it("survives archiving the course", async () => {
    const userId = await createUser({ email: "l2@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { courseId, versionId } = await createPublishedCourse({
      title: "To Be Archived",
      createdById: userId,
    });

    await testPrisma.completionRecord.create({
      data: {
        userId,
        userSnapshot: { name: "L", email: "l2@test.local" },
        targetType: "COURSE",
        courseId,
        courseVersionId: versionId,
        titleSnapshot: "To Be Archived",
      },
    });

    await testPrisma.course.update({
      where: { id: courseId },
      data: { status: "ARCHIVED", isDeleted: true },
    });

    const records = await testPrisma.completionRecord.findMany({
      where: { userId },
      select: { titleSnapshot: true },
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.titleSnapshot).toBe("To Be Archived");
  });

  it("keeps the immutable course version snapshot readable after lessons change", async () => {
    const userId = await createUser({ email: "l3@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { courseId, lessonId, versionId } = await createPublishedCourse({
      title: "Versioned",
      createdById: userId,
    });

    // Capture a real snapshot of the structure as published.
    const published = await testPrisma.lesson.findUniqueOrThrow({
      where: { id: lessonId },
      select: { title: true, content: true },
    });
    await testPrisma.courseVersion.update({
      where: { id: versionId },
      data: {
        snapshot: {
          title: "Versioned",
          sections: [{ title: "Section 1", lessons: [published] }],
        },
      },
    });

    // Now mutate the live lesson.
    await testPrisma.lesson.update({
      where: { id: lessonId },
      data: { title: "Renamed Lesson", content: { blocks: [] } },
    });

    const version = await testPrisma.courseVersion.findUniqueOrThrow({
      where: { id: versionId },
      select: { snapshot: true },
    });

    const snapshot = version.snapshot as {
      sections: { lessons: { title: string }[] }[];
    };
    expect(snapshot.sections[0]?.lessons[0]?.title).toBe("Lesson 1");
    expect(courseId).toBeTruthy();
  });
});

describe("acknowledgements bind to an exact version", () => {
  it("still points at the signed version after a new one publishes", async () => {
    const userId = await createUser({ email: "ack@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { sopId, versionId } = await createPublishedSop({
      code: "POL-100",
      title: "Policy v1",
      createdById: userId,
    });

    const statement =
      "I acknowledge that I have read and understand this policy.";

    const ack = await testPrisma.acknowledgement.create({
      data: {
        userId,
        statement,
        sopVersionId: versionId,
        signatureMethod: "typed_signature",
        typedSignature: "Test Learner",
        ipAddress: "203.0.113.9",
        userAgent: "test-agent",
      },
      select: { id: true },
    });

    // Publish version 2.0 and point the SOP at it.
    const v2 = await testPrisma.sopVersion.create({
      data: {
        sopId,
        versionNumber: "2.0",
        title: "Policy v2",
        blocks: [{ id: "b1", type: "paragraph", text: "Materially changed." }],
        meta: {},
        authorId: userId,
        isMaterial: true,
      },
      select: { id: true },
    });
    await testPrisma.sop.update({
      where: { id: sopId },
      data: { currentVersionId: v2.id, title: "Policy v2" },
    });

    const after = await testPrisma.acknowledgement.findUniqueOrThrow({
      where: { id: ack.id },
      select: {
        statement: true,
        sopVersionId: true,
        typedSignature: true,
        sopVersion: { select: { versionNumber: true, title: true } },
      },
    });

    // The acknowledgement still refers to 1.0, not the current 2.0.
    expect(after.sopVersionId).toBe(versionId);
    expect(after.sopVersion?.versionNumber).toBe("1.0");
    expect(after.sopVersion?.title).toBe("Policy v1");
    expect(after.statement).toBe(statement);
    expect(after.typedSignature).toBe("Test Learner");
  });

  it("records a second acknowledgement without overwriting the first", async () => {
    const userId = await createUser({ email: "ack2@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { sopId, versionId } = await createPublishedSop({
      code: "POL-101",
      title: "Policy",
      createdById: userId,
    });

    await testPrisma.acknowledgement.create({
      data: {
        userId,
        statement: "First acknowledgement.",
        sopVersionId: versionId,
        signatureMethod: "checkbox",
      },
    });

    const v2 = await testPrisma.sopVersion.create({
      data: {
        sopId,
        versionNumber: "2.0",
        title: "Policy",
        blocks: [],
        meta: {},
        authorId: userId,
      },
      select: { id: true },
    });

    await testPrisma.acknowledgement.create({
      data: {
        userId,
        statement: "Second acknowledgement after the material change.",
        sopVersionId: v2.id,
        signatureMethod: "checkbox",
      },
    });

    const all = await testPrisma.acknowledgement.findMany({
      where: { userId },
      orderBy: { acknowledgedAt: "asc" },
      select: { statement: true, sopVersion: { select: { versionNumber: true } } },
    });

    expect(all).toHaveLength(2);
    expect(all[0]?.sopVersion?.versionNumber).toBe("1.0");
    expect(all[1]?.sopVersion?.versionNumber).toBe("2.0");
  });
});

describe("SOP versions are immutable", () => {
  it("does not change a published version when the draft is edited", async () => {
    const userId = await createUser({ email: "author@test.local", roles: [ROLE_KEYS.CONTENT_AUTHOR] });
    const { sopId, versionId } = await createPublishedSop({
      code: "SOP-200",
      title: "Procedure",
      createdById: userId,
    });

    await testPrisma.sop.update({
      where: { id: sopId },
      data: {
        draftBlocks: [{ id: "new", type: "paragraph", text: "Draft edit that must not leak." }],
        title: "Procedure (edited draft)",
      },
    });

    const version = await testPrisma.sopVersion.findUniqueOrThrow({
      where: { id: versionId },
      select: { title: true, blocks: true },
    });

    expect(version.title).toBe("Procedure");
    const blocks = version.blocks as { text: string }[];
    expect(blocks[0]?.text).toBe("Procedure body for testing.");
  });

  it("enforces unique version numbers per SOP", async () => {
    const userId = await createUser({ email: "author2@test.local", roles: [ROLE_KEYS.CONTENT_AUTHOR] });
    const { sopId } = await createPublishedSop({
      code: "SOP-201",
      title: "Procedure",
      createdById: userId,
    });

    await expect(
      testPrisma.sopVersion.create({
        data: {
          sopId,
          versionNumber: "1.0", // already exists
          title: "Duplicate",
          blocks: [],
          meta: {},
          authorId: userId,
        },
      }),
    ).rejects.toThrow();
  });
});

describe("quiz attempts preserve what was asked", () => {
  it("keeps the question snapshot after the question is edited", async () => {
    const userId = await createUser({ email: "quiz@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { lessonId } = await createPublishedCourse({
      title: "Quiz Course",
      createdById: userId,
    });

    const question = await testPrisma.question.create({
      data: {
        lessonId,
        type: "MULTIPLE_CHOICE",
        order: 0,
        prompt: "Who approves a 25% discount?",
        config: { options: ["Representative", "Sales Manager"], correctIndex: 1 },
        points: 2,
      },
      select: { id: true },
    });

    const attempt = await testPrisma.quizAttempt.create({
      data: { userId, lessonId, attemptNumber: 1, status: "GRADED", scorePercent: 100 },
      select: { id: true },
    });

    await testPrisma.quizResponse.create({
      data: {
        attemptId: attempt.id,
        questionId: question.id,
        questionSnapshot: {
          prompt: "Who approves a 25% discount?",
          options: ["Representative", "Sales Manager"],
          correctIndex: 1,
        },
        answer: { selectedIndex: 1 },
        isCorrect: true,
        pointsEarned: 2,
      },
    });

    // Rewrite the live question entirely.
    await testPrisma.question.update({
      where: { id: question.id },
      data: {
        prompt: "An entirely different question",
        config: { options: ["A", "B", "C"], correctIndex: 2 },
      },
    });

    const response = await testPrisma.quizResponse.findFirstOrThrow({
      where: { attemptId: attempt.id },
      select: { questionSnapshot: true, isCorrect: true, pointsEarned: true },
    });

    const snapshot = response.questionSnapshot as { prompt: string; correctIndex: number };
    expect(snapshot.prompt).toBe("Who approves a 25% discount?");
    expect(snapshot.correctIndex).toBe(1);
    expect(response.isCorrect).toBe(true);
    expect(response.pointsEarned).toBe(2);
  });

  it("stores every attempt, not just the best one", async () => {
    const userId = await createUser({ email: "attempts@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { lessonId } = await createPublishedCourse({
      title: "Multi Attempt",
      createdById: userId,
    });

    for (const [index, score] of [40, 65, 88].entries()) {
      await testPrisma.quizAttempt.create({
        data: {
          userId,
          lessonId,
          attemptNumber: index + 1,
          status: score >= 80 ? "PASSED" : "FAILED",
          scorePercent: score,
        },
      });
    }

    const attempts = await testPrisma.quizAttempt.findMany({
      where: { userId, lessonId },
      orderBy: { attemptNumber: "asc" },
      select: { attemptNumber: true, scorePercent: true, status: true },
    });

    expect(attempts).toHaveLength(3);
    expect(attempts.map((a) => a.scorePercent)).toEqual([40, 65, 88]);
    expect(attempts[0]?.status).toBe("FAILED");
    expect(attempts[2]?.status).toBe("PASSED");
  });

  it("rejects a duplicate attempt number for the same lesson", async () => {
    const userId = await createUser({ email: "dupe@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { lessonId } = await createPublishedCourse({ title: "Dupe", createdById: userId });

    await testPrisma.quizAttempt.create({
      data: { userId, lessonId, attemptNumber: 1, status: "SUBMITTED" },
    });

    await expect(
      testPrisma.quizAttempt.create({
        data: { userId, lessonId, attemptNumber: 1, status: "SUBMITTED" },
      }),
    ).rejects.toThrow();
  });
});

describe("assignment idempotency is enforced by the database", () => {
  it("rejects a duplicate assignment for the same person and target", async () => {
    const userId = await createUser({ email: "assign@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { courseId } = await createPublishedCourse({ title: "Assigned", createdById: userId });

    await testPrisma.assignment.create({
      data: {
        userId,
        targetType: "COURSE",
        courseId,
        source: "RULE",
        reason: "Assigned because you are in the Sales department",
      },
    });

    // A second rule evaluation must not be able to create a duplicate.
    await expect(
      testPrisma.assignment.create({
        data: { userId, targetType: "COURSE", courseId, source: "RULE" },
      }),
    ).rejects.toThrow();

    const count = await testPrisma.assignment.count({ where: { userId, courseId } });
    expect(count).toBe(1);
  });

  it("records a human-readable reason", async () => {
    const userId = await createUser({ email: "reason@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { courseId } = await createPublishedCourse({ title: "Reasoned", createdById: userId });

    await testPrisma.assignment.create({
      data: {
        userId,
        targetType: "COURSE",
        courseId,
        source: "COMPLIANCE",
        reason: "Required annually for all personnel with system access",
      },
    });

    const assignment = await testPrisma.assignment.findFirstOrThrow({
      where: { userId, courseId },
      select: { reason: true, source: true },
    });

    expect(assignment.reason).toContain("Required annually");
    expect(assignment.source).toBe("COMPLIANCE");
  });
});

describe("certificates", () => {
  it("enforces unique certificate numbers", async () => {
    const userId = await createUser({ email: "cert@test.local", roles: [ROLE_KEYS.LEARNER] });

    await testPrisma.certificate.create({
      data: {
        certificateNumber: "FSW-2026-000001",
        userId,
        userNameSnapshot: "Test Learner",
        courseTitleSnapshot: "Course",
      },
    });

    await expect(
      testPrisma.certificate.create({
        data: {
          certificateNumber: "FSW-2026-000001",
          userId,
          userNameSnapshot: "Test Learner",
          courseTitleSnapshot: "Another Course",
        },
      }),
    ).rejects.toThrow();
  });

  it("keeps name and course snapshots after both change", async () => {
    const userId = await createUser({
      email: "certsnap@test.local",
      name: "Original Name",
      roles: [ROLE_KEYS.LEARNER],
    });

    const cert = await testPrisma.certificate.create({
      data: {
        certificateNumber: "FSW-2026-000002",
        userId,
        userNameSnapshot: "Original Name",
        courseTitleSnapshot: "Original Course",
      },
      select: { id: true },
    });

    await testPrisma.user.update({ where: { id: userId }, data: { name: "New Name" } });

    const after = await testPrisma.certificate.findUniqueOrThrow({
      where: { id: cert.id },
      select: { userNameSnapshot: true, courseTitleSnapshot: true },
    });

    expect(after.userNameSnapshot).toBe("Original Name");
    expect(after.courseTitleSnapshot).toBe("Original Course");
  });

  it("has no verification token unless one is explicitly set", async () => {
    const userId = await createUser({ email: "noverify@test.local", roles: [ROLE_KEYS.LEARNER] });

    const cert = await testPrisma.certificate.create({
      data: {
        certificateNumber: "FSW-2026-000003",
        userId,
        userNameSnapshot: "Learner",
        courseTitleSnapshot: "Course",
      },
      select: { verificationToken: true },
    });

    // Public verification is opt-in; the default must not be publicly checkable.
    expect(cert.verificationToken).toBeNull();
  });
});

describe("audit events", () => {
  it("records the actor, action, and entity for a high-risk operation", async () => {
    const actorId = await createUser({ email: "auditor2@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const subjectId = await createUser({ email: "subject@test.local", roles: [ROLE_KEYS.LEARNER] });

    await testPrisma.auditEvent.create({
      data: {
        actorId,
        actorEmail: "auditor2@test.local",
        action: "person.sensitive_view",
        entityType: "USER",
        entityId: subjectId,
        requestId: "req-123",
        ipAddress: "203.0.113.9",
        metadata: { fieldKey: "gov_id_last4" },
      },
    });

    const event = await testPrisma.auditEvent.findFirstOrThrow({
      where: { action: "person.sensitive_view" },
      select: {
        actorId: true,
        entityId: true,
        requestId: true,
        metadata: true,
        createdAt: true,
      },
    });

    expect(event.actorId).toBe(actorId);
    expect(event.entityId).toBe(subjectId);
    expect(event.requestId).toBe("req-123");
    expect(event.createdAt).toBeInstanceOf(Date);
  });

  it("survives deactivation of the subject", async () => {
    const actorId = await createUser({ email: "a3@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const subjectId = await createUser({ email: "s3@test.local", roles: [ROLE_KEYS.LEARNER] });

    await testPrisma.auditEvent.create({
      data: { actorId, action: "person.deactivated", entityType: "USER", entityId: subjectId },
    });

    await testPrisma.user.update({
      where: { id: subjectId },
      data: { status: "INACTIVE", deactivatedAt: new Date() },
    });

    const events = await testPrisma.auditEvent.findMany({
      where: { entityId: subjectId },
      select: { action: true },
    });

    expect(events.map((e) => e.action)).toContain("person.deactivated");
  });
});
