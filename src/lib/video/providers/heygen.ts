import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { VideoProvider, VideoRenderRequest, VideoRenderResult } from "@/lib/ai/types";
import { ASPECT_RATIO_DIMENSIONS, type AspectRatio } from "@/lib/video/types";

/**
 * HeyGen avatar-presenter adapter.
 *
 * isAvailable() is false — and render() is never called by the registry —
 * without HEYGEN_API_KEY configured. When it is configured, this drives the
 * real v2 generate → poll → download flow.
 */

const API_BASE = "https://api.heygen.com";
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

interface HeygenVideoInput {
  character: { type: "avatar"; avatar_id: string; avatar_style?: string };
  voice: { type: "text"; input_text: string; voice_id?: string };
  background?: { type: "color"; value: string };
}

export class HeyGenVideoProvider implements VideoProvider {
  readonly key = "heygen";
  readonly label = "HeyGen AI Avatar";
  readonly supportedModes = ["AVATAR"];

  isAvailable(): boolean {
    return Boolean(process.env.HEYGEN_API_KEY?.trim());
  }

  private apiKey(): string {
    const key = process.env.HEYGEN_API_KEY?.trim();
    if (!key) throw new Error("HEYGEN_API_KEY is not configured.");
    return key;
  }

  async render(request: VideoRenderRequest): Promise<VideoRenderResult> {
    const apiKey = this.apiKey();
    const dims = ASPECT_RATIO_DIMENSIONS[request.aspectRatio as AspectRatio] ?? ASPECT_RATIO_DIMENSIONS["16:9"];

    const avatarId = process.env.HEYGEN_AVATAR_ID?.trim() || "default";
    const voiceId = process.env.HEYGEN_VOICE_ID?.trim();

    const videoInputs: HeygenVideoInput[] = request.scenes.map((scene) => ({
      character: { type: "avatar", avatar_id: avatarId, avatar_style: "normal" },
      voice: { type: "text", input_text: scene.narration, ...(voiceId ? { voice_id: voiceId } : {}) },
      background: { type: "color", value: request.brand.secondaryColor },
    }));

    const createResponse = await fetch(`${API_BASE}/v2/video/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
      body: JSON.stringify({
        video_inputs: videoInputs,
        dimension: { width: dims.width, height: dims.height },
        title: request.title,
      }),
    });

    if (!createResponse.ok) {
      const detail = await createResponse.text().catch(() => "");
      throw new Error(`HeyGen video creation failed (${createResponse.status}): ${detail.slice(0, 400)}`);
    }

    const created = (await createResponse.json()) as { data?: { video_id?: string }; error?: unknown };
    const videoId = created.data?.video_id;
    if (!videoId) {
      throw new Error(`HeyGen did not return a video_id: ${JSON.stringify(created).slice(0, 400)}`);
    }

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let videoUrl: string | null = null;
    let durationSeconds = 0;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const statusResponse = await fetch(`${API_BASE}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
        headers: { "X-Api-Key": apiKey },
      });
      if (!statusResponse.ok) continue;

      const status = (await statusResponse.json()) as {
        data?: { status?: string; video_url?: string; duration?: number; error?: unknown };
      };
      const state = status.data?.status;

      if (state === "completed") {
        videoUrl = status.data?.video_url ?? null;
        durationSeconds = status.data?.duration ?? 0;
        break;
      }
      if (state === "failed") {
        throw new Error(`HeyGen render failed: ${JSON.stringify(status.data?.error ?? status.data).slice(0, 400)}`);
      }
      // "processing"/"pending" — keep polling.
    }

    if (!videoUrl) {
      throw new Error("HeyGen video did not complete within the polling timeout.");
    }

    const download = await fetch(videoUrl);
    if (!download.ok) throw new Error(`Failed to download the HeyGen video (${download.status}).`);

    const outputPath = path.join(os.tmpdir(), `fsw-video-heygen-${request.jobId}.mp4`);
    await fs.writeFile(outputPath, Buffer.from(await download.arrayBuffer()));

    return { outputPath, durationSeconds, provider: this.key };
  }
}

export const heygenVideoProvider = new HeyGenVideoProvider();
