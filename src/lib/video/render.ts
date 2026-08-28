import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { getStorage, buildStorageKey } from "@/lib/storage";
import { getSettings } from "@/lib/settings";
import { getTTSProvider } from "@/lib/ai/index";
import { loadActorForJob } from "@/lib/ai/generate";
import { generateVideoPlan } from "@/lib/video/plan";
import { getVideoProvider } from "@/lib/video/registry";
import { probeDurationSeconds } from "@/lib/video/providers/ffmpeg";
import type { VideoBrand, VideoPlan } from "@/lib/video/types";
import type { VideoRenderRequest } from "@/lib/ai/types";

/**
 * Video job orchestration.
 *
 * Two job handlers, both imported by the worker:
 *  - handleGenerateVideoPlanJob: QUEUED → GENERATING_SCRIPT → AWAITING_REVIEW.
 *    Produces the editable plan; the author reviews and edits it before
 *    anything renders.
 *  - handleRenderVideoJob: AWAITING_REVIEW → GENERATING_AUDIO →
 *    CREATING_SCENES → RENDERING → UPLOADING → COMPLETE (or FAILED).
 *    Only runs once the author has approved the plan.
 *
 * Both are idempotent: re-running a COMPLETE job is a no-op, and a crash
 * mid-render simply re-does the work on retry without ever producing a
 * second MediaAsset for the same job (outputMediaId is only ever set once,
 * at the very end, after a successful upload).
 */

const MIN_SCENE_SECONDS = 2;
const MAX_SCENE_SECONDS = 90;

async function resolveBrand(): Promise<VideoBrand> {
  const settings = await getSettings();
  return {
    appName: settings.brand.appName,
    companyName: settings.brand.companyName,
    primaryColor: settings.brand.primaryColor,
    secondaryColor: settings.brand.secondaryColor,
    accentColor: settings.brand.accentColor,
  };
}

async function loadVideoJob(videoJobId: string) {
  const job = await prisma.videoJob.findUnique({ where: { id: videoJobId } });
  if (!job) throw new Error(`VideoJob ${videoJobId} not found.`);
  return job;
}

async function markFailed(videoJobId: string, error: unknown): Promise<never> {
  const message = error instanceof Error ? error.message : String(error);
  await prisma.videoJob.update({
    where: { id: videoJobId },
    data: { status: "FAILED", error: message.slice(0, 2000) },
  });
  throw error instanceof Error ? error : new Error(message);
}

// ---------------------------------------------------------------------------
// Plan generation job
// ---------------------------------------------------------------------------

export async function handleGenerateVideoPlanJob(payload: Record<string, unknown>): Promise<void> {
  const videoJobId = payload.videoJobId;
  if (typeof videoJobId !== "string") {
    throw new Error(`generate_video_plan job received an invalid payload: ${JSON.stringify(payload)}`);
  }

  const job = await loadVideoJob(videoJobId);

  // Idempotent: a plan already produced (or further along) is left alone.
  // "Regenerate" is a deliberate author action that resets status to QUEUED
  // before re-enqueueing this job type.
  if (job.status !== "QUEUED" && job.status !== "GENERATING_SCRIPT") return;

  try {
    await prisma.videoJob.update({
      where: { id: videoJobId },
      data: { status: "GENERATING_SCRIPT", progress: 10, error: null },
    });

    const actor = await loadActorForJob(job.createdById);
    const plan = await generateVideoPlan(actor, {
      mode: job.mode,
      sourceType: job.sourceType,
      prompt: job.prompt,
      sourceText: job.sourceText,
      sourceSopId: job.sourceSopId,
      sourceCourseId: job.sourceCourseId,
      aspectRatio: job.aspectRatio,
    });

    await prisma.videoJob.update({
      where: { id: videoJobId },
      data: { plan: plan as unknown as Prisma.InputJsonValue, status: "AWAITING_REVIEW", progress: 100 },
    });
  } catch (error) {
    await markFailed(videoJobId, error);
  }
}

// ---------------------------------------------------------------------------
// Render job
// ---------------------------------------------------------------------------

function sceneDuration(estimatedSeconds: number, narrationSeconds: number | undefined): number {
  const raw = narrationSeconds && narrationSeconds > 0 ? narrationSeconds : estimatedSeconds;
  return Math.min(MAX_SCENE_SECONDS, Math.max(MIN_SCENE_SECONDS, raw));
}

export async function handleRenderVideoJob(payload: Record<string, unknown>): Promise<void> {
  const videoJobId = payload.videoJobId;
  if (typeof videoJobId !== "string") {
    throw new Error(`render_video job received an invalid payload: ${JSON.stringify(payload)}`);
  }

  const job = await loadVideoJob(videoJobId);

  // Idempotent success path: never re-render (and never create a second
  // MediaAsset) for a job that has already completed.
  if (job.status === "COMPLETE") return;

  const plan = job.plan as unknown as VideoPlan | null;
  if (!plan || !Array.isArray(plan.scenes) || plan.scenes.length === 0) {
    await markFailed(videoJobId, new Error("This video has no reviewed plan to render yet."));
    return;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `fsw-narration-${videoJobId}-`));

  try {
    await prisma.videoJob.update({
      where: { id: videoJobId },
      data: { status: "GENERATING_AUDIO", progress: 10, error: null, attemptCount: { increment: 1 } },
    });

    const ttsProvider = getTTSProvider();
    const narrationAudio: { sceneIndex: number; path: string; durationSeconds: number }[] = [];

    if (ttsProvider) {
      for (const scene of plan.scenes) {
        try {
          const result = await ttsProvider.synthesize({
            text: scene.narration,
            voice: job.voice ?? undefined,
            language: job.language,
          });
          const ext = result.mimeType.includes("wav") ? "wav" : "mp3";
          const audioPath = path.join(tempDir, `scene-${scene.index}.${ext}`);
          await fs.writeFile(audioPath, result.audio);
          const durationSeconds = result.durationSeconds ?? (await probeDurationSeconds(audioPath));
          narrationAudio.push({ sceneIndex: scene.index, path: audioPath, durationSeconds });
        } catch (error) {
          // Narration is a quality enhancement, not a hard requirement — a
          // scene that fails to synthesize just renders silent with its
          // estimated reading time, rather than failing the whole video.
          console.error("[video/render] narration synthesis failed for one scene; continuing without it", {
            videoJobId,
            sceneIndex: scene.index,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    await prisma.videoJob.update({
      where: { id: videoJobId },
      data: { status: "CREATING_SCENES", progress: 40 },
    });

    const brand = await resolveBrand();
    const provider = getVideoProvider(job.mode);

    const request: VideoRenderRequest = {
      jobId: job.id,
      title: job.title,
      mode: job.mode,
      scenes: plan.scenes,
      aspectRatio: (job.aspectRatio as VideoRenderRequest["aspectRatio"]) ?? "16:9",
      language: job.language,
      voice: job.voice ?? undefined,
      brand,
      narrationAudio: narrationAudio.length > 0 ? narrationAudio : undefined,
    };

    await prisma.videoJob.update({
      where: { id: videoJobId },
      data: { status: "RENDERING", progress: 55, provider: provider.key },
    });

    const rendered = await provider.render(request);

    await prisma.videoJob.update({
      where: { id: videoJobId },
      data: { status: "UPLOADING", progress: 85 },
    });

    const fileBuffer = await fs.readFile(rendered.outputPath);
    const storage = getStorage();
    const storageKey = buildStorageKey("video", `${job.title}.mp4`);
    const stored = await storage.put(storageKey, fileBuffer, "video/mp4");
    await fs.unlink(rendered.outputPath).catch(() => undefined);

    const chapters = plan.scenes.reduce<{ title: string; startSeconds: number }[]>((acc, scene) => {
      const previous = acc[acc.length - 1];
      const startSeconds = previous
        ? previous.startSeconds +
          sceneDuration(
            plan.scenes[acc.length - 1]!.estimatedSeconds,
            narrationAudio.find((n) => n.sceneIndex === plan.scenes[acc.length - 1]!.index)?.durationSeconds,
          )
        : 0;
      acc.push({ title: scene.title, startSeconds });
      return acc;
    }, []);

    const media = await prisma.mediaAsset.create({
      data: {
        kind: "GENERATED",
        filename: `${job.title}.mp4`,
        title: job.title,
        mimeType: "video/mp4",
        sizeBytes: stored.sizeBytes,
        storagePath: stored.storagePath,
        sha256: stored.sha256,
        ownerId: job.createdById,
        durationSeconds: rendered.durationSeconds,
        captionsVtt: rendered.captionsVtt ?? null,
        chapters: chapters as unknown as Prisma.InputJsonValue,
        processingStatus: "READY",
      },
      select: { id: true },
    });

    await prisma.videoJob.update({
      where: { id: videoJobId },
      data: { status: "COMPLETE", progress: 100, outputMediaId: media.id },
    });

    if (job.sourceSopId) {
      await prisma.contentRelationship.upsert({
        where: {
          fromEntityType_fromEntityId_toEntityType_toEntityId_relation: {
            fromEntityType: "MEDIA",
            fromEntityId: media.id,
            toEntityType: "SOP",
            toEntityId: job.sourceSopId,
            relation: "GENERATED_FROM",
          },
        },
        create: {
          fromEntityType: "MEDIA",
          fromEntityId: media.id,
          toEntityType: "SOP",
          toEntityId: job.sourceSopId,
          relation: "GENERATED_FROM",
          metadata: { sopVersion: job.sourceSopVersion } as unknown as Prisma.InputJsonValue,
        },
        update: {
          metadata: { sopVersion: job.sourceSopVersion } as unknown as Prisma.InputJsonValue,
        },
      });
    }
  } catch (error) {
    await markFailed(videoJobId, error);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// "Generated from SOP version X — may be outdated"
// ---------------------------------------------------------------------------

export interface VideoOutdatedInfo {
  tracked: boolean;
  outdated: boolean;
  sourceSopId?: string;
  sourceSopTitle?: string;
  recordedVersion?: string;
  currentVersion?: string;
}

/** Compares the SOP version a video was generated from against the SOP's current version. */
export async function isVideoOutdated(mediaId: string): Promise<VideoOutdatedInfo> {
  const relationship = await prisma.contentRelationship.findFirst({
    where: { fromEntityType: "MEDIA", fromEntityId: mediaId, relation: "GENERATED_FROM", toEntityType: "SOP" },
    select: { toEntityId: true, metadata: true },
  });
  if (!relationship) return { tracked: false, outdated: false };

  const sop = await prisma.sop.findUnique({
    where: { id: relationship.toEntityId },
    select: { title: true, currentVersion: { select: { versionNumber: true } } },
  });

  const recordedVersion = (relationship.metadata as { sopVersion?: string } | null)?.sopVersion;
  const currentVersion = sop?.currentVersion?.versionNumber;

  return {
    tracked: true,
    outdated: Boolean(recordedVersion && currentVersion && recordedVersion !== currentVersion),
    sourceSopId: relationship.toEntityId,
    sourceSopTitle: sop?.title,
    recordedVersion,
    currentVersion,
  };
}
