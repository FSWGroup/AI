import { createRequire } from "module";
const require = createRequire(import.meta.url);
const p = require.resolve("server-only");
require.cache[p] = { id: p, filename: p, loaded: true, exports: {} } as unknown as NodeModule;

async function main() {
  const { ffmpegVideoProvider } = require("/home/user/AI/src/lib/video/providers/ffmpeg");
  process.env.FFMPEG_BURN_CAPTIONS = "1";
  const request = {
    jobId: "test-job-burn",
    title: "Portrait test",
    mode: "QUICK_CLIP",
    aspectRatio: "9:16",
    language: "en",
    scenes: [
      {
        index: 0,
        title: "Report incidents within 24 hours",
        narration: "Report any workplace incident to your supervisor within twenty four hours, no exceptions.",
        onScreenText: ["Report within 24 hours", "No exceptions"],
        estimatedSeconds: 4,
      },
    ],
    knowledgeChecks: [],
    description: "x",
    captionsPreview: "x",
    brand: {
      appName: "FSW Academy",
      companyName: "FSW Group",
      primaryColor: "#17365c",
      secondaryColor: "#0b1d33",
      accentColor: "#f98d07",
    },
  };
  const result = await ffmpegVideoProvider.render(request);
  console.log(result);
  const { execFileSync } = require("node:child_process");
  console.log(
    execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "stream=width,height,codec_name", "-of", "default=noprint_wrappers=1",
      result.outputPath,
    ]).toString(),
  );
  execFileSync("ffmpeg", ["-y", "-ss", "2", "-i", result.outputPath, "-frames:v", "1", "/tmp/frame-portrait.png"]);
  console.log("frame saved");
}
main().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
