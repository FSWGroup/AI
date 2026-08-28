import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { actorFor, createUser, freshDatabase, testPrisma } from "./helpers";
import { ROLE_KEYS } from "@/lib/permissions";
import {
  analyzeChangeImpact,
  compareVersions,
  getSingleSopHealthScore,
  createSop,
  getSopForReader,
  listSopVersions,
  publishSop,
  reportOutdated,
  restoreSopVersion,
  updateSopDraft,
} from "@/lib/services/sop";

/**
 * The SOP lifecycle: draft, publish, version, revise, restore.
 *
 * Version history is the part of this platform an auditor leans on, so these
 * tests check that publishing produces an immutable snapshot, that editing the
 * draft cannot reach a published version, and that version numbering
 * distinguishes a material change from a correction.
 */

const BLOCKS = [
  { id: "h1", type: "heading" as const, level: 2 as const, text: "Procedure" },
  { id: "p1", type: "paragraph" as const, text: "Open the ERP and start a new quote." },
];

const META = {
  purpose: "Ensure every quote is complete and traceable.",
  scope: "All Inside Sales personnel.",
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

beforeEach(async () => {
  await freshDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

async function draftSop(actorUserId: string, title = "Create a Customer Quote") {
  const actor = await actorFor(actorUserId);
  const sop = await createSop(actor, {
    title,
    codePrefix: "SALES",
    kind: "SOP",
    language: "en",
    summary: "How to build and send a customer quote.",
    reviewCycleDays: 180,
    ownerId: actorUserId,
  });
  await updateSopDraft(actor, sop.id, { blocks: BLOCKS, meta: META });
  return { actor, sopId: sop.id };
}

describe("SOP codes", () => {
  it("generates a sequential code for a prefix", async () => {
    const admin = await createUser({ email: "admin@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const actor = await actorFor(admin);

    const first = await createSop(actor, {
      title: "First Procedure",
      codePrefix: "OPS",
      kind: "SOP",
      language: "en",
    });
    const second = await createSop(actor, {
      title: "Second Procedure",
      codePrefix: "OPS",
      kind: "SOP",
      language: "en",
    });

    expect(first.sopCode).toMatch(/^OPS-\d{3}$/);
    expect(second.sopCode).toMatch(/^OPS-\d{3}$/);
    expect(second.sopCode).not.toBe(first.sopCode);

    const numbers = [first.sopCode, second.sopCode].map((code) => Number(code.split("-")[1]));
    expect(Math.max(...numbers) - Math.min(...numbers)).toBe(1);
  });

  it("keeps separate sequences per prefix", async () => {
    const admin = await createUser({ email: "admin2@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const actor = await actorFor(admin);

    await createSop(actor, { title: "Ops One", codePrefix: "OPS", kind: "SOP", language: "en" });
    const sales = await createSop(actor, {
      title: "Sales One",
      codePrefix: "SALES",
      kind: "SOP",
      language: "en",
    });

    expect(sales.sopCode).toBe("SALES-001");
  });
});

describe("publishing creates an immutable version", () => {
  it("starts at 1.0 and points the SOP at it", async () => {
    const admin = await createUser({ email: "admin3@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { actor, sopId } = await draftSop(admin);

    await publishSop(actor, sopId, { changeSummary: "Initial publication.", isMaterial: true });

    const sop = await testPrisma.sop.findUniqueOrThrow({
      where: { id: sopId },
      select: {
        status: true,
        currentVersion: { select: { versionNumber: true, changeSummary: true, blocks: true } },
        lastReviewedAt: true,
        nextReviewAt: true,
      },
    });

    expect(sop.status).toBe("PUBLISHED");
    expect(sop.currentVersion?.versionNumber).toBe("1.0");
    expect(sop.currentVersion?.changeSummary).toBe("Initial publication.");
    expect(sop.lastReviewedAt).toBeInstanceOf(Date);
    // The review cycle of 180 days should put the next review roughly six
    // months out, not at an arbitrary date.
    const days =
      (sop.nextReviewAt!.getTime() - sop.lastReviewedAt!.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(170);
    expect(days).toBeLessThan(190);
  });

  it("bumps the major version for a material change and the minor for a correction", async () => {
    const admin = await createUser({ email: "admin4@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { actor, sopId } = await draftSop(admin);

    await publishSop(actor, sopId, { isMaterial: true });

    await updateSopDraft(actor, sopId, {
      blocks: [...BLOCKS, { id: "p2", type: "paragraph", text: "A materially new step." }],
      meta: META,
    });
    await publishSop(actor, sopId, { changeSummary: "Added a required step.", isMaterial: true });

    let sop = await testPrisma.sop.findUniqueOrThrow({
      where: { id: sopId },
      select: { currentVersion: { select: { versionNumber: true } } },
    });
    expect(sop.currentVersion?.versionNumber).toBe("2.0");

    await updateSopDraft(actor, sopId, {
      blocks: [...BLOCKS, { id: "p2", type: "paragraph", text: "A materially new step (typo fixed)." }],
      meta: META,
    });
    await publishSop(actor, sopId, { changeSummary: "Typo.", isMaterial: false });

    sop = await testPrisma.sop.findUniqueOrThrow({
      where: { id: sopId },
      select: { currentVersion: { select: { versionNumber: true } } },
    });
    expect(sop.currentVersion?.versionNumber).toBe("2.1");
  });

  it("does not let a draft edit reach a published version", async () => {
    const admin = await createUser({ email: "admin5@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { actor, sopId } = await draftSop(admin);
    await publishSop(actor, sopId, { isMaterial: true });

    const before = await testPrisma.sopVersion.findFirstOrThrow({
      where: { sopId, versionNumber: "1.0" },
      select: { id: true, blocks: true },
    });

    await updateSopDraft(actor, sopId, {
      blocks: [{ id: "x", type: "paragraph", text: "Unpublished draft text." }],
      meta: META,
    });

    const after = await testPrisma.sopVersion.findUniqueOrThrow({
      where: { id: before.id },
      select: { blocks: true },
    });

    expect(JSON.stringify(after.blocks)).toBe(JSON.stringify(before.blocks));
    expect(JSON.stringify(after.blocks)).not.toContain("Unpublished draft text");
  });

  it("keeps every version in history", async () => {
    const admin = await createUser({ email: "admin6@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { actor, sopId } = await draftSop(admin);

    await publishSop(actor, sopId, { isMaterial: true });
    await updateSopDraft(actor, sopId, {
      blocks: [...BLOCKS, { id: "p2", type: "paragraph", text: "Second revision." }],
      meta: META,
    });
    await publishSop(actor, sopId, { isMaterial: true });

    const versions = await listSopVersions(sopId);
    expect(versions.length).toBe(2);
    expect(versions.map((v) => v.versionNumber).sort()).toEqual(["1.0", "2.0"]);
  });

  it("refuses to publish without the sop.publish capability", async () => {
    const author = await createUser({
      email: "author@test.local",
      roles: [ROLE_KEYS.CONTENT_AUTHOR],
    });
    const { sopId } = await draftSop(author);
    const authorActor = await actorFor(author);

    // A content author can draft but must not be able to publish.
    expect(authorActor.permissions.has("sop.publish")).toBe(false);
    await expect(publishSop(authorActor, sopId, { isMaterial: true })).rejects.toThrow();

    const sop = await testPrisma.sop.findUniqueOrThrow({
      where: { id: sopId },
      select: { status: true, currentVersionId: true },
    });
    expect(sop.status).not.toBe("PUBLISHED");
    expect(sop.currentVersionId).toBeNull();
  });
});

describe("version comparison and restore", () => {
  it("reports what changed between two versions", async () => {
    const admin = await createUser({ email: "admin7@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { actor, sopId } = await draftSop(admin);
    await publishSop(actor, sopId, { isMaterial: true });

    await updateSopDraft(actor, sopId, {
      blocks: [
        { id: "h1", type: "heading", level: 2, text: "Procedure" },
        { id: "p1", type: "paragraph", text: "Open the ERP and start a new quote for the account." },
        { id: "p3", type: "paragraph", text: "Confirm the ship-to location." },
      ],
      meta: META,
    });
    await publishSop(actor, sopId, { isMaterial: true });

    const versions = await listSopVersions(sopId);
    const v1 = versions.find((v) => v.versionNumber === "1.0");
    const v2 = versions.find((v) => v.versionNumber === "2.0");
    expect(v1 && v2).toBeTruthy();

    const diff = await compareVersions(sopId, v1!.id, v2!.id);

    // p3 is new, p1 changed, h1 is unchanged.
    expect(diff.added.some((b) => b.blockId === "p3")).toBe(true);
    expect(diff.changed.some((b) => b.blockId === "p1")).toBe(true);
    expect(diff.unchangedCount).toBeGreaterThan(0);

    // The diff carries readable before/after text, not just ids.
    const changedP1 = diff.changed.find((b) => b.blockId === "p1");
    expect(changedP1?.beforeText).toContain("start a new quote");
    expect(changedP1?.afterText).toContain("for the account");
  });

  it("restores an old version into the draft without mutating history", async () => {
    const admin = await createUser({ email: "admin8@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { actor, sopId } = await draftSop(admin);
    await publishSop(actor, sopId, { isMaterial: true });

    await updateSopDraft(actor, sopId, {
      blocks: [{ id: "new", type: "paragraph", text: "A revision we want to undo." }],
      meta: META,
    });
    await publishSop(actor, sopId, { isMaterial: true });

    const versions = await listSopVersions(sopId);
    const v1 = versions.find((v) => v.versionNumber === "1.0")!;

    await restoreSopVersion(actor, sopId, v1.id);

    const sop = await testPrisma.sop.findUniqueOrThrow({
      where: { id: sopId },
      select: { draftBlocks: true, currentVersion: { select: { versionNumber: true } } },
    });

    // The draft now holds 1.0's content, but 2.0 is still the published version
    // and both historical versions still exist.
    expect(JSON.stringify(sop.draftBlocks)).toContain("Open the ERP");
    expect(sop.currentVersion?.versionNumber).toBe("2.0");
    expect((await listSopVersions(sopId)).length).toBe(2);
  });
});

describe("the reader sees only what it should", () => {
  it("returns the published version to a learner", async () => {
    const admin = await createUser({ email: "admin9@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const learner = await createUser({ email: "learner@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { actor, sopId } = await draftSop(admin);
    await publishSop(actor, sopId, { isMaterial: true });

    const result = await getSopForReader(await actorFor(learner), sopId);
    expect(result).toBeTruthy();
    expect(result?.versionNumber).toBe("1.0");
    expect(JSON.stringify(result?.blocks)).toContain("Open the ERP");
  });

  it("does not return an unpublished SOP to a learner", async () => {
    const admin = await createUser({ email: "admin10@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const learner = await createUser({ email: "learner2@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { sopId } = await draftSop(admin);

    const result = await getSopForReader(await actorFor(learner), sopId);
    expect(result).toBeNull();
  });

  it("records that the SOP was viewed", async () => {
    const admin = await createUser({ email: "admin11@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const learner = await createUser({ email: "learner3@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { actor, sopId } = await draftSop(admin);
    await publishSop(actor, sopId, { isMaterial: true });

    await getSopForReader(await actorFor(learner), sopId);

    const views = await testPrisma.contentView.count({
      where: { userId: learner, entityType: "SOP", entityId: sopId },
    });
    expect(views).toBeGreaterThan(0);
  });
});

describe("change impact analysis", () => {
  it("counts the courses and people a change affects", async () => {
    const admin = await createUser({ email: "admin12@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const learner = await createUser({ email: "learner4@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { actor, sopId } = await draftSop(admin);
    await publishSop(actor, sopId, { isMaterial: true });

    // A course that teaches this SOP.
    const course = await testPrisma.course.create({
      data: { title: "The Customer Quote Process", status: "PUBLISHED", createdById: admin },
      select: { id: true },
    });
    const section = await testPrisma.courseSection.create({
      data: { courseId: course.id, title: "The procedure", order: 0 },
      select: { id: true },
    });
    await testPrisma.lesson.create({
      data: {
        sectionId: section.id,
        title: "Read the quoting SOP",
        type: "SOP_REF",
        order: 0,
        content: { sopId },
      },
    });

    // Someone who already acknowledged version 1.0.
    const version = await testPrisma.sopVersion.findFirstOrThrow({
      where: { sopId, versionNumber: "1.0" },
      select: { id: true },
    });
    await testPrisma.acknowledgement.create({
      data: {
        userId: learner,
        statement: "I acknowledge that I have read and understand this procedure.",
        sopVersionId: version.id,
        signatureMethod: "checkbox",
      },
    });

    const impact = await analyzeChangeImpact(actor, sopId);

    expect(impact.courses.length).toBeGreaterThan(0);
    expect(impact.courses.some((c) => c.title.includes("Quote"))).toBe(true);
    expect(impact.userCount).toBeGreaterThan(0);
  });
});

describe("content health score explains itself", () => {
  it("scores a well-maintained SOP highly and lists the factors", async () => {
    const admin = await createUser({ email: "admin13@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { actor, sopId } = await draftSop(admin);
    await publishSop(actor, sopId, { isMaterial: true });

    const health = await getSingleSopHealthScore(sopId);
    expect(health).toBeTruthy();
    expect(health!.score).toBeGreaterThan(60);
    expect(health!.factors.length).toBeGreaterThan(0);
    // The score must never be mysterious — every factor states what it measured.
    for (const factor of health!.factors) {
      expect(factor.label).toBeTruthy();
      expect(typeof factor.met).toBe("boolean");
      expect(factor.weight).toBeGreaterThan(0);
    }
  });

  it("penalizes an SOP with open outdated reports", async () => {
    const admin = await createUser({ email: "admin14@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const learner = await createUser({ email: "learner5@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { actor, sopId } = await draftSop(admin);
    await publishSop(actor, sopId, { isMaterial: true });

    const before = await getSingleSopHealthScore(sopId);

    await reportOutdated(
      await actorFor(learner),
      sopId,
      "Step 4 references a screen that no longer exists in the ERP.",
    );

    const after = await getSingleSopHealthScore(sopId);

    expect(after!.score).toBeLessThan(before!.score);
  });

  it("penalizes an SOP with no owner", async () => {
    const admin = await createUser({ email: "admin15@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const { actor, sopId } = await draftSop(admin);
    await publishSop(actor, sopId, { isMaterial: true });

    const withOwner = await getSingleSopHealthScore(sopId);

    await testPrisma.sop.update({ where: { id: sopId }, data: { ownerId: null } });

    const withoutOwner = await getSingleSopHealthScore(sopId);

    expect(withoutOwner!.score).toBeLessThan(withOwner!.score);
    expect(withoutOwner!.factors.some((f) => !f.met && /owner/i.test(f.label))).toBe(true);
    expect(actor).toBeTruthy();
  });
});

describe("reporting outdated information", () => {
  it("records the report and notifies the owner", async () => {
    const owner = await createUser({ email: "owner@test.local", roles: [ROLE_KEYS.SUPER_ADMIN] });
    const learner = await createUser({ email: "reporter@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { actor, sopId } = await draftSop(owner);
    await publishSop(actor, sopId, { isMaterial: true });

    await reportOutdated(
      await actorFor(learner),
      sopId,
      "The discount authority table is out of date.",
    );

    const report = await testPrisma.outdatedReport.findFirstOrThrow({
      where: { sopId },
      select: { reporterId: true, reason: true, status: true },
    });

    expect(report.reporterId).toBe(learner);
    expect(report.reason).toContain("discount authority");
    expect(report.status).toBe("OPEN");

    const notified = await testPrisma.notification.count({ where: { userId: owner } });
    expect(notified).toBeGreaterThan(0);
  });
});
