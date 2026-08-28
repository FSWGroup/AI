import type { LessonType } from "@prisma/client";

/** Human-readable labels for LessonType, shared by every player-adjacent surface. */
export const LESSON_TYPE_LABEL: Record<string, string> = {
  RICH_TEXT: "Reading",
  SOP_REF: "SOP",
  VIDEO: "Video",
  AI_VIDEO: "AI Video",
  SCREEN_RECORDING: "Screen recording",
  AUDIO: "Audio",
  DOCUMENT: "Document",
  PRESENTATION: "Presentation",
  IMAGE: "Image",
  CHECKLIST: "Checklist",
  QUIZ: "Quiz",
  FLASHCARDS: "Flashcards",
  SCENARIO: "Scenario",
  SURVEY: "Survey",
  ACKNOWLEDGEMENT: "Acknowledgement",
  SIGNATURE: "Signature",
  MANAGER_SIGNOFF: "Manager sign-off",
  PRACTICAL_DEMO: "Practical demo",
  ASSIGNMENT_PROJECT: "Project submission",
  EXTERNAL_LINK: "External link",
  LIVE_SESSION: "Live session",
  DISCUSSION: "Discussion",
  DOWNLOAD: "Download",
  EMBED: "Embed",
  FLOWCHART: "Flowchart",
};

export const LESSON_TYPES: LessonType[] = Object.keys(LESSON_TYPE_LABEL) as LessonType[];
