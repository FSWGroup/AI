import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  actorFor,
  createOrgFixture,
  createPublishedCourse,
  createPublishedSop,
  createUser,
  freshDatabase,
  testPrisma,
} from "./helpers";
import { ROLE_KEYS } from "@/lib/permissions";
import { AuthorizationError } from "@/lib/auth/scope";
import { retrieve } from "@/lib/ai/rag";
import {
  archiveNearMiss,
  getNearMissForReview,
  getNearMissQueue,
  getNearMissStats,
  getNearMissesForCourse,
  getNearMissesForSop,
  getPublishedNearMiss,
  getPublishedNearMisses,
  NearMissValidationError,
  publishNearMiss,
  reopenNearMiss,
  reportNearMiss,
  saveNearMissReview,
} from "@/lib/services/near-miss";

/**
 * The near-miss library.
 *
 * The feature only works if people believe three things, so those three are
 * what is tested here rather than the CRUD around them:
 *
 *   1. An anonymous report cannot be traced back to its author — not through
 *      the record, not through a published read, not through the audit log.
 *   2. Nothing reaches the library, or the AI, until a human publishes it.
 *   3. A published case study cannot name a colleague, because publication is
 *      refused while it does.
 */

const NARRATIVE =
  "A 150# flange was picked for a 300# service. The packer noticed the gasket would not seat and stopped the shipment before it left the dock.";

async function fixture() {
  const org = await createOrgFixture();
  const reporterId = await createUser({
    email: "reporter@test.local",
    name: "Dana Whitlock",
    roles: [ROLE_KEYS.LEARNER],
    departmentId: org.department.id,
    businessUnitId: org.businessUnit.id,
  });
  const reviewerId = await createUser({
    email: "reviewer@test.local",
    name: "Rowan Vestal",
    roles: [ROLE_KEYS.COMPLIANCE_ADMIN],
  });
  const contractorId = await createUser({
    email: "contractor@test.local",
    name: "Ellis Trant",
    roles: [ROLE_KEYS.CONTRACTOR],
    businessUnitId: org.businessUnit.id,
  });
  return {
    org,
    reporter: await actorFor(reporterId),
    reviewer: await actorFor(reviewerId),
    contractor: await actorFor(contractorId),
  };
}

/** Report, review and publish in one go, for tests about the published state. */
async function publishedCaseStudy(
  overrides: {
    title?: string;
    whatHappened?: string;
    whyItHappened?: string;
    whatChanged?: string;
    anonymous?: boolean;
    preventingSopId?: string;
    teachingCourseId?: string;
    category?: "PRODUCT_SELECTION" | "ORDER_ACCURACY" | "WAREHOUSE_SAFETY";
  } = {},
) {
  const f = await fixture();
  const reported = await reportNearMiss(f.reporter, {
    title: overrides.title ?? "Wrong pressure class nearly shipped",
    category: overrides.category ?? "PRODUCT_SELECTION",
    severity: "NEAR_MISS",
    whatHappened: overrides.whatHappened ?? NARRATIVE,
    anonymous: overrides.anonymous ?? false,
  });
  await saveNearMissReview(f.reviewer, reported.id, {
    title: overrides.title ?? "Wrong pressure class nearly shipped",
    category: overrides.category ?? "PRODUCT_SELECTION",
    severity: "NEAR_MISS",
    whatHappened: overrides.whatHappened ?? NARRATIVE,
    whyItHappened:
      overrides.whyItHappened ??
      "The two part numbers differ by one character and sit next to each other on the shelf.",
    whatChanged:
      overrides.whatChanged ??
      "The bin labels now carry the pressure class in 40pt type, and the pick list shows it too.",
    preventingSopId: overrides.preventingSopId,
    teachingCourseId: overrides.teachingCourseId,
  });
  await publishNearMiss(f.reviewer, reported.id);
  return { ...f, id: reported.id, reference: reported.reference };
}

beforeEach(async () => {
  await freshDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("filing a report", () => {
  it("lets an ordinary learner file one, and allocates a readable reference", async () => {
    const f = await fixture();

    const first = await reportNearMiss(f.reporter, {
      title: "Wrong pressure class nearly shipped",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: NARRATIVE,
    });
    expect(first.reference).toBe("NM-001");

    const second = await reportNearMiss(f.reporter, {
      title: "Second report about a different thing",
      category: "ORDER_ACCURACY",
      severity: "MINOR",
      whatHappened: NARRATIVE,
    });
    expect(second.reference).toBe("NM-002");
  });

  it("lets a contractor file one — the reporting channel is deliberately wide", async () => {
    const f = await fixture();
    const filed = await reportNearMiss(f.contractor, {
      title: "Pallet stacked above the rail",
      category: "WAREHOUSE_SAFETY",
      severity: "NEAR_MISS",
      whatHappened: NARRATIVE,
    });
    expect(filed.reference).toBe("NM-001");
  });

  it("starts in REPORTED, with nothing published", async () => {
    const f = await fixture();
    const filed = await reportNearMiss(f.reporter, {
      title: "Wrong pressure class nearly shipped",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: NARRATIVE,
    });

    const row = await testPrisma.nearMiss.findUniqueOrThrow({ where: { id: filed.id } });
    expect(row.status).toBe("REPORTED");
    expect(row.publishedAt).toBeNull();
    expect(row.publishedById).toBeNull();
    expect(await getPublishedNearMisses(f.reporter)).toEqual([]);
  });

  it("rejects a one-line narrative and a future date", async () => {
    const f = await fixture();
    await expect(
      reportNearMiss(f.reporter, {
        title: "Something happened",
        category: "OTHER",
        severity: "NEAR_MISS",
        whatHappened: "It broke.",
      }),
    ).rejects.toThrow();

    await expect(
      reportNearMiss(f.reporter, {
        title: "Something happened last week",
        category: "OTHER",
        severity: "NEAR_MISS",
        whatHappened: NARRATIVE,
        occurredOn: new Date(Date.now() + 30 * 86_400_000),
      }),
    ).rejects.toThrow(NearMissValidationError);
  });

  it("notifies everyone who can review, so a report never sits unseen", async () => {
    const f = await fixture();
    const filed = await reportNearMiss(f.reporter, {
      title: "Wrong pressure class nearly shipped",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: NARRATIVE,
    });

    const notifications = await testPrisma.notification.findMany({
      where: { userId: f.reviewer.id },
      select: { title: true, linkUrl: true },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.title).toContain("NM-001");
    expect(notifications[0]?.linkUrl).toBe(`/admin/near-misses/${filed.id}`);

    // The reporter is not notified about their own report.
    expect(await testPrisma.notification.count({ where: { userId: f.reporter.id } })).toBe(0);
  });
});

describe("anonymity", () => {
  it("stores no link to the reporter when anonymity is asked for", async () => {
    const f = await fixture();
    const filed = await reportNearMiss(f.reporter, {
      title: "Commitment made before stock was checked",
      category: "CUSTOMER_COMMITMENT",
      severity: "MINOR",
      whatHappened: NARRATIVE,
      anonymous: true,
    });

    const row = await testPrisma.nearMiss.findUniqueOrThrow({
      where: { id: filed.id },
      select: { reportedById: true },
    });
    expect(row.reportedById).toBeNull();
  });

  it("writes the audit row without an actor for an anonymous report", async () => {
    const f = await fixture();
    const anon = await reportNearMiss(f.reporter, {
      title: "Commitment made before stock was checked",
      category: "CUSTOMER_COMMITMENT",
      severity: "MINOR",
      whatHappened: NARRATIVE,
      anonymous: true,
    });

    const events = await testPrisma.auditEvent.findMany({
      where: { entityId: anon.id, action: "nearmiss.reported" },
      select: { actorId: true, actorEmail: true, metadata: true },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.actorId).toBeNull();
    expect(events[0]?.actorEmail).toBeNull();
    expect(events[0]?.metadata).toMatchObject({ anonymous: true, reference: "NM-001" });

    // And the narrative is not copied into the log for audit.view holders.
    expect(JSON.stringify(events[0]?.metadata)).not.toContain("flange");
  });

  it("keeps the reporter on a named report, in the record and the audit log", async () => {
    const f = await fixture();
    const named = await reportNearMiss(f.reporter, {
      title: "Wrong pressure class nearly shipped",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: NARRATIVE,
      anonymous: false,
    });

    const row = await testPrisma.nearMiss.findUniqueOrThrow({
      where: { id: named.id },
      select: { reportedById: true },
    });
    expect(row.reportedById).toBe(f.reporter.id);

    const event = await testPrisma.auditEvent.findFirstOrThrow({
      where: { entityId: named.id, action: "nearmiss.reported" },
      select: { actorId: true },
    });
    expect(event.actorId).toBe(f.reporter.id);
  });

  it("never selects the reporter in a published read, at all", async () => {
    const published = await publishedCaseStudy();

    const list = await getPublishedNearMisses(published.reporter);
    expect(list).toHaveLength(1);
    const [row] = list;
    // Structural, not filtered: the column is not in the select, so it cannot
    // be leaked by a spread, a JSON dump, or a new API route.
    expect(Object.keys(row ?? {})).not.toContain("reportedById");
    expect(Object.keys(row ?? {})).not.toContain("reportedBy");
    expect(JSON.stringify(row)).not.toContain(published.reporter.id);
    expect(JSON.stringify(row)).not.toContain("Dana");

    const detail = await getPublishedNearMiss(published.reporter, published.reference);
    expect(Object.keys(detail ?? {})).not.toContain("reportedById");
  });

  it("tells a named reporter their report became a case study, and has nobody to tell for an anonymous one", async () => {
    const named = await publishedCaseStudy({ anonymous: false });
    const namedNotice = await testPrisma.notification.findFirst({
      where: { userId: named.reporter.id, type: "SYSTEM" },
      select: { title: true, linkUrl: true },
    });
    expect(namedNotice?.title).toMatch(/case study/i);
    expect(namedNotice?.linkUrl).toBe(`/near-misses/${named.reference}`);

    await freshDatabase();
    const anon = await publishedCaseStudy({ anonymous: true });
    expect(
      await testPrisma.notification.count({ where: { userId: anon.reporter.id, type: "SYSTEM" } }),
    ).toBe(0);
  });
});

describe("an unpublished report is reviewer-only", () => {
  it("is not readable through any nearmiss.view path", async () => {
    const f = await fixture();
    const filed = await reportNearMiss(f.reporter, {
      title: "Wrong pressure class nearly shipped",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: NARRATIVE,
    });

    expect(await getPublishedNearMiss(f.reporter, filed.id)).toBeNull();
    expect(await getPublishedNearMiss(f.reporter, filed.reference)).toBeNull();
    expect(await getPublishedNearMisses(f.reporter)).toEqual([]);
  });

  it("refuses the review queue and the review record to someone without nearmiss.review", async () => {
    const f = await fixture();
    const filed = await reportNearMiss(f.reporter, {
      title: "Wrong pressure class nearly shipped",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: NARRATIVE,
    });

    await expect(getNearMissQueue(f.reporter)).rejects.toThrow(AuthorizationError);
    await expect(getNearMissForReview(f.reporter, filed.id)).rejects.toThrow(AuthorizationError);
    await expect(publishNearMiss(f.reporter, filed.id)).rejects.toThrow(AuthorizationError);
    await expect(archiveNearMiss(f.reporter, filed.id)).rejects.toThrow(AuthorizationError);
  });

  it("refuses the whole library to a contractor, who can report but not read", async () => {
    const published = await publishedCaseStudy();
    expect(published.contractor.permissions.has("nearmiss.report")).toBe(true);
    expect(published.contractor.permissions.has("nearmiss.view")).toBe(false);

    await expect(getPublishedNearMisses(published.contractor)).rejects.toThrow(AuthorizationError);
    await expect(
      getPublishedNearMiss(published.contractor, published.reference),
    ).rejects.toThrow(AuthorizationError);
  });

  it("shows the reviewer the queue with waiting time and whether it was anonymous", async () => {
    const f = await fixture();
    await reportNearMiss(f.reporter, {
      title: "Named report",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: NARRATIVE,
    });
    await reportNearMiss(f.reporter, {
      title: "Anonymous report",
      category: "DATA_SECURITY",
      severity: "SIGNIFICANT",
      whatHappened: NARRATIVE,
      anonymous: true,
    });

    const queue = await getNearMissQueue(f.reviewer);
    expect(queue).toHaveLength(2);
    expect(queue.map((item) => item.reference)).toEqual(["NM-001", "NM-002"]);
    expect(queue.find((item) => item.reference === "NM-001")?.anonymous).toBe(false);
    expect(queue.find((item) => item.reference === "NM-002")?.anonymous).toBe(true);
    expect(queue[0]?.waitingDays).toBe(0);
  });

  it("stamps a named report with the reporter's department, and an anonymous one with nothing", async () => {
    const f = await fixture();
    const named = await reportNearMiss(f.reporter, {
      title: "Named report about a picking error",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: NARRATIVE,
    });
    const anon = await reportNearMiss(f.reporter, {
      title: "Anonymous report about a picking error",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: NARRATIVE,
      anonymous: true,
    });

    const queue = await getNearMissQueue(f.reviewer);
    expect(queue.find((item) => item.id === named.id)?.departmentName).toBe("Sales");
    /*
     * The reason this matters: a silent department stamp on a small department
     * identifies an anonymous reporter as surely as their name would.
     */
    expect(queue.find((item) => item.id === anon.id)?.departmentName).toBeNull();

    // Unless they chose to say where, in which case it is theirs to give.
    const chosen = await reportNearMiss(f.reporter, {
      title: "Anonymous report that names its department",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: NARRATIVE,
      anonymous: true,
      departmentId: f.org.department.id,
    });
    const requeued = await getNearMissQueue(f.reviewer);
    expect(requeued.find((item) => item.id === chosen.id)?.departmentName).toBe("Sales");
  });
});

describe("publication refuses what would make the library unsafe or useless", () => {
  async function reportedOnly() {
    const f = await fixture();
    const filed = await reportNearMiss(f.reporter, {
      title: "Wrong pressure class nearly shipped",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: NARRATIVE,
    });
    return { ...f, id: filed.id };
  }

  it("refuses to publish without a cause", async () => {
    const f = await reportedOnly();
    await expect(publishNearMiss(f.reviewer, f.id)).rejects.toThrow(/why it happened/i);
  });

  it("refuses to publish without what changed", async () => {
    const f = await reportedOnly();
    await saveNearMissReview(f.reviewer, f.id, {
      title: "Wrong pressure class nearly shipped",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: NARRATIVE,
      whyItHappened: "Two part numbers differ by a single character.",
    });
    await expect(publishNearMiss(f.reviewer, f.id)).rejects.toThrow(/what changed/i);
  });

  it("refuses to publish a narrative that names a colleague, and allows it once rewritten", async () => {
    const f = await reportedOnly();

    await saveNearMissReview(f.reviewer, f.id, {
      title: "Wrong pressure class nearly shipped",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: "Dana Whitlock picked a 150# flange for a 300# service.",
      whyItHappened: "Two part numbers differ by a single character.",
      whatChanged: "Bin labels now carry the pressure class.",
    });

    await expect(publishNearMiss(f.reviewer, f.id)).rejects.toThrow(/identifies someone/i);
    expect(
      (await testPrisma.nearMiss.findUniqueOrThrow({ where: { id: f.id } })).status,
    ).toBe("UNDER_REVIEW");

    await saveNearMissReview(f.reviewer, f.id, {
      title: "Wrong pressure class nearly shipped",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: "The picker selected a 150# flange for a 300# service.",
      whyItHappened: "Two part numbers differ by a single character.",
      whatChanged: "Bin labels now carry the pressure class.",
    });
    await expect(publishNearMiss(f.reviewer, f.id)).resolves.toMatchObject({ id: f.id });
  });

  it("refuses a narrative carrying an email address", async () => {
    const f = await reportedOnly();
    await saveNearMissReview(f.reviewer, f.id, {
      title: "Wrong pressure class nearly shipped",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: `${NARRATIVE} Escalated to reviewer@test.local.`,
      whyItHappened: "Two part numbers differ by a single character.",
      whatChanged: "Bin labels now carry the pressure class.",
    });
    await expect(publishNearMiss(f.reviewer, f.id)).rejects.toThrow(/identifies someone/i);
  });

  it("returns blame-language warnings from a review save without blocking it", async () => {
    const f = await reportedOnly();
    const result = await saveNearMissReview(f.reviewer, f.id, {
      title: "Wrong pressure class nearly shipped",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: "The picker was careless with the pressure class.",
      whyItHappened: "Two part numbers differ by a single character.",
      whatChanged: "Bin labels now carry the pressure class.",
    });

    expect(result.findings.some((finding) => finding.kind === "BLAME")).toBe(true);
    expect(result.findings.every((finding) => !finding.blocking)).toBe(true);
    // A warning is a warning: publication still succeeds.
    await expect(publishNearMiss(f.reviewer, f.id)).resolves.toBeTruthy();
  });
});

describe("the review lifecycle", () => {
  it("moves a new report into review on first save, and records who reviewed it", async () => {
    const f = await fixture();
    const filed = await reportNearMiss(f.reporter, {
      title: "Wrong pressure class nearly shipped",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: NARRATIVE,
    });

    await saveNearMissReview(f.reviewer, filed.id, {
      title: "Wrong pressure class nearly shipped",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: NARRATIVE,
      whyItHappened: "Two part numbers differ by a single character.",
    });

    const row = await getNearMissForReview(f.reviewer, filed.id);
    expect(row?.status).toBe("UNDER_REVIEW");
    expect(row?.reportedBy?.name).toBe("Dana Whitlock");

    const events = await testPrisma.auditEvent.findMany({
      where: { entityId: filed.id, action: "nearmiss.reviewed" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.actorId).toBe(f.reviewer.id);
  });

  it("refuses to edit a published case study, and allows it after reopening", async () => {
    const published = await publishedCaseStudy();

    await expect(
      saveNearMissReview(published.reviewer, published.id, {
        title: "Edited while published",
        category: "PRODUCT_SELECTION",
        severity: "NEAR_MISS",
        whatHappened: NARRATIVE,
      }),
    ).rejects.toThrow(/published/i);

    await reopenNearMiss(published.reviewer, published.id);
    const reopened = await getNearMissForReview(published.reviewer, published.id);
    expect(reopened?.status).toBe("UNDER_REVIEW");
    expect(reopened?.publishedAt).toBeNull();
    // Reopening withdraws it from the library immediately.
    expect(await getPublishedNearMisses(published.reporter)).toEqual([]);
  });

  it("archiving withdraws a case study and records the previous status", async () => {
    const published = await publishedCaseStudy();
    await archiveNearMiss(published.reviewer, published.id, "Superseded by SOP revision");

    expect(await getPublishedNearMisses(published.reporter)).toEqual([]);
    const event = await testPrisma.auditEvent.findFirstOrThrow({
      where: { entityId: published.id, action: "nearmiss.archived" },
      select: { metadata: true },
    });
    expect(event.metadata).toMatchObject({
      previousStatus: "PUBLISHED",
      reason: "Superseded by SOP revision",
    });
  });

  it("publishing twice is a no-op rather than an error", async () => {
    const published = await publishedCaseStudy();
    await expect(publishNearMiss(published.reviewer, published.id)).resolves.toMatchObject({
      id: published.id,
    });
    expect(await getPublishedNearMisses(published.reporter)).toHaveLength(1);
  });
});

describe("the library links back to procedures and training", () => {
  it("shows a case study on the procedure that would have prevented it", async () => {
    const f = await fixture();
    const authorId = await createUser({ email: "author@test.local", roles: [ROLE_KEYS.CONTENT_AUTHOR] });
    const { sopId } = await createPublishedSop({
      code: "OPS-010",
      title: "Pick and pack a flanged valve",
      createdById: authorId,
    });
    const { courseId } = await createPublishedCourse({
      title: "Pressure classes in practice",
      createdById: authorId,
    });

    const filed = await reportNearMiss(f.reporter, {
      title: "Wrong pressure class nearly shipped",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: NARRATIVE,
    });
    await saveNearMissReview(f.reviewer, filed.id, {
      title: "Wrong pressure class nearly shipped",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: NARRATIVE,
      whyItHappened: "Two part numbers differ by a single character.",
      whatChanged: "Bin labels now carry the pressure class.",
      preventingSopId: sopId,
      teachingCourseId: courseId,
    });
    await publishNearMiss(f.reviewer, filed.id);

    const forSop = await getNearMissesForSop(f.reporter, sopId);
    expect(forSop).toHaveLength(1);
    expect(forSop[0]?.reference).toBe("NM-001");

    const forCourse = await getNearMissesForCourse(f.reporter, courseId);
    expect(forCourse).toHaveLength(1);

    // A reader without the capability gets an empty list, not an error: the
    // SOP page still renders for a contractor.
    expect(await getNearMissesForSop(f.contractor, sopId)).toEqual([]);
    expect(await getNearMissesForCourse(f.contractor, courseId)).toEqual([]);
  });

  it("counts patterns and flags the categories no procedure covers", async () => {
    const f = await fixture();
    const authorId = await createUser({ email: "author2@test.local", roles: [ROLE_KEYS.CONTENT_AUTHOR] });
    const { sopId } = await createPublishedSop({
      code: "OPS-011",
      title: "Pick and pack",
      createdById: authorId,
    });

    for (const [index, category] of (
      ["PRODUCT_SELECTION", "PRODUCT_SELECTION", "ORDER_ACCURACY"] as const
    ).entries()) {
      const filed = await reportNearMiss(f.reporter, {
        title: `Report number ${index + 1} about something`,
        category,
        severity: "NEAR_MISS",
        whatHappened: NARRATIVE,
      });
      await saveNearMissReview(f.reviewer, filed.id, {
        title: `Report number ${index + 1} about something`,
        category,
        severity: "NEAR_MISS",
        whatHappened: NARRATIVE,
        whyItHappened: "Two part numbers differ by a single character.",
        whatChanged: "Bin labels now carry the pressure class.",
        // Only the first one gets a procedure.
        preventingSopId: index === 0 ? sopId : undefined,
      });
      await publishNearMiss(f.reviewer, filed.id);
    }

    const stats = await getNearMissStats(f.reviewer);
    expect(stats.published).toBe(3);
    expect(stats.recent).toBe(3);
    expect(stats.awaitingReview).toBe(0);

    const productSelection = stats.patterns.find((p) => p.category === "PRODUCT_SELECTION");
    expect(productSelection?.count).toBe(2);
    expect(productSelection?.withoutProcedure).toBe(1);

    const orderAccuracy = stats.patterns.find((p) => p.category === "ORDER_ACCURACY");
    expect(orderAccuracy?.withoutProcedure).toBe(1);
    // Ordered by frequency: the pattern worth acting on is first.
    expect(stats.patterns[0]?.category).toBe("PRODUCT_SELECTION");
  });

  it("hides the awaiting-review count from someone who cannot review", async () => {
    const f = await fixture();
    await reportNearMiss(f.reporter, {
      title: "Wrong pressure class nearly shipped",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: NARRATIVE,
    });

    expect((await getNearMissStats(f.reporter)).awaitingReview).toBe(0);
    expect((await getNearMissStats(f.reviewer)).awaitingReview).toBe(1);
  });

  it("filters the library by category, severity and free text", async () => {
    const f = await fixture();
    for (const [title, category] of [
      ["Wrong pressure class nearly shipped", "PRODUCT_SELECTION"],
      ["Wrong quantity picked for a rush order", "ORDER_ACCURACY"],
    ] as const) {
      const filed = await reportNearMiss(f.reporter, {
        title,
        category,
        severity: category === "PRODUCT_SELECTION" ? "NEAR_MISS" : "SIGNIFICANT",
        whatHappened: NARRATIVE,
      });
      await saveNearMissReview(f.reviewer, filed.id, {
        title,
        category,
        severity: category === "PRODUCT_SELECTION" ? "NEAR_MISS" : "SIGNIFICANT",
        whatHappened: NARRATIVE,
        whyItHappened: "Two part numbers differ by a single character.",
        whatChanged: "Bin labels now carry the pressure class.",
      });
      await publishNearMiss(f.reviewer, filed.id);
    }

    expect(await getPublishedNearMisses(f.reporter)).toHaveLength(2);
    expect(
      await getPublishedNearMisses(f.reporter, { category: "ORDER_ACCURACY" }),
    ).toHaveLength(1);
    expect(await getPublishedNearMisses(f.reporter, { severity: "NEAR_MISS" })).toHaveLength(1);
    expect(await getPublishedNearMisses(f.reporter, { q: "quantity" })).toHaveLength(1);
    expect(await getPublishedNearMisses(f.reporter, { q: "NM-001" })).toHaveLength(1);
    expect(await getPublishedNearMisses(f.reporter, { q: "nothing matches this" })).toEqual([]);
  });
});

describe("the AI corpus", () => {
  it("indexes a published case study, gated on nearmiss.view", async () => {
    const published = await publishedCaseStudy();

    const chunks = await testPrisma.knowledgeChunk.findMany({
      where: { entityType: "NEAR_MISS", entityId: published.id },
      select: { requiredPermission: true, content: true, title: true, versionLabel: true },
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.requiredPermission).toBe("nearmiss.view");
    expect(chunks[0]?.versionLabel).toBe("NM-001");
    expect(chunks[0]?.content).toContain("What changed:");
    // The reporter's identity is not in the corpus, however it was filed.
    expect(chunks[0]?.content).not.toContain("Dana");
  });

  it("does not index a report that is only in the review queue", async () => {
    const f = await fixture();
    const filed = await reportNearMiss(f.reporter, {
      title: "Wrong pressure class nearly shipped",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: NARRATIVE,
    });
    expect(
      await testPrisma.knowledgeChunk.count({ where: { entityType: "NEAR_MISS", entityId: filed.id } }),
    ).toBe(0);
  });

  it("retrieves a case study for a reader who holds nearmiss.view", async () => {
    const published = await publishedCaseStudy();
    const result = await retrieve(published.reporter, "pressure class flange");

    const nearMissChunks = result.chunks.filter((chunk) => chunk.entityType === "NEAR_MISS");
    expect(nearMissChunks.length).toBeGreaterThan(0);
    expect(nearMissChunks[0]?.href).toBe(`/near-misses/${published.id}`);
    expect(nearMissChunks[0]?.versionLabel).toBe("NM-001");
  });

  it("never retrieves a case study for a contractor, who lacks nearmiss.view", async () => {
    const published = await publishedCaseStudy();
    const result = await retrieve(published.contractor, "pressure class flange");
    expect(
      result.chunks.filter((chunk) => chunk.entityType === "NEAR_MISS"),
      "a contractor must never retrieve a near-miss case study",
    ).toEqual([]);
  });

  it("drops the chunk when a case study is archived or reopened", async () => {
    const archived = await publishedCaseStudy();
    await archiveNearMiss(archived.reviewer, archived.id);
    expect(
      await testPrisma.knowledgeChunk.count({
        where: { entityType: "NEAR_MISS", entityId: archived.id },
      }),
    ).toBe(0);
    expect(
      (await retrieve(archived.reporter, "pressure class flange")).chunks.filter(
        (chunk) => chunk.entityType === "NEAR_MISS",
      ),
    ).toEqual([]);

    await freshDatabase();
    const reopened = await publishedCaseStudy();
    await reopenNearMiss(reopened.reviewer, reopened.id);
    expect(
      await testPrisma.knowledgeChunk.count({
        where: { entityType: "NEAR_MISS", entityId: reopened.id },
      }),
    ).toBe(0);
  });

  it("re-publishing after a reopen indexes the revised text, not the old one", async () => {
    const published = await publishedCaseStudy();
    await reopenNearMiss(published.reviewer, published.id);
    await saveNearMissReview(published.reviewer, published.id, {
      title: "Wrong pressure class nearly shipped",
      category: "PRODUCT_SELECTION",
      severity: "NEAR_MISS",
      whatHappened: "A revised description mentioning a distinctive gasket seat.",
      whyItHappened: "Two part numbers differ by a single character.",
      whatChanged: "A revised change: the pick list now prints the pressure class.",
    });
    await publishNearMiss(published.reviewer, published.id);

    const chunks = await testPrisma.knowledgeChunk.findMany({
      where: { entityType: "NEAR_MISS", entityId: published.id },
      select: { content: true },
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain("distinctive gasket seat");
    expect(chunks[0]?.content).not.toContain("150# flange was picked");
  });
});
