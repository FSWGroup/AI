"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { assertPermission } from "@/lib/auth/guard";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { ok, fail, runAction, type ActionResult } from "@/lib/action-result";
import { enqueueJob, JOB_TYPES } from "@/lib/jobs/queue";
import { assertRateLimit } from "@/lib/rate-limit";
import { blocksSchema, type Block } from "@/lib/content/types";
import type { VideoPlan, VideoSourceType } from "@/lib/video/types";
import { isVideoOutdated, type VideoOutdatedInfo } from "@/lib/video/render";

export interface CreateVideoJobInput {
  title: string;
  mode: string;
  sourceType: VideoSourceType;
  prompt?: string;
  sourceText?: string;
  sourceSopId?: string;
  sourceCourseId?: string;
  voice?: string;
  language?: string;
  aspectRatio?: string;
}

export async function createVideoJobAction(
  input: CreateVideoJobInput,
): Promise<ActionResult<{ id: string }>> {
  return runAction("createVideoJob", async () => {
    const actor = await assertPermission("ai.video");
    if (!input.title.trim()) return fail("Give this video a title.");
    await assertRateLimit("videoRender", actor.id);

    let sourceSopVersion: string | null = null;
    if (input.sourceType === "SOP" && input.sourceSopId) {
      const sop = await prisma.sop.findUnique({
        where: { id: input.sourceSopId },
        select: { currentVersion: { select: { versionNumber: true } } },
      });
      sourceSopVersion = sop?.currentVersion?.versionNumber ?? null;
    }

    const job = await prisma.videoJob.create({
      data: {
        createdById: actor.id,
        title: input.title.trim(),
        mode: input.mode,
        sourceType: input.sourceType,
        sourceSopId: input.sourceSopId ?? null,
        sourceSopVersion,
        sourceCourseId: input.sourceCourseId ?? null,
        sourceText: input.sourceText ?? null,
        prompt: input.prompt ?? null,
        voice: input.voice ?? null,
        language: input.language ?? "en",
        aspectRatio: input.aspectRatio ?? "16:9",
        status: "QUEUED",
      },
      select: { id: true },
    });

    await enqueueJob(JOB_TYPES.GENERATE_VIDEO_PLAN, { videoJobId: job.id });

    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.AI_GENERATION_REQUESTED,
      entityType: "MEDIA",
      entityId: job.id,
      metadata: { kind: "video_plan", mode: input.mode, sourceType: input.sourceType },
    });

    revalidatePath("/admin/video-studio");
    return ok({ id: job.id });
  });
}

export async function updateVideoPlanAction(
  videoJobId: string,
  plan: VideoPlan,
): Promise<ActionResult<undefined>> {
  return runAction("updateVideoPlan", async () => {
    await assertPermission("ai.video");
    const job = await prisma.videoJob.findUnique({ where: { id: videoJobId }, select: { status: true } });
    if (!job) return fail("That video job no longer exists.");
    if (job.status === "COMPLETE" || job.status === "RENDERING" || job.status === "UPLOADING") {
      return fail("This video has already rendered or is rendering — regenerate the plan to make further changes.");
    }

    await prisma.videoJob.update({ where: { id: videoJobId }, data: { plan: plan as unknown as Prisma.InputJsonValue } });
    revalidatePath(`/admin/video-studio/${videoJobId}`);
    return ok(undefined);
  });
}

export async function queueRenderAction(videoJobId: string): Promise<ActionResult<undefined>> {
  return runAction("queueRender", async () => {
    const actor = await assertPermission("ai.video");
    await assertRateLimit("videoRender", actor.id);

    const job = await prisma.videoJob.findUnique({ where: { id: videoJobId }, select: { status: true, plan: true } });
    if (!job) return fail("That video job no longer exists.");
    if (!job.plan) return fail("Generate and review a plan before rendering.");
    if (job.status === "RENDERING" || job.status === "UPLOADING" || job.status === "COMPLETE") {
      return fail("This video is already rendering or complete.");
    }

    await enqueueJob(JOB_TYPES.RENDER_VIDEO, { videoJobId }, { idempotencyKey: `render:${videoJobId}:${Date.now()}` });
    revalidatePath(`/admin/video-studio/${videoJobId}`);
    revalidatePath("/admin/video-studio");
    return ok(undefined);
  });
}

export async function regenerateVideoPlanAction(videoJobId: string): Promise<ActionResult<undefined>> {
  return runAction("regenerateVideoPlan", async () => {
    await assertPermission("ai.video");
    const job = await prisma.videoJob.findUnique({ where: { id: videoJobId }, select: { status: true } });
    if (!job) return fail("That video job no longer exists.");
    if (job.status === "RENDERING" || job.status === "UPLOADING") {
      return fail("Wait for the current render to finish before regenerating the plan.");
    }

    await prisma.videoJob.update({
      where: { id: videoJobId },
      data: { status: "QUEUED", plan: Prisma.JsonNull, error: null, progress: 0 },
    });
    await enqueueJob(JOB_TYPES.GENERATE_VIDEO_PLAN, { videoJobId });
    revalidatePath(`/admin/video-studio/${videoJobId}`);
    return ok(undefined);
  });
}

/** Retry a failed job at whatever stage it failed — plan generation or render. */
export async function retryVideoJobAction(videoJobId: string): Promise<ActionResult<undefined>> {
  return runAction("retryVideoJob", async () => {
    const actor = await assertPermission("ai.video");
    const job = await prisma.videoJob.findUnique({ where: { id: videoJobId }, select: { status: true, plan: true } });
    if (!job) return fail("That video job no longer exists.");
    if (job.status !== "FAILED") return fail("Only failed jobs can be retried.");

    if (job.plan) {
      await assertRateLimit("videoRender", actor.id);
      await prisma.videoJob.update({ where: { id: videoJobId }, data: { status: "AWAITING_REVIEW", error: null } });
      await enqueueJob(JOB_TYPES.RENDER_VIDEO, { videoJobId }, { idempotencyKey: `render:${videoJobId}:${Date.now()}` });
    } else {
      await prisma.videoJob.update({ where: { id: videoJobId }, data: { status: "QUEUED", error: null, progress: 0 } });
      await enqueueJob(JOB_TYPES.GENERATE_VIDEO_PLAN, { videoJobId });
    }

    revalidatePath("/admin/video-studio");
    revalidatePath(`/admin/video-studio/${videoJobId}`);
    return ok(undefined);
  });
}

// ---------------------------------------------------------------------------
// Publish into SOP / course
// ---------------------------------------------------------------------------

export async function publishVideoIntoSopAction(
  videoJobId: string,
  sopId: string,
): Promise<ActionResult<undefined>> {
  return runAction("publishVideoIntoSop", async () => {
    const actor = await assertPermission("sop.create");
    const job = await prisma.videoJob.findUnique({ where: { id: videoJobId }, select: { outputMediaId: true, title: true } });
    if (!job?.outputMediaId) return fail("This video hasn't finished rendering yet.");

    const sop = await prisma.sop.findUnique({ where: { id: sopId }, select: { draftBlocks: true } });
    if (!sop) return fail("That SOP no longer exists.");

    const parsed = blocksSchema.safeParse(sop.draftBlocks ?? []);
    const existingBlocks: Block[] = parsed.success ? parsed.data : [];
    const videoBlock: Block = {
      id: `video-${job.outputMediaId}`,
      type: "video",
      mediaId: job.outputMediaId,
      title: job.title,
    };

    await prisma.sop.update({
      where: { id: sopId },
      data: { draftBlocks: [...existingBlocks, videoBlock] as unknown as Prisma.InputJsonValue },
    });

    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.SOP_UPDATED,
      entityType: "SOP",
      entityId: sopId,
      metadata: { kind: "video_attached", mediaId: job.outputMediaId },
    });

    revalidatePath(`/admin/sops/${sopId}/edit`);
    return ok(undefined);
  });
}

export interface ContentOption {
  id: string;
  title: string;
  subtitle: string | null;
}

export async function searchSopsForVideoAction(query: string): Promise<ActionResult<ContentOption[]>> {
  return runAction("searchSopsForVideo", async () => {
    await assertPermission("ai.video");
    const term = query.trim();
    const sops = await prisma.sop.findMany({
      where: {
        status: "PUBLISHED",
        isDeleted: false,
        ...(term.length >= 2 ? { title: { contains: term, mode: "insensitive" as const } } : {}),
      },
      select: { id: true, title: true, sopCode: true },
      take: 20,
      orderBy: { title: "asc" },
    });
    return ok(sops.map((s) => ({ id: s.id, title: s.title, subtitle: s.sopCode })));
  });
}

export async function searchCoursesForVideoAction(query: string): Promise<ActionResult<ContentOption[]>> {
  return runAction("searchCoursesForVideo", async () => {
    await assertPermission("ai.video");
    const term = query.trim();
    const courses = await prisma.course.findMany({
      where: {
        status: "PUBLISHED",
        isDeleted: false,
        ...(term.length >= 2 ? { title: { contains: term, mode: "insensitive" as const } } : {}),
      },
      select: { id: true, title: true, category: true },
      take: 20,
      orderBy: { title: "asc" },
    });
    return ok(courses.map((c) => ({ id: c.id, title: c.title, subtitle: c.category })));
  });
}

export interface CourseSectionOption {
  sectionId: string;
  sectionTitle: string;
}

export async function listCourseSectionsAction(courseId: string): Promise<ActionResult<CourseSectionOption[]>> {
  return runAction("listCourseSections", async () => {
    await assertPermission("training.create");
    const sections = await prisma.courseSection.findMany({
      where: { courseId },
      orderBy: { order: "asc" },
      select: { id: true, title: true },
    });
    return ok(sections.map((s) => ({ sectionId: s.id, sectionTitle: s.title })));
  });
}

export async function publishVideoIntoCourseAction(
  videoJobId: string,
  sectionId: string,
): Promise<ActionResult<undefined>> {
  return runAction("publishVideoIntoCourse", async () => {
    const actor = await assertPermission("training.create");
    const job = await prisma.videoJob.findUnique({ where: { id: videoJobId }, select: { outputMediaId: true, title: true } });
    if (!job?.outputMediaId) return fail("This video hasn't finished rendering yet.");

    const section = await prisma.courseSection.findUnique({
      where: { id: sectionId },
      select: { courseId: true, _count: { select: { lessons: true } } },
    });
    if (!section) return fail("That section no longer exists.");

    await prisma.lesson.create({
      data: {
        sectionId,
        title: job.title,
        type: "AI_VIDEO",
        order: section._count.lessons,
        content: { mediaId: job.outputMediaId } as unknown as Prisma.InputJsonValue,
      },
    });

    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.COURSE_UPDATED,
      entityType: "COURSE",
      entityId: section.courseId,
      metadata: { kind: "video_attached", mediaId: job.outputMediaId },
    });

    revalidatePath(`/admin/training/${section.courseId}/edit`);
    return ok(undefined);
  });
}

export interface VideoJobSummary {
  id: string;
  title: string;
  mode: string;
  status: string;
  progress: number;
  error: string | null;
  createdAt: string;
  outputMediaId: string | null;
}

export async function listVideoJobsAction(): Promise<ActionResult<VideoJobSummary[]>> {
  return runAction("listVideoJobs", async () => {
    await assertPermission("ai.video");
    const jobs = await prisma.videoJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, title: true, mode: true, status: true, progress: true, error: true, createdAt: true, outputMediaId: true },
    });
    return ok(jobs.map((j) => ({ ...j, createdAt: j.createdAt.toISOString() })));
  });
}

export interface VideoJobDetailData {
  id: string;
  title: string;
  mode: string;
  status: string;
  progress: number;
  error: string | null;
  plan: VideoPlan | null;
  outputMediaId: string | null;
  sourceSopId: string | null;
  sourceCourseId: string | null;
}

export async function getVideoJobAction(videoJobId: string): Promise<ActionResult<VideoJobDetailData>> {
  return runAction("getVideoJob", async () => {
    await assertPermission("ai.video");
    const job = await prisma.videoJob.findUnique({
      where: { id: videoJobId },
      select: {
        id: true, title: true, mode: true, status: true, progress: true, error: true, plan: true,
        outputMediaId: true, sourceSopId: true, sourceCourseId: true,
      },
    });
    if (!job) return fail("That video job no longer exists.");
    return ok({ ...job, plan: job.plan as unknown as VideoPlan | null });
  });
}

export async function checkVideoOutdatedAction(mediaId: string): Promise<ActionResult<VideoOutdatedInfo>> {
  return runAction("checkVideoOutdated", async () => {
    await assertPermission("ai.video");
    const info = await isVideoOutdated(mediaId);
    return ok(info);
  });
}
