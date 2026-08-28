import { createRequire } from "module";
const require = createRequire(import.meta.url);
const p = require.resolve("server-only");
require.cache[p] = { id: p, filename: p, loaded: true, exports: {} } as unknown as NodeModule;

async function main() {
  const { ffmpegVideoProvider, isFfmpegAvailable } = require("/home/user/AI/src/lib/video/providers/ffmpeg");

  console.log("isFfmpegAvailable():", isFfmpegAvailable());

  const request = {
    jobId: "test-job-123",
    title: "Test Safety Briefing",
    mode: "SAFETY_BRIEFING",
    aspectRatio: "16:9",
    language: "en",
    scenes: [
      {
        index: 0,
        title: "Lockout before you touch the conveyor",
        narration:
          "Before performing any maintenance on the conveyor belt, you must fully lock out and tag out the main power disconnect. Never rely on the stop button alone.",
        onScreenText: ["Lock out the main disconnect", "Tag with your name and date", "Verify zero energy"],
        visualStyle: "warning",
        estimatedSeconds: 3,
      },
      {
        index: 1,
        title: "If the belt starts moving unexpectedly",
        narration:
          "If the belt moves unexpectedly while you are working, step back immediately and hit the emergency stop. Report the incident to your supervisor before resuming work.",
        onScreenText: ["Step back", "Hit emergency stop", "Report to your supervisor"],
        visualStyle: "warning",
        estimatedSeconds: 3,
      },
    ],
    knowledgeChecks: [],
    description: "test",
    captionsPreview: "test",
    brand: {
      appName: "FSW Academy",
      companyName: "FSW Group",
      primaryColor: "#17365c",
      secondaryColor: "#0b1d33",
      accentColor: "#f98d07",
    },
  };

  console.log("Available:", ffmpegVideoProvider.isAvailable());
  console.log("Rendering...");
  const start = Date.now();
  const result = await ffmpegVideoProvider.render(request);
  console.log("Render result:", { ...result, captionsVtt: result.captionsVtt?.slice(0, 300) });
  console.log("Took", Date.now() - start, "ms");

  const fs = require("node:fs");
  const stat = fs.statSync(result.outputPath);
  console.log("Output file size:", stat.size, "bytes");

  const { execFileSync } = require("node:child_process");
  const probe = execFileSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate,pix_fmt",
    "-of", "default=noprint_wrappers=1",
    result.outputPath,
  ]).toString();
  console.log("ffprobe output:\n", probe);

  console.log("\nVTT:\n", result.captionsVtt);

  fs.unlinkSync(result.outputPath);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
