import "server-only";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/auth/guard";
import { parseJsonResponse } from "@/lib/ai/index";
import { runGeneration, sanitizeSourceText } from "@/lib/ai/generate";
import { videoPlanSystemPrompt } from "@/lib/ai/prompts";
import { lessonContentToText } from "@/lib/ai/indexer";
import { blocksSchema, blocksToPlainText } from "@/lib/content/types";
import type { VideoScene } from "@/lib/ai/types";
import type { VideoKnowledgeCheck, VideoPlan, VideoSourceType } from "@/lib/video/types";

/**
 * Video plan generation: turns a prompt / SOP / course / document / transcript
 * into the editable storyboard an author reviews before anything renders.
 */

export interface GenerateVideoPlanInput {
  mode: string;
  sourceType: VideoSourceType | string;
  prompt?: string | null;
  sourceText?: string | null;
  sourceSopId?: string | null;
  sourceCourseId?: string | null;
  aspectRatio?: string;
  targetSeconds?: number | null;
}

interface SnapshotLesson {
  title: string;
  type: string;
  content: unknown;
}
interface SnapshotSection {
  title: string;
  lessons: SnapshotLesson[];
}
interface CourseSnapshot {
  title?: string;
  description?: string;
  sections?: SnapshotSection[];
}

async function resolveSourceMaterial(input: GenerateVideoPlanInput): Promise<string> {
  const parts: string[] = [];

  if (input.sourceType === "SOP" && input.sourceSopId) {
    const sop = await prisma.sop.findUnique({
      where: { id: input.sourceSopId },
      select: { title: true, summary: true, currentVersion: { select: { blocks: true } } },
    });
    if (sop?.currentVersion) {
      const parsed = blocksSchema.safeParse(sop.currentVersion.blocks);
      parts.push(`SOP: ${sop.title}`);
      if (sop.summary) parts.push(sop.summary);
      if (parsed.success) parts.push(blocksToPlainText(parsed.data));
    }
  } else if (input.sourceType === "COURSE" && input.sourceCourseId) {
    const course = await prisma.course.findUnique({
      where: { id: input.sourceCourseId },
      select: { title: true, description: true, currentVersion: { select: { snapshot: true } } },
    });
    if (course?.currentVersion) {
      const snapshot = course.currentVersion.snapshot as unknown as CourseSnapshot;
      parts.push(`Course: ${course.title}`);
      if (course.description) parts.push(course.description);
      for (const section of snapshot.sections ?? []) {
        for (const lesson of section.lessons ?? []) {
          const text = lessonContentToText(lesson.type, lesson.content);
          if (text.trim()) parts.push(`${lesson.title}: ${text}`);
        }
      }
    }
  } else if ((input.sourceType === "DOCUMENT" || input.sourceType === "TRANSCRIPT") && input.sourceText) {
    parts.push(input.sourceText);
  }

  if (input.prompt) parts.push(`Additional direction from the author: ${input.prompt}`);
  if (parts.length === 0 && input.sourceText) parts.push(input.sourceText);

  return parts.join("\n\n");
}

const VIDEO_PLAN_JSON_SHAPE = `{
  "objectives": string[],
  "recommendedSeconds": number,
  "script": string,
  "captionsPreview": string,
  "description": string,
  "scenes": [{"index": number, "title": string, "narration": string, "onScreenText": string[], "visualStyle": string, "estimatedSeconds": number}],
  "knowledgeChecks": [{"question": string, "options": string[], "correctIndex": number}]
}`;

function normalizeScenes(raw: unknown): VideoScene[] {
  if (!Array.isArray(raw)) return [];
  const scenes: VideoScene[] = [];
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const narration = typeof r.narration === "string" ? r.narration.trim() : "";
    if (!narration) continue;
    const words = narration.split(/\s+/).filter(Boolean).length;
    const estimatedFromReading = Math.max(3, Math.round((words / 150) * 60));
    const onScreenText = Array.isArray(r.onScreenText)
      ? r.onScreenText.filter((t): t is string => typeof t === "string").slice(0, 6)
      : [];
    const scene: VideoScene = {
      index: scenes.length,
      title: typeof r.title === "string" && r.title.trim() ? r.title.trim() : `Scene ${index + 1}`,
      narration,
      onScreenText,
      estimatedSeconds:
        typeof r.estimatedSeconds === "number" && r.estimatedSeconds > 0
          ? Math.round(r.estimatedSeconds)
          : estimatedFromReading,
    };
    if (typeof r.visualStyle === "string") scene.visualStyle = r.visualStyle;
    scenes.push(scene);
  }
  return scenes;
}

function normalizeKnowledgeChecks(raw: unknown): VideoKnowledgeCheck[] {
  if (!Array.isArray(raw)) return [];
  const out: VideoKnowledgeCheck[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const options = Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === "string") : [];
    const correctIndex = typeof r.correctIndex === "number" ? r.correctIndex : -1;
    if (typeof r.question !== "string" || options.length < 2 || correctIndex < 0 || correctIndex >= options.length) {
      continue;
    }
    out.push({ question: r.question, options, correctIndex });
  }
  return out;
}

export async function generateVideoPlan(actor: Actor, input: GenerateVideoPlanInput): Promise<VideoPlan> {
  const sourceMaterial = sanitizeSourceText(await resolveSourceMaterial(input), 18000);
  const aspectRatio = input.aspectRatio ?? "16:9";

  return runGeneration(
    actor,
    "VIDEO_PLAN",
    { mode: input.mode, sourceType: input.sourceType, aspectRatio },
    async (provider) => {
      const system = videoPlanSystemPrompt({
        mode: input.mode,
        aspectRatio,
        targetSeconds: input.targetSeconds ?? null,
      });

      const result = await provider.generate({
        system,
        messages: [{ role: "user", content: sourceMaterial || "No source material was provided — use the author's mode and title as the brief." }],
        maxTokens: 4000,
        temperature: 0.5,
        jsonSchemaHint: VIDEO_PLAN_JSON_SHAPE,
      });

      const parsed = parseJsonResponse<Record<string, unknown>>(result.text);
      if (!parsed) throw new Error("The AI response could not be parsed as a video plan.");

      const scenes = normalizeScenes(parsed.scenes);
      const recommendedSeconds =
        typeof parsed.recommendedSeconds === "number" && parsed.recommendedSeconds > 0
          ? Math.round(parsed.recommendedSeconds)
          : scenes.reduce((sum, s) => sum + s.estimatedSeconds, 0) || 30;

      const plan: VideoPlan = {
        objectives: Array.isArray(parsed.objectives)
          ? parsed.objectives.filter((o): o is string => typeof o === "string")
          : [],
        recommendedSeconds,
        script:
          typeof parsed.script === "string" && parsed.script.trim()
            ? parsed.script
            : scenes.map((s) => s.narration).join("\n\n"),
        scenes,
        knowledgeChecks: normalizeKnowledgeChecks(parsed.knowledgeChecks),
        description: typeof parsed.description === "string" ? parsed.description : "",
        captionsPreview:
          typeof parsed.captionsPreview === "string" && parsed.captionsPreview.trim()
            ? parsed.captionsPreview.slice(0, 240)
            : scenes.map((s) => s.narration).join(" ").slice(0, 240),
      };

      return plan;
    },
  );
}
