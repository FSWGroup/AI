import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { testPrisma } from "./helpers";
import { getVideoProvider } from "@/lib/video/registry";
import type { VideoRenderRequest, VideoScene } from "@/lib/ai/types";

/**
 * Local branded video rendering.
 *
 * FSW Academy must be able to produce a real FSW-branded training video with no
 * external video vendor configured — that is the whole point of the local
 * pipeline. So this test renders one and inspects the output with ffprobe rather
 * than trusting that the function returned a path.
 */

const OUTPUTS: string[] = [];

function ffprobe(file: string): Record<string, unknown> {
  const raw = execFileSync(
    process.env.FFPROBE_PATH ?? "ffprobe",
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      file,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  return JSON.parse(raw) as Record<string, unknown>;
}

function scenes(): VideoScene[] {
  return [
    {
      index: 0,
      title: "Why quoting accuracy matters",
      narration:
        "A quote is a commitment in the customer's eyes. It should be accurate the first time.",
      onScreenText: ["Accurate the first time", "Technically correct", "Traceable"],
      visualStyle: "steps",
      estimatedSeconds: 3,
    },
    {
      index: 1,
      title: "Before you start",
      narration: "Confirm you have the customer's written request, quantity, and required date.",
      onScreenText: ["Written request", "Quantity and date", "Correct account"],
      visualStyle: "callout",
      estimatedSeconds: 3,
    },
  ];
}

function request(overrides: Partial<VideoRenderRequest> = {}): VideoRenderRequest {
  return {
    jobId: `test-${Date.now()}`,
    title: "Create a Customer Quote",
    mode: "EXPLAINER",
    scenes: scenes(),
    aspectRatio: "16:9",
    language: "en",
    brand: {
      appName: "FSW Academy",
      companyName: "FSW Group",
      primaryColor: "#17365c",
      secondaryColor: "#2575eb",
      accentColor: "#f98d07",
    },
    ...overrides,
  };
}

afterAll(async () => {
  for (const file of OUTPUTS) {
    await fs.rm(file, { force: true }).catch(() => {});
  }
  await testPrisma.$disconnect();
});

describe("the local ffmpeg provider", () => {
  it("is available without any external video credentials", () => {
    // No HEYGEN_API_KEY or SYNTHESIA_API_KEY is set in the test environment.
    const provider = getVideoProvider("EXPLAINER");
    expect(provider).toBeTruthy();
    expect(provider?.isAvailable()).toBe(true);
    // The local renderer, not an external vendor.
    expect(provider?.key).toMatch(/ffmpeg/);
  });

  it("does not offer the avatar mode when no avatar provider is configured", () => {
    const provider = getVideoProvider("AVATAR");
    // Either no provider, or a fallback that is explicitly not an avatar vendor.
    if (provider) {
      expect(provider.key).not.toBe("heygen");
      expect(provider.key).not.toBe("synthesia");
    }
  });

  it("renders a playable MP4 with the requested dimensions", async () => {
    const provider = getVideoProvider("EXPLAINER");
    expect(provider).toBeTruthy();

    const result = await provider!.render(request());
    OUTPUTS.push(result.outputPath);

    const stat = await fs.stat(result.outputPath);
    expect(stat.size).toBeGreaterThan(2000);

    const probe = ffprobe(result.outputPath);
    const format = probe.format as { format_name?: string; duration?: string };
    const streams = probe.streams as {
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
    }[];

    expect(format.format_name ?? "").toContain("mp4");

    const video = streams.find((s) => s.codec_type === "video");
    expect(video, "the output has no video stream").toBeTruthy();
    expect(video?.codec_name).toBe("h264");
    expect(video?.width).toBe(1920);
    expect(video?.height).toBe(1080);

    // The scenes total six seconds; allow generous slack for intro/outro.
    expect(result.durationSeconds).toBeGreaterThan(1);
    expect(Number(format.duration ?? 0)).toBeGreaterThan(1);
  }, 180_000);

  it("renders vertical and square aspect ratios", async () => {
    const provider = getVideoProvider("QUICK_CLIP");
    expect(provider).toBeTruthy();

    const vertical = await provider!.render(
      request({ aspectRatio: "9:16", mode: "QUICK_CLIP", scenes: scenes().slice(0, 1) }),
    );
    OUTPUTS.push(vertical.outputPath);

    const verticalStreams = (ffprobe(vertical.outputPath).streams as {
      codec_type?: string;
      width?: number;
      height?: number;
    }[]).find((s) => s.codec_type === "video");
    expect(verticalStreams?.width).toBe(1080);
    expect(verticalStreams?.height).toBe(1920);

    const square = await provider!.render(
      request({ aspectRatio: "1:1", mode: "QUICK_CLIP", scenes: scenes().slice(0, 1) }),
    );
    OUTPUTS.push(square.outputPath);

    const squareStreams = (ffprobe(square.outputPath).streams as {
      codec_type?: string;
      width?: number;
      height?: number;
    }[]).find((s) => s.codec_type === "video");
    expect(squareStreams?.width).toBe(1080);
    expect(squareStreams?.height).toBe(1080);
  }, 240_000);

  it("produces a caption track covering every scene", async () => {
    const provider = getVideoProvider("SAFETY_BRIEFING");
    const result = await provider!.render(request({ mode: "SAFETY_BRIEFING" }));
    OUTPUTS.push(result.outputPath);

    expect(result.captionsVtt).toBeTruthy();
    const vtt = result.captionsVtt ?? "";

    // A valid WebVTT file starts with the signature and has timed cues.
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/);

    // Every scene's narration should be represented.
    for (const scene of scenes()) {
      const firstWords = scene.narration.split(/\s+/).slice(0, 3).join(" ");
      expect(vtt, `caption track is missing scene ${scene.index}`).toContain(firstWords);
    }
  }, 180_000);

  it("renders without narration audio when text to speech is unavailable", async () => {
    // No TTS provider is configured, so narrationAudio is absent. The video must
    // still render with on-screen text and captions.
    const provider = getVideoProvider("SLIDES");
    const result = await provider!.render(request({ mode: "SLIDES", narrationAudio: undefined }));
    OUTPUTS.push(result.outputPath);

    const probe = ffprobe(result.outputPath);
    const streams = probe.streams as { codec_type?: string }[];
    expect(streams.some((s) => s.codec_type === "video")).toBe(true);
    expect(result.captionsVtt).toBeTruthy();
  }, 180_000);

  it("muxes narration audio when it is supplied", async () => {
    const provider = getVideoProvider("EXPLAINER");

    // Generate two short silent tracks standing in for TTS output.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fsw-narration-"));
    const audioPaths: { sceneIndex: number; path: string; durationSeconds: number }[] = [];
    for (const index of [0, 1]) {
      const file = path.join(dir, `scene-${index}.mp3`);
      execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=mono",
        "-t",
        "3",
        "-q:a",
        "9",
        "-y",
        file,
      ]);
      audioPaths.push({ sceneIndex: index, path: file, durationSeconds: 3 });
    }

    const result = await provider!.render(request({ narrationAudio: audioPaths }));
    OUTPUTS.push(result.outputPath);

    const streams = ffprobe(result.outputPath).streams as {
      codec_type?: string;
      codec_name?: string;
    }[];
    expect(
      streams.some((s) => s.codec_type === "audio"),
      "narration audio was supplied but the output has no audio stream",
    ).toBe(true);

    await fs.rm(dir, { recursive: true, force: true });
  }, 240_000);

  it("handles a single-scene video", async () => {
    const provider = getVideoProvider("QUICK_CLIP");
    const result = await provider!.render(
      request({ mode: "QUICK_CLIP", scenes: scenes().slice(0, 1) }),
    );
    OUTPUTS.push(result.outputPath);

    const stat = await fs.stat(result.outputPath);
    expect(stat.size).toBeGreaterThan(1000);
  }, 180_000);

  it("handles narration containing characters that must be escaped", async () => {
    const provider = getVideoProvider("EXPLAINER");
    const tricky: VideoScene[] = [
      {
        index: 0,
        title: "Pricing: 10% — 20% (manager approval)",
        narration:
          "Discounts over 20% need approval; document the reason in the quote's notes. " +
          'Use "written approval" where required — see SOP SALES-001, section 4.2.',
        onScreenText: ["10% — 20%: Sales Manager", 'Over 20%: "written approval"', "C:\\path\\file"],
        estimatedSeconds: 3,
      },
    ];

    // Special characters in drawtext are a classic source of broken renders.
    const result = await provider!.render(request({ scenes: tricky }));
    OUTPUTS.push(result.outputPath);

    const streams = ffprobe(result.outputPath).streams as { codec_type?: string }[];
    expect(streams.some((s) => s.codec_type === "video")).toBe(true);
  }, 180_000);
});
