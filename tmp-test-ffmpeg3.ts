import { createRequire } from "module";
const require = createRequire(import.meta.url);
const p = require.resolve("server-only");
require.cache[p] = { id: p, filename: p, loaded: true, exports: {} } as unknown as NodeModule;

async function main() {
  const { ffmpegVideoProvider, probeDurationSeconds } = require("/home/user/AI/src/lib/video/providers/ffmpeg");

  const narrationDuration = await probeDurationSeconds("/tmp/narration-test.mp3");
  console.log("probed narration duration:", narrationDuration);

  const request = {
    jobId: "test-job-narration",
    title: "Narration test",
    mode: "EXPLAINER",
    aspectRatio: "1:1",
    language: "en",
    scenes: [
      {
        index: 0,
        title: "With real narration audio",
        narration: "This scene has an attached narration track that should drive its duration.",
        onScreenText: ["Duration matches audio"],
        estimatedSeconds: 999, // should be ignored in favor of the narration track's real duration
      },
      {
        index: 1,
        title: "Without narration audio",
        narration: "This scene has no narration track, so it falls back to the estimated reading time.",
        onScreenText: ["Falls back to estimate"],
        estimatedSeconds: 3,
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
    narrationAudio: [{ sceneIndex: 0, path: "/tmp/narration-test.mp3", durationSeconds: narrationDuration }],
  };

  const result = await ffmpegVideoProvider.render(request);
  console.log("Render result:", result);

  const { execFileSync } = require("node:child_process");
  console.log(
    execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration:stream=width,height,codec_name",
      "-of", "default=noprint_wrappers=1", result.outputPath,
    ]).toString(),
  );

  const expectedTotal = narrationDuration + 3;
  console.log("Expected total ~", expectedTotal, "vs actual", result.durationSeconds);
  if (Math.abs(result.durationSeconds - expectedTotal) > 0.5) {
    throw new Error("Duration mismatch — narration-driven timing did not apply correctly.");
  }

  require("node:fs").unlinkSync(result.outputPath);
  console.log("PASS");
}

main().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
