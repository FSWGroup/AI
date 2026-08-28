import "server-only";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import type { VideoProvider, VideoRenderRequest, VideoRenderResult, VideoScene } from "@/lib/ai/types";
import { ASPECT_RATIO_DIMENSIONS, VIDEO_MODES, type AspectRatio } from "@/lib/video/types";

/**
 * The local, FSW-branded video renderer.
 *
 * No external video API, no credentials — this is the provider every video
 * mode falls back to (and the only one for everything except AVATAR, which
 * prefers HeyGen/Synthesia when configured). It builds one branded SVG slide
 * per scene, rasterizes it through ffmpeg's built-in librsvg decoder, mixes
 * in narration audio when available, and concatenates the scenes into a
 * single H.264 MP4 at the requested aspect ratio.
 */

const execFileAsync = promisify(execFile);

function ffmpegBin(): string {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

/** Derive the ffprobe binary from FFMPEG_PATH's directory when it's a real path, else assume PATH. */
function ffprobeBin(): string {
  const bin = ffmpegBin();
  const dir = path.dirname(bin);
  if (dir && dir !== "." && fsSync.existsSync(path.join(dir, "ffprobe"))) {
    return path.join(dir, "ffprobe");
  }
  return "ffprobe";
}

let cachedAvailability: boolean | undefined;

function commandResolvesOnPath(bin: string): boolean {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Verify the configured ffmpeg binary actually exists and runs, per the spec's "verify via which". */
function checkFfmpegAvailable(): boolean {
  const bin = ffmpegBin();
  const looksLikeAPath = bin.includes("/") || bin.includes("\\");
  const resolvable = looksLikeAPath ? fsSync.existsSync(bin) : commandResolvesOnPath(bin);
  if (!resolvable) return false;

  try {
    execFileSync(bin, ["-version"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function isFfmpegAvailable(): boolean {
  if (cachedAvailability === undefined) cachedAvailability = checkFfmpegAvailable();
  return cachedAvailability;
}

/** Test seam: force a re-check (the binary can appear mid-process in dev). */
export function __resetFfmpegAvailabilityCache(): void {
  cachedAvailability = undefined;
}

/** Probe a media file's duration with ffprobe. Returns 0 if the file has no readable duration. */
export async function probeDurationSeconds(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(ffprobeBin(), [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const value = Number.parseFloat(stdout.trim());
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch (error) {
    console.error("[ffmpeg] duration probe failed", {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

// ---------------------------------------------------------------------------
// SVG scene rendering
// ---------------------------------------------------------------------------

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Greedy word-wrap by estimated character width, since SVG <text> never wraps on its own. */
function wrapText(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = candidate;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);

  const consumed = lines.join(" ").length;
  const total = words.join(" ").length;
  if (consumed < total && lines.length > 0) {
    const last = lines[lines.length - 1]!;
    lines[lines.length - 1] = last.length > 3 ? `${last.slice(0, -1)}…` : `${last}…`;
  }
  return lines;
}

interface SceneSvgOptions {
  scene: VideoScene;
  sceneNumber: number;
  totalScenes: number;
  width: number;
  height: number;
  mode: string;
  brand: VideoRenderRequest["brand"];
}

/**
 * Bottom edge of the logo/header row, in pixels, for a given frame width.
 * Width-based (not height-based) so it reads at a consistent visual weight
 * across 16:9, 9:16, and 1:1 — shared by the scene SVG (bullets must start
 * below it) and by burned captions (which must not collide with it either).
 */
function headerRowBottom(width: number): number {
  const logoUnit = width * 0.012;
  const logoY = width * 0.033;
  return logoY + logoUnit * 6.5;
}

/**
 * One FSW-branded slide: a navy field, the FSW mark, a lower-third title
 * band in the accent color, up to a few on-screen bullet lines, and a
 * chapter indicator. Pure geometry and text — no external image assets are
 * required, so this always renders regardless of what media the author
 * attached.
 */
function buildSceneSvg(opts: SceneSvgOptions): string {
  const { scene, sceneNumber, totalScenes, width, height, mode, brand } = opts;

  const bandY = Math.round(height * 0.62);
  const bandHeight = height - bandY;
  const marginX = Math.round(width * 0.055);
  const titleFontSize = Math.round(width * 0.042);
  const bulletFontSize = Math.round(width * 0.02);
  const headerFontSize = Math.round(width * 0.016);

  const titleMaxChars = Math.max(10, Math.floor((width - marginX * 2) / (titleFontSize * 0.56)));
  const titleLines = wrapText(scene.title, titleMaxChars, 2);

  const bulletMaxChars = Math.max(14, Math.floor((width - marginX * 2) / (bulletFontSize * 0.56)));

  const logoUnit = Math.round(width * 0.012);
  const logoX = marginX;
  const logoY = Math.round(width * 0.033);
  const bulletsAreaTop = Math.round(headerRowBottom(width) + logoUnit * 4);

  // Bullets must stay clear of the lower-third band, whatever the aspect ratio.
  const bulletsAreaHeight = Math.max(0, bandY - Math.round(height * 0.03) - bulletsAreaTop);
  const maxBullets = Math.max(1, Math.floor(bulletsAreaHeight / (bulletFontSize * 1.8)));
  const bullets = scene.onScreenText.slice(0, maxBullets);

  const titleStartY = bandY + Math.round(bandHeight * 0.34);

  const titleTspans = titleLines
    .map((line, i) => `<tspan x="${marginX}" dy="${i === 0 ? 0 : titleFontSize * 1.15}">${escapeXml(line)}</tspan>`)
    .join("");

  const bulletLines = bullets
    .map((bullet, i) => {
      const wrapped = wrapText(bullet, bulletMaxChars, 1)[0] ?? "";
      const y = bulletsAreaTop + i * bulletFontSize * 1.8;
      return `
        <circle cx="${marginX + 6}" cy="${y - bulletFontSize * 0.32}" r="${Math.max(3, bulletFontSize * 0.14)}" fill="${brand.accentColor}" />
        <text x="${marginX + bulletFontSize * 1.1}" y="${y}" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="${bulletFontSize}" fill="#eef0f4">${escapeXml(wrapped)}</text>
      `;
    })
    .join("");

  const chapterLabel = `Scene ${sceneNumber} of ${totalScenes}`;
  const modeLabel = VIDEO_MODES.includes(mode as (typeof VIDEO_MODES)[number]) ? mode.replace(/_/g, " ") : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="band" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${brand.secondaryColor}" stop-opacity="0.0" />
      <stop offset="100%" stop-color="${brand.secondaryColor}" stop-opacity="1" />
    </linearGradient>
  </defs>

  <rect x="0" y="0" width="${width}" height="${height}" fill="${brand.primaryColor}" />
  <rect x="0" y="${Math.round(height * 0.42)}" width="${width}" height="${Math.round(height * 0.2)}" fill="url(#band)" />
  <rect x="0" y="${bandY}" width="${width}" height="${bandHeight}" fill="${brand.secondaryColor}" />
  <rect x="0" y="${bandY}" width="${width}" height="${Math.max(4, Math.round(height * 0.006))}" fill="${brand.accentColor}" />

  <!-- FSW mark: three ascending bars -->
  <rect x="${logoX}" y="${logoY + logoUnit * 3.2}" width="${logoUnit * 1.6}" height="${logoUnit * 2.6}" fill="#ffffff" opacity="0.7" />
  <rect x="${logoX + logoUnit * 2.1}" y="${logoY + logoUnit * 1.8}" width="${logoUnit * 1.6}" height="${logoUnit * 4}" fill="#ffffff" opacity="0.85" />
  <rect x="${logoX + logoUnit * 4.2}" y="${logoY}" width="${logoUnit * 1.6}" height="${logoUnit * 5.8}" fill="#ffffff" />
  <text x="${logoX + logoUnit * 6.4}" y="${logoY + logoUnit * 4.2}" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="${headerFontSize}" font-weight="bold" letter-spacing="1" fill="#ffffff">${escapeXml(brand.appName.toUpperCase())}</text>

  ${modeLabel ? `<text x="${width - marginX}" y="${logoY + logoUnit * 4.2}" text-anchor="end" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="${headerFontSize}" letter-spacing="1" fill="#c9d6e8">${escapeXml(modeLabel.toUpperCase())}</text>` : ""}

  ${bulletLines}

  <text x="${marginX}" y="${titleStartY}" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="${titleFontSize}" font-weight="bold" fill="#ffffff">${titleTspans}</text>

  <text x="${width - marginX}" y="${height - Math.round(height * 0.035)}" text-anchor="end" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="${headerFontSize}" fill="#9aa5b8">${escapeXml(chapterLabel)}</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

function formatVttTimestamp(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

interface SceneTiming {
  scene: VideoScene;
  startSeconds: number;
  durationSeconds: number;
}

/** Build a VTT track from the scenes actually rendered, using their real durations. */
function buildCaptionsVtt(timings: SceneTiming[]): string {
  const lines = ["WEBVTT", ""];
  for (const { scene, startSeconds, durationSeconds } of timings) {
    const text = (scene.narration || scene.onScreenText.join(" ")).trim();
    if (!text) continue;
    lines.push(`${formatVttTimestamp(startSeconds)} --> ${formatVttTimestamp(startSeconds + durationSeconds)}`);
    lines.push(text);
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// ffmpeg orchestration
// ---------------------------------------------------------------------------

async function runFfmpeg(args: string[]): Promise<void> {
  try {
    await execFileAsync(ffmpegBin(), args, { maxBuffer: 1024 * 1024 * 32 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`ffmpeg command failed: ${detail.slice(0, 1000)}`);
  }
}

async function renderSceneClip(input: {
  svgPath: string;
  outPath: string;
  durationSeconds: number;
  width: number;
  height: number;
  narrationAudioPath?: string;
}): Promise<void> {
  const args = ["-y", "-loop", "1", "-i", input.svgPath];

  if (input.narrationAudioPath) {
    args.push("-i", input.narrationAudioPath);
  } else {
    args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
  }

  args.push(
    "-t",
    input.durationSeconds.toFixed(2),
    "-r",
    "30",
    "-vf",
    `scale=${input.width}:${input.height}:force_original_aspect_ratio=decrease,pad=${input.width}:${input.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    "-c:v",
    "libx264",
    "-tune",
    "stillimage",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    // Force a uniform sample rate/channel layout on every scene's audio
    // track, narrated or silent. Without this, a narration file at a
    // different native sample rate than the silent anullsrc track (44100)
    // makes the concat demuxer misread timestamps across the join and can
    // roughly double the reported/actual duration of the concatenated file.
    "-ar",
    "44100",
    "-ac",
    "2",
    "-b:a",
    "128k",
    "-shortest",
    input.outPath,
  );

  await runFfmpeg(args);
}

async function concatClips(clipPaths: string[], listPath: string, outPath: string): Promise<void> {
  const listContent = clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  await fs.writeFile(listPath, listContent, "utf8");
  await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
}

/** Best-effort path to a real TrueType font file, for filters that need one directly. */
const DEJAVU_BOLD_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const DEJAVU_REGULAR_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

function resolveFontFile(): string {
  if (fsSync.existsSync(DEJAVU_BOLD_FONT)) return DEJAVU_BOLD_FONT;
  if (fsSync.existsSync(DEJAVU_REGULAR_FONT)) return DEJAVU_REGULAR_FONT;
  return DEJAVU_BOLD_FONT; // let ffmpeg raise a clear error if truly missing
}

/** Escape a filesystem path for use as a value inside an ffmpeg filtergraph argument. */
function escapeFilterPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/**
 * Burns captions in using one `drawtext` layer per caption cue, each reading
 * its line from its own text file (sidestepping ffmpeg's escaping rules for
 * inline text entirely) and gated to its time window with `enable=between(...)`.
 *
 * This is deliberately not the `subtitles` filter: that filter renders
 * WebVTT through a libass ASS conversion whose default script resolution
 * does not track the actual output frame size in this environment, which
 * blew caption text up to several times the intended size. Driving drawtext
 * directly from the same scene timings used to render the video keeps sizing
 * and position exactly under our control.
 */
async function burnInCaptions(
  inputPath: string,
  timings: SceneTiming[],
  workDir: string,
  outPath: string,
  width: number,
  height: number,
): Promise<void> {
  const fontSize = Math.max(14, Math.round(width * 0.026));
  const maxCharsPerLine = Math.max(16, Math.floor((width * 0.86) / (fontSize * 0.52)));
  const marginTop = Math.round(headerRowBottom(width) + width * 0.02);
  const fontFile = escapeFilterPath(resolveFontFile());

  const filters: string[] = [];
  for (const [i, timing] of timings.entries()) {
    const raw = (timing.scene.narration || timing.scene.onScreenText.join(" ")).trim();
    if (!raw) continue;
    const lines = wrapText(raw, maxCharsPerLine, 2);
    const textFilePath = path.join(workDir, `caption-${i}.txt`);
    await fs.writeFile(textFilePath, lines.join("\n"), "utf8");

    const start = timing.startSeconds.toFixed(2);
    const end = (timing.startSeconds + timing.durationSeconds).toFixed(2);
    const escapedTextFile = escapeFilterPath(textFilePath);

    // Anchored to the bottom of the frame (the conventional caption position)
    // rather than a fixed offset, so it clears our own scene title band —
    // whose height varies with how many lines the title itself wraps to.
    const boxHeight = lines.length * fontSize * 1.3;
    const y = Math.max(marginTop, Math.round(height - height * 0.06 - boxHeight));

    filters.push(
      [
        "drawtext=",
        `fontfile='${fontFile}':`,
        `textfile='${escapedTextFile}':`,
        `fontsize=${fontSize}:`,
        "fontcolor=white:",
        "line_spacing=6:",
        "box=1:boxcolor=black@0.55:boxborderw=14:",
        "x=(w-text_w)/2:",
        `y=${y}:`,
        `enable='between(t\\,${start}\\,${end})'`,
      ].join(""),
    );
  }

  if (filters.length === 0) {
    await fs.copyFile(inputPath, outPath);
    return;
  }

  await runFfmpeg(["-y", "-i", inputPath, "-vf", filters.join(","), "-c:v", "libx264", "-c:a", "copy", outPath]);
}

export class FfmpegVideoProvider implements VideoProvider {
  readonly key = "ffmpeg_local";
  readonly label = "FSW Branded Renderer (local)";
  readonly supportedModes = [...VIDEO_MODES];

  isAvailable(): boolean {
    return isFfmpegAvailable();
  }

  async render(request: VideoRenderRequest): Promise<VideoRenderResult> {
    if (!this.isAvailable()) {
      throw new Error(
        "ffmpeg is not available on this host. Set FFMPEG_PATH to a working ffmpeg binary, or install ffmpeg.",
      );
    }
    if (request.scenes.length === 0) {
      throw new Error("The video plan has no scenes to render.");
    }

    const dims = ASPECT_RATIO_DIMENSIONS[request.aspectRatio as AspectRatio] ?? ASPECT_RATIO_DIMENSIONS["16:9"];
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `fsw-video-${request.jobId}-`));

    try {
      const clipPaths: string[] = [];
      const timings: SceneTiming[] = [];
      let cursor = 0;

      for (const [i, scene] of request.scenes.entries()) {
        const narrationEntry = request.narrationAudio?.find((n) => n.sceneIndex === scene.index);
        const minDuration = 2;
        const maxDuration = 90;
        const rawDuration = narrationEntry?.durationSeconds ?? scene.estimatedSeconds;
        const durationSeconds = Math.min(maxDuration, Math.max(minDuration, rawDuration));

        const svgPath = path.join(workDir, `scene-${i}.svg`);
        const svg = buildSceneSvg({
          scene,
          sceneNumber: i + 1,
          totalScenes: request.scenes.length,
          width: dims.width,
          height: dims.height,
          mode: request.mode,
          brand: request.brand,
        });
        await fs.writeFile(svgPath, svg, "utf8");

        const clipPath = path.join(workDir, `scene-${i}.mp4`);
        await renderSceneClip({
          svgPath,
          outPath: clipPath,
          durationSeconds,
          width: dims.width,
          height: dims.height,
          narrationAudioPath: narrationEntry?.path,
        });

        clipPaths.push(clipPath);
        timings.push({ scene, startSeconds: cursor, durationSeconds });
        cursor += durationSeconds;
      }

      const concatListPath = path.join(workDir, "concat.txt");
      const concatOutPath = path.join(workDir, "concat.mp4");
      await concatClips(clipPaths, concatListPath, concatOutPath);

      // Scene assets are no longer needed once concatenated — free disk early.
      await Promise.all(clipPaths.map((p) => fs.rm(p, { force: true })));
      await Promise.all(request.scenes.map((_, i) => fs.rm(path.join(workDir, `scene-${i}.svg`), { force: true })));

      const captionsVtt = buildCaptionsVtt(timings);
      const vttPath = path.join(workDir, "captions.vtt");
      await fs.writeFile(vttPath, captionsVtt, "utf8");

      let finalPath = concatOutPath;
      if (process.env.FFMPEG_BURN_CAPTIONS === "1" && captionsVtt.trim().length > 0) {
        const burnedPath = path.join(workDir, "final.mp4");
        try {
          await burnInCaptions(concatOutPath, timings, workDir, burnedPath, dims.width, dims.height);
          finalPath = burnedPath;
        } catch (error) {
          // Caption burn-in is a nice-to-have; never fail the whole render over it.
          console.error("[ffmpeg] caption burn-in failed, shipping without burned captions", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const durationSeconds = (await probeDurationSeconds(finalPath)) || cursor;

      // Move the final file out of the temp dir the caller is about to clean
      // up, so it survives past cleanupRenderWorkspace().
      const stablePath = path.join(os.tmpdir(), `fsw-video-output-${request.jobId}.mp4`);
      await fs.copyFile(finalPath, stablePath);
      await fs.rm(workDir, { recursive: true, force: true });

      return {
        outputPath: stablePath,
        durationSeconds,
        provider: this.key,
        captionsVtt,
      };
    } catch (error) {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }
}

export const ffmpegVideoProvider = new FfmpegVideoProvider();
