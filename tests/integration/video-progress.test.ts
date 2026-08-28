import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { actorFor, createUser, freshDatabase, testPrisma } from "./helpers";
import { ROLE_KEYS } from "@/lib/permissions";
import { recordLessonProgress } from "@/lib/services/completion";

/**
 * Video playback tracking.
 *
 * The point of tracking real playback is that a completion record should mean
 * the person watched the material, not that they opened it. These tests attack
 * that guarantee the way a learner in a hurry would: seek to the end, report an
 * impossible position, replay to reduce progress.
 */

async function videoCourse(options: {
  createdById: string;
  requiredVideoPercent?: number;
}): Promise<{ courseId: string; lessonId: string }> {
  const course = await testPrisma.course.create({
    data: {
      title: "Video Course",
      status: "PUBLISHED",
      createdById: options.createdById,
      requiredVideoPercent: options.requiredVideoPercent ?? 90,
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
      title: "Training video",
      type: "VIDEO",
      order: 0,
      required: true,
      content: { mediaId: "media_test" },
    },
    select: { id: true },
  });
  return { courseId: course.id, lessonId: lesson.id };
}

/** Backdate the progress row so a subsequent report sees plausible elapsed time. */
async function backdateProgress(
  userId: string,
  lessonId: string,
  secondsAgo: number,
): Promise<void> {
  await testPrisma.$executeRaw`
    UPDATE "LessonProgress"
    SET "updatedAt" = NOW() - (${secondsAgo} * INTERVAL '1 second')
    WHERE "userId" = ${userId} AND "lessonId" = ${lessonId}
  `;
}

beforeEach(async () => {
  await freshDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("seeking to the end does not complete the lesson", () => {
  it("clamps a jump larger than the elapsed wall-clock time", async () => {
    const userId = await createUser({ email: "scrubber@test.local", roles: [ROLE_KEYS.LEARNER] });
    const actor = await actorFor(userId);
    const { lessonId } = await videoCourse({ createdById: userId });

    // First report: a few seconds in, which is plausible from a cold start.
    const first = await recordLessonProgress(actor, lessonId, {
      videoPositionSeconds: 5,
      videoDurationSeconds: 600,
    });
    expect(first.status).toBe("IN_PROGRESS");

    // Immediately claim to be at the end of a ten-minute video.
    const second = await recordLessonProgress(actor, lessonId, {
      videoPositionSeconds: 600,
      videoDurationSeconds: 600,
    });

    expect(second.status).not.toBe("COMPLETED");
    expect(second.videoWatchedPercent ?? 0).toBeLessThan(90);
    // The stored position is clamped near where it plausibly could be.
    expect(second.videoPositionSeconds ?? 0).toBeLessThan(100);
  });

  it("does not complete on a single enormous first report", async () => {
    const userId = await createUser({ email: "scrubber2@test.local", roles: [ROLE_KEYS.LEARNER] });
    const actor = await actorFor(userId);
    const { lessonId } = await videoCourse({ createdById: userId });

    // No prior row, so no elapsed time has accrued at all.
    const result = await recordLessonProgress(actor, lessonId, {
      videoPositionSeconds: 3600,
      videoDurationSeconds: 3600,
    });

    expect(result.status).not.toBe("COMPLETED");
    expect(result.videoPositionSeconds ?? 0).toBeLessThanOrEqual(20);
  });

  it("rejects a negative reported position", async () => {
    const userId = await createUser({ email: "negative@test.local", roles: [ROLE_KEYS.LEARNER] });
    const actor = await actorFor(userId);
    const { lessonId } = await videoCourse({ createdById: userId });

    const result = await recordLessonProgress(actor, lessonId, {
      videoPositionSeconds: -500,
      videoDurationSeconds: 600,
    });
    expect(result.videoPositionSeconds ?? 0).toBeGreaterThanOrEqual(0);
  });
});

describe("progress is monotonic", () => {
  it("does not reduce stored progress when the learner rewinds", async () => {
    const userId = await createUser({ email: "rewind@test.local", roles: [ROLE_KEYS.LEARNER] });
    const actor = await actorFor(userId);
    const { lessonId } = await videoCourse({ createdById: userId });

    await recordLessonProgress(actor, lessonId, {
      videoPositionSeconds: 10,
      videoDurationSeconds: 600,
    });
    await backdateProgress(userId, lessonId, 200);

    const advanced = await recordLessonProgress(actor, lessonId, {
      videoPositionSeconds: 200,
      videoDurationSeconds: 600,
    });
    expect(advanced.videoPositionSeconds).toBe(200);

    // Now rewind to review an earlier section.
    const rewound = await recordLessonProgress(actor, lessonId, {
      videoPositionSeconds: 30,
      videoDurationSeconds: 600,
    });

    // Reviewing must not cost the learner credit they already earned.
    expect(rewound.videoPositionSeconds).toBe(200);
    expect(rewound.videoWatchedPercent).toBeGreaterThanOrEqual(
      advanced.videoWatchedPercent ?? 0,
    );
  });

  it("never lowers the watched percentage", async () => {
    const userId = await createUser({ email: "monotonic@test.local", roles: [ROLE_KEYS.LEARNER] });
    const actor = await actorFor(userId);
    const { lessonId } = await videoCourse({ createdById: userId });

    await recordLessonProgress(actor, lessonId, {
      videoPositionSeconds: 10,
      videoDurationSeconds: 100,
    });
    await backdateProgress(userId, lessonId, 80);

    const high = await recordLessonProgress(actor, lessonId, {
      videoPositionSeconds: 85,
      videoDurationSeconds: 100,
    });
    expect(high.videoWatchedPercent).toBeGreaterThan(80);

    const low = await recordLessonProgress(actor, lessonId, {
      videoPositionSeconds: 5,
      videoDurationSeconds: 100,
    });
    expect(low.videoWatchedPercent).toBe(high.videoWatchedPercent);
  });
});

describe("honest watching completes the lesson", () => {
  it("completes once the required percentage is genuinely reached", async () => {
    const userId = await createUser({ email: "honest@test.local", roles: [ROLE_KEYS.LEARNER] });
    const actor = await actorFor(userId);
    const { lessonId } = await videoCourse({ createdById: userId, requiredVideoPercent: 90 });

    // Watch a 100-second video in realistic increments, letting wall-clock time
    // accrue between reports the way the player does.
    let last = await recordLessonProgress(actor, lessonId, {
      videoPositionSeconds: 10,
      videoDurationSeconds: 100,
    });

    for (const position of [25, 45, 65, 85, 95]) {
      await backdateProgress(userId, lessonId, 25);
      last = await recordLessonProgress(actor, lessonId, {
        videoPositionSeconds: position,
        videoDurationSeconds: 100,
      });
    }

    expect(last.videoWatchedPercent ?? 0).toBeGreaterThanOrEqual(90);
    expect(last.status).toBe("COMPLETED");
    expect(last.completedAt).toBeInstanceOf(Date);
  });

  it("respects a course-specific required percentage", async () => {
    const userId = await createUser({ email: "fifty@test.local", roles: [ROLE_KEYS.LEARNER] });
    const actor = await actorFor(userId);
    const { lessonId } = await videoCourse({ createdById: userId, requiredVideoPercent: 50 });

    await recordLessonProgress(actor, lessonId, {
      videoPositionSeconds: 10,
      videoDurationSeconds: 100,
    });
    await backdateProgress(userId, lessonId, 60);

    const result = await recordLessonProgress(actor, lessonId, {
      videoPositionSeconds: 60,
      videoDurationSeconds: 100,
    });

    expect(result.videoWatchedPercent ?? 0).toBeGreaterThanOrEqual(50);
    expect(result.status).toBe("COMPLETED");
  });

  it("stays complete after completion even if a later report is lower", async () => {
    const userId = await createUser({ email: "sticky@test.local", roles: [ROLE_KEYS.LEARNER] });
    const actor = await actorFor(userId);
    const { lessonId } = await videoCourse({ createdById: userId, requiredVideoPercent: 50 });

    await recordLessonProgress(actor, lessonId, {
      videoPositionSeconds: 10,
      videoDurationSeconds: 100,
    });
    await backdateProgress(userId, lessonId, 60);
    const completed = await recordLessonProgress(actor, lessonId, {
      videoPositionSeconds: 60,
      videoDurationSeconds: 100,
    });
    expect(completed.status).toBe("COMPLETED");

    // Rewatching from the beginning must not un-complete the lesson.
    const rewatch = await recordLessonProgress(actor, lessonId, {
      videoPositionSeconds: 5,
      videoDurationSeconds: 100,
    });
    expect(rewatch.status).toBe("COMPLETED");
    expect(rewatch.completedAt).toEqual(completed.completedAt);
  });
});

describe("progress is scoped to the acting user", () => {
  it("keeps two learners' progress independent", async () => {
    const first = await createUser({ email: "first@test.local", roles: [ROLE_KEYS.LEARNER] });
    const second = await createUser({ email: "second@test.local", roles: [ROLE_KEYS.LEARNER] });
    const { lessonId } = await videoCourse({ createdById: first });

    const firstActor = await actorFor(first);
    const secondActor = await actorFor(second);

    await recordLessonProgress(firstActor, lessonId, {
      videoPositionSeconds: 10,
      videoDurationSeconds: 100,
    });
    await backdateProgress(first, lessonId, 60);
    await recordLessonProgress(firstActor, lessonId, {
      videoPositionSeconds: 60,
      videoDurationSeconds: 100,
    });

    // The second learner starts from zero regardless of the first's progress.
    const secondResult = await recordLessonProgress(secondActor, lessonId, {
      videoPositionSeconds: 5,
      videoDurationSeconds: 100,
    });
    expect(secondResult.videoPositionSeconds ?? 0).toBeLessThan(20);
    expect(secondResult.status).not.toBe("COMPLETED");

    const rows = await testPrisma.lessonProgress.findMany({
      where: { lessonId },
      select: { userId: true, videoPositionSeconds: true },
    });
    expect(rows).toHaveLength(2);
  });

  it("stores exactly one progress row per person per lesson", async () => {
    const userId = await createUser({ email: "single@test.local", roles: [ROLE_KEYS.LEARNER] });
    const actor = await actorFor(userId);
    const { lessonId } = await videoCourse({ createdById: userId });

    for (const position of [5, 10, 15]) {
      await backdateProgress(userId, lessonId, 30).catch(() => {});
      await recordLessonProgress(actor, lessonId, {
        videoPositionSeconds: position,
        videoDurationSeconds: 100,
      });
    }

    const count = await testPrisma.lessonProgress.count({ where: { userId, lessonId } });
    expect(count).toBe(1);
  });
});

describe("checklist lessons", () => {
  it("completes only when every item is checked", async () => {
    const userId = await createUser({ email: "checklist@test.local", roles: [ROLE_KEYS.LEARNER] });
    const actor = await actorFor(userId);

    const course = await testPrisma.course.create({
      data: { title: "Checklist Course", status: "PUBLISHED", createdById: userId },
      select: { id: true },
    });
    const section = await testPrisma.courseSection.create({
      data: { courseId: course.id, title: "S1", order: 0 },
      select: { id: true },
    });
    const lesson = await testPrisma.lesson.create({
      data: {
        sectionId: section.id,
        title: "Quote completeness checklist",
        type: "CHECKLIST",
        order: 0,
        required: true,
        content: {
          requireAll: true,
          items: [
            { id: "c1", text: "Correct customer account" },
            { id: "c2", text: "Lead times confirmed" },
            { id: "c3", text: "Follow-up task created" },
          ],
        },
      },
      select: { id: true },
    });

    const one = await recordLessonProgress(actor, lesson.id, {
      checklistItemId: "c1",
      checklistChecked: true,
    });
    expect(one.status).toBe("IN_PROGRESS");

    const two = await recordLessonProgress(actor, lesson.id, {
      checklistItemId: "c2",
      checklistChecked: true,
    });
    expect(two.status).toBe("IN_PROGRESS");

    const three = await recordLessonProgress(actor, lesson.id, {
      checklistItemId: "c3",
      checklistChecked: true,
    });
    expect(three.status).toBe("COMPLETED");
    expect(three.completedAt).toBeInstanceOf(Date);
  });

  it("does not complete when an item is unchecked again", async () => {
    const userId = await createUser({ email: "uncheck@test.local", roles: [ROLE_KEYS.LEARNER] });
    const actor = await actorFor(userId);

    const course = await testPrisma.course.create({
      data: { title: "Uncheck Course", status: "PUBLISHED", createdById: userId },
      select: { id: true },
    });
    const section = await testPrisma.courseSection.create({
      data: { courseId: course.id, title: "S1", order: 0 },
      select: { id: true },
    });
    const lesson = await testPrisma.lesson.create({
      data: {
        sectionId: section.id,
        title: "Two-item checklist",
        type: "CHECKLIST",
        order: 0,
        required: true,
        content: {
          requireAll: true,
          items: [
            { id: "a", text: "First" },
            { id: "b", text: "Second" },
          ],
        },
      },
      select: { id: true },
    });

    await recordLessonProgress(actor, lesson.id, { checklistItemId: "a", checklistChecked: true });
    const before = await recordLessonProgress(actor, lesson.id, {
      checklistItemId: "b",
      checklistChecked: false,
    });
    expect(before.status).not.toBe("COMPLETED");
  });
});
