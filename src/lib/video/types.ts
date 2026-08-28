import type { VideoProvider, VideoRenderRequest, VideoRenderResult, VideoScene } from "@/lib/ai/types";

/**
 * Video-pipeline types. Extends the provider-facing shapes from
 * src/lib/ai/types.ts with the plan structure the AI Video Studio UI edits
 * before anything renders.
 */

export type { VideoProvider, VideoRenderRequest, VideoRenderResult, VideoScene };

/** The six video modes FSW Academy supports, each with tailored scene direction. */
export const VIDEO_MODES = [
  "EXPLAINER",
  "SCREEN_WALKTHROUGH",
  "SLIDES",
  "AVATAR",
  "QUICK_CLIP",
  "SAFETY_BRIEFING",
] as const;

export type VideoMode = (typeof VIDEO_MODES)[number];

export const VIDEO_MODE_LABELS: Record<VideoMode, string> = {
  EXPLAINER: "Explainer",
  SCREEN_WALKTHROUGH: "Screen walkthrough",
  SLIDES: "Slide deck",
  AVATAR: "AI avatar presenter",
  QUICK_CLIP: "Quick clip",
  SAFETY_BRIEFING: "Safety briefing",
};

export const VIDEO_MODE_DESCRIPTIONS: Record<VideoMode, string> = {
  EXPLAINER: "A friendly walkthrough of a concept or process, 1-3 minutes.",
  SCREEN_WALKTHROUGH: "Step-by-step guidance through a screen, system, or form.",
  SLIDES: "A slide-deck style presentation with bullet points per scene.",
  AVATAR: "A presenter-led video using an AI avatar (requires HeyGen or Synthesia).",
  QUICK_CLIP: "One idea, stated directly, under 45 seconds.",
  SAFETY_BRIEFING: "A hazard-and-precaution briefing with clear, urgent framing.",
};

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const ASPECT_RATIO_DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
};

export type VideoSourceType = "PROMPT" | "SOP" | "COURSE" | "DOCUMENT" | "TRANSCRIPT";

/** A knowledge-check question the plan proposes attaching after the video. */
export interface VideoKnowledgeCheck {
  question: string;
  options: string[];
  correctIndex: number;
}

/**
 * The full editable plan a video job produces before rendering. The author
 * can change every field here — objectives, script, per-scene narration and
 * on-screen text, knowledge checks — before queuing the actual render.
 */
export interface VideoPlan {
  objectives: string[];
  recommendedSeconds: number;
  script: string;
  scenes: VideoScene[];
  knowledgeChecks: VideoKnowledgeCheck[];
  description: string;
  captionsPreview: string;
}

/** Brand values resolved once per render from app settings, never read by providers directly. */
export interface VideoBrand {
  appName: string;
  companyName: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  logoPath?: string;
  introPath?: string;
  outroPath?: string;
}
