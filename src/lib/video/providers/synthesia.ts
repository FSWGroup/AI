import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { VideoProvider, VideoRenderRequest, VideoRenderResult } from "@/lib/ai/types";

/**
 * Synthesia avatar-presenter adapter.
 *
 * isAvailable() is false — and render() is never called by the registry —
 * without SYNTHESIA_API_KEY configured. When it is configured, this drives
 * the real create → poll → download flow against the v2 videos API.
 */

const API_BASE = "https://api.synthesia.io/v2";
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000; // Synthesia renders typically take longer than HeyGen's.

interface SynthesiaScriptInput {
  scriptText: string;
  avatar?: string;
  background?: string;
}

export class SynthesiaVideoProvider implements VideoProvider {
  readonly key = "synthesia";
  readonly label = "Synthesia AI Avatar";
  readonly supportedModes = ["AVATAR"];

  isAvailable(): boolean {
    return Boolean(process.env.SYNTHESIA_API_KEY?.trim());
  }

  private apiKey(): string {
    const key = process.env.SYNTHESIA_API_KEY?.trim();
    if (!key) throw new Error("SYNTHESIA_API_KEY is not configured.");
    return key;
  }

  async render(request: VideoRenderRequest): Promise<VideoRenderResult> {
    const apiKey = this.apiKey();
    // The author's per-job "voice/avatar" choice from the Video Studio wizard
    // takes precedence over the environment default.
    const avatar = request.voice?.trim() || process.env.SYNTHESIA_AVATAR_ID?.trim() || "anna_costume1_cameraA";
    const background = process.env.SYNTHESIA_BACKGROUND_ID?.trim();

    const input: SynthesiaScriptInput[] = request.scenes.map((scene) => ({
      scriptText: scene.narration,
      avatar,
      ...(background ? { background } : {}),
    }));

    const createResponse = await fetch(`${API_BASE}/videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: apiKey },
      body: JSON.stringify({
        test: false,
        title: request.title,
        visibility: "private",
        aspectRatio: request.aspectRatio === "9:16" ? "9:16" : request.aspectRatio === "1:1" ? "1:1" : "16:9",
        input,
      }),
    });

    if (!createResponse.ok) {
      const detail = await createResponse.text().catch(() => "");
      throw new Error(`Synthesia video creation failed (${createResponse.status}): ${detail.slice(0, 400)}`);
    }

    const created = (await createResponse.json()) as { id?: string };
    const videoId = created.id;
    if (!videoId) {
      throw new Error(`Synthesia did not return a video id: ${JSON.stringify(created).slice(0, 400)}`);
    }

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let downloadUrl: string | null = null;
    let durationSeconds = 0;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const statusResponse = await fetch(`${API_BASE}/videos/${encodeURIComponent(videoId)}`, {
        headers: { Authorization: apiKey },
      });
      if (!statusResponse.ok) continue;

      const status = (await statusResponse.json()) as {
        status?: string;
        download?: string;
        duration?: number;
      };

      if (status.status === "complete") {
        downloadUrl = status.download ?? null;
        durationSeconds = status.duration ?? 0;
        break;
      }
      if (status.status === "failed" || status.status === "rejected") {
        throw new Error(`Synthesia render ${status.status}.`);
      }
      // "in_progress"/"queued" — keep polling.
    }

    if (!downloadUrl) {
      throw new Error("Synthesia video did not complete within the polling timeout.");
    }

    const download = await fetch(downloadUrl);
    if (!download.ok) throw new Error(`Failed to download the Synthesia video (${download.status}).`);

    const outputPath = path.join(os.tmpdir(), `fsw-video-synthesia-${request.jobId}.mp4`);
    await fs.writeFile(outputPath, Buffer.from(await download.arrayBuffer()));

    return { outputPath, durationSeconds, provider: this.key };
  }
}

export const synthesiaVideoProvider = new SynthesiaVideoProvider();
