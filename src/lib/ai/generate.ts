import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import type { Prisma, EntityType } from "@prisma/client";
import type { Actor } from "@/lib/auth/guard";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { isCapabilityAvailable } from "@/lib/providers/registry";
import { requireTextProvider, parseJsonResponse } from "@/lib/ai/index";
import { CapabilityUnavailableError, type TextAIProvider } from "@/lib/ai/types";
import {
  blockSchema,
  blocksSchema,
  blocksToPlainText,
  extractLinks,
  sopMetaSchema,
  EMPTY_SOP_META,
  type Block,
  type SopMeta,
} from "@/lib/content/types";
import {
  SOP_DRAFT_SYSTEM_PROMPT,
  COURSE_OUTLINE_SYSTEM_PROMPT,
  COURSE_FROM_OUTLINE_SYSTEM_PROMPT,
  QUIZ_GENERATION_SYSTEM_PROMPT,
  QUALITY_CHECK_SYSTEM_PROMPT,
  QUICK_REFERENCE_SYSTEM_PROMPT,
  translationSystemPrompt,
} from "@/lib/ai/prompts";
/**
 * AI authoring.
 *
 * Every function here produces a DRAFT. None of them ever set a Sop, Course,
 * or Question row to a published/live state — that stays a deliberate human
 * action in the ordinary authoring flow. Every function is gated on the
 * "ai_text" capability, records an AiJob row for observability, and audits
 * ai.generation_requested.
 */

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

function ensureAiTextAvailable(): void {
  if (!isCapabilityAvailable("ai_text")) {
    throw new CapabilityUnavailableError(
      "AI text generation",
      "Set ANTHROPIC_API_KEY (preferred) or OPENAI_API_KEY, then reload Admin → Integrations.",
    );
  }
}

/** Truncate and strip control characters from author-supplied source text before it reaches the model. */
export function sanitizeSourceText(text: string, maxChars = 24000): string {
  const printable = Array.from(text)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || code >= 32;
    })
    .join("");
  return printable.trim().slice(0, maxChars);
}

/**
 * Wraps one generation call with capability gating, AiJob bookkeeping, and
 * the ai.generation_requested audit event — the pattern every exported
 * function in this file follows.
 */
async function runGeneration<T>(
  actor: Actor,
  kind: string,
  input: Record<string, unknown>,
  fn: (provider: TextAIProvider) => Promise<T>,
): Promise<T> {
  ensureAiTextAvailable();
  const provider = requireTextProvider();

  const job = await prisma.aiJob.create({
    data: { kind, createdById: actor.id, input: input as Prisma.InputJsonValue, status: "RUNNING" },
    select: { id: true },
  });

  try {
    const output = await fn(provider);
    await prisma.aiJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETE",
        output: (output ?? null) as Prisma.InputJsonValue,
        provider: provider.key,
        model: provider.model,
      },
    });
    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.AI_GENERATION_REQUESTED,
      metadata: { kind, jobId: job.id },
    });
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.aiJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: message.slice(0, 2000) },
    });
    throw error;
  }
}

/** Repair-or-drop block validation: keep everything the schema accepts, discard the rest. */
function repairBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];
  const out: Block[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const candidate: Record<string, unknown> = { ...(item as Record<string, unknown>) };
    if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
      candidate.id = crypto.randomUUID();
    }
    const parsed = blockSchema.safeParse(candidate);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      console.warn("[ai/generate] dropped an AI-drafted block that failed validation", {
        type: (candidate as { type?: unknown }).type,
        issues: parsed.error.issues.slice(0, 2),
      });
    }
  }
  return out;
}

function normalizeSopMeta(raw: unknown): SopMeta {
  const partial = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const parsed = sopMetaSchema.safeParse({ ...EMPTY_SOP_META, ...partial });
  return parsed.success ? parsed.data : EMPTY_SOP_META;
}

// ---------------------------------------------------------------------------
// 1. SOP draft
// ---------------------------------------------------------------------------

export type SopSourceKind = "prompt" | "notes" | "transcript" | "document";

export interface SopDraftInput {
  source: { kind: SopSourceKind; text: string };
}

export interface SopDraftOutput {
  title: string;
  summary: string;
  category: string;
  meta: SopMeta;
  blocks: Block[];
}

const SOP_JSON_SHAPE = `{
  "title": string,
  "summary": string,
  "category": string,
  "meta": {
    "purpose": string, "scope": string,
    "definitions": [{"term": string, "definition": string}],
    "prerequisites": string[], "requiredTools": string[],
    "safetyConsiderations": string,
    "troubleshooting": [{"problem": string, "resolution": string}],
    "exceptions": string
  },
  "blocks": [ /* FSW content blocks: heading, paragraph, list, table, callout, warning, checklist — each needs a unique "id" and its type-specific fields */ ]
}`;

export async function generateSopDraft(actor: Actor, input: SopDraftInput): Promise<SopDraftOutput> {
  return runGeneration(actor, "SOP_DRAFT", { source: { kind: input.source.kind } }, async (provider) => {
    const userMessage = `Source type: ${input.source.kind}\n\nSource material:\n${sanitizeSourceText(input.source.text)}`;
    const result = await provider.generate({
      system: SOP_DRAFT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      maxTokens: 4096,
      temperature: 0.4,
      jsonSchemaHint: SOP_JSON_SHAPE,
    });

    const parsed = parseJsonResponse<Record<string, unknown>>(result.text);
    if (!parsed) throw new Error("The AI response could not be parsed as a structured SOP draft.");

    return {
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : "Untitled SOP draft",
      summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
      category: typeof parsed.category === "string" ? parsed.category.trim() : "",
      meta: normalizeSopMeta(parsed.meta),
      blocks: repairBlocks(parsed.blocks),
    };
  });
}

// ---------------------------------------------------------------------------
// 2. Course outline
// ---------------------------------------------------------------------------

export interface CourseOutlineInput {
  prompt?: string;
  sopId?: string;
  documentText?: string;
}

export interface CourseOutlineLesson {
  title: string;
  type: string;
  estimatedMinutes: number;
  summary: string;
}

export interface CourseOutlineSection {
  title: string;
  lessons: CourseOutlineLesson[];
}

export interface CourseOutline {
  title: string;
  description: string;
  category: string;
  difficulty: "INTRO" | "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  estimatedMinutes: number;
  learningObjectives: string[];
  sections: CourseOutlineSection[];
}

const COURSE_OUTLINE_JSON_SHAPE = `{
  "title": string, "description": string, "category": string,
  "difficulty": "INTRO"|"BEGINNER"|"INTERMEDIATE"|"ADVANCED",
  "estimatedMinutes": number,
  "learningObjectives": string[],
  "sections": [{"title": string, "lessons": [{"title": string, "type": string, "estimatedMinutes": number, "summary": string}]}]
}`;

const DIFFICULTIES = new Set(["INTRO", "BEGINNER", "INTERMEDIATE", "ADVANCED"]);

async function resolveOutlineSourceText(input: CourseOutlineInput): Promise<string> {
  if (input.sopId) {
    const sop = await prisma.sop.findUnique({
      where: { id: input.sopId },
      select: { title: true, summary: true, currentVersion: { select: { blocks: true } } },
    });
    if (sop?.currentVersion) {
      const parsed = blocksSchema.safeParse(sop.currentVersion.blocks);
      const body = parsed.success ? blocksToPlainText(parsed.data) : "";
      return `SOP: ${sop.title}\n${sop.summary ?? ""}\n\n${body}`;
    }
  }
  if (input.documentText) return input.documentText;
  return input.prompt ?? "";
}

export async function generateCourseOutline(actor: Actor, input: CourseOutlineInput): Promise<CourseOutline> {
  const sourceText = sanitizeSourceText(await resolveOutlineSourceText(input));

  return runGeneration(actor, "COURSE_OUTLINE", { sopId: input.sopId, hasPrompt: Boolean(input.prompt) }, async (provider) => {
    const result = await provider.generate({
      system: COURSE_OUTLINE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Build a course outline from this material:\n\n${sourceText}` }],
      maxTokens: 2500,
      temperature: 0.5,
      jsonSchemaHint: COURSE_OUTLINE_JSON_SHAPE,
    });

    const parsed = parseJsonResponse<Record<string, unknown>>(result.text);
    if (!parsed) throw new Error("The AI response could not be parsed as a course outline.");

    const difficulty = typeof parsed.difficulty === "string" && DIFFICULTIES.has(parsed.difficulty)
      ? (parsed.difficulty as CourseOutline["difficulty"])
      : "BEGINNER";

    const sections: CourseOutlineSection[] = Array.isArray(parsed.sections)
      ? (parsed.sections as unknown[]).map((s) => {
          const section = (s ?? {}) as Record<string, unknown>;
          const lessons: CourseOutlineLesson[] = Array.isArray(section.lessons)
            ? (section.lessons as unknown[]).map((l) => {
                const lesson = (l ?? {}) as Record<string, unknown>;
                return {
                  title: typeof lesson.title === "string" ? lesson.title : "Untitled lesson",
                  type: typeof lesson.type === "string" ? lesson.type : "RICH_TEXT",
                  estimatedMinutes: typeof lesson.estimatedMinutes === "number" ? lesson.estimatedMinutes : 5,
                  summary: typeof lesson.summary === "string" ? lesson.summary : "",
                };
              })
            : [];
          return { title: typeof section.title === "string" ? section.title : "Untitled section", lessons };
        })
      : [];

    const estimatedMinutes =
      typeof parsed.estimatedMinutes === "number" && parsed.estimatedMinutes > 0
        ? Math.round(parsed.estimatedMinutes)
        : sections.reduce((sum, s) => sum + s.lessons.reduce((a, l) => a + l.estimatedMinutes, 0), 0) || 15;

    return {
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : "Untitled course",
      description: typeof parsed.description === "string" ? parsed.description : "",
      category: typeof parsed.category === "string" ? parsed.category : "",
      difficulty,
      estimatedMinutes,
      learningObjectives: Array.isArray(parsed.learningObjectives)
        ? (parsed.learningObjectives as unknown[]).filter((o): o is string => typeof o === "string")
        : [],
      sections,
    };
  });
}

// ---------------------------------------------------------------------------
// 3. Full course generation from an approved outline
// ---------------------------------------------------------------------------

export interface CourseDraftLesson extends CourseOutlineLesson {
  content: Record<string, unknown>;
}

export interface CourseDraftSection {
  title: string;
  lessons: CourseDraftLesson[];
}

export interface CourseDraft {
  title: string;
  description: string;
  category: string;
  difficulty: CourseOutline["difficulty"];
  estimatedMinutes: number;
  learningObjectives: string[];
  sections: CourseDraftSection[];
  suggestedVideoConcept: string;
}

const COURSE_FULL_JSON_SHAPE = `{
  "sections": [{
    "title": string,
    "lessons": [{
      "title": string, "type": string, "estimatedMinutes": number, "summary": string,
      "content": { /* for RICH_TEXT: {"blocks":[...]}; for SCENARIO: {"scenario":string,"choices":[{"id":string,"label":string,"correct":bool,"feedback":string}]}; for QUIZ: {"questions":[{"type":string,"prompt":string,"config":object,"explanation":string,"points":number}]}; for CHECKLIST: {"requireAll":bool,"items":[{"id":string,"text":string}]}; for ACKNOWLEDGEMENT: {"statement":string}; otherwise {} */
    }]
  }],
  "suggestedVideoConcept": string
}`;

export async function generateCourseFromOutline(actor: Actor, outline: CourseOutline): Promise<CourseDraft> {
  return runGeneration(actor, "COURSE_DRAFT", { title: outline.title }, async (provider) => {
    const outlineText = JSON.stringify(outline).slice(0, 8000);
    const result = await provider.generate({
      system: COURSE_FROM_OUTLINE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Approved outline:\n${outlineText}\n\nFill in full lesson content now.` }],
      maxTokens: 8000,
      temperature: 0.5,
      jsonSchemaHint: COURSE_FULL_JSON_SHAPE,
    });

    const parsed = parseJsonResponse<Record<string, unknown>>(result.text);
    const rawSections = parsed && Array.isArray(parsed.sections) ? (parsed.sections as unknown[]) : [];

    const sections: CourseDraftSection[] = outline.sections.map((outlineSection, sIndex) => {
      const rawSection = (rawSections[sIndex] ?? {}) as Record<string, unknown>;
      const rawLessons = Array.isArray(rawSection.lessons) ? (rawSection.lessons as unknown[]) : [];

      const lessons: CourseDraftLesson[] = outlineSection.lessons.map((outlineLesson, lIndex) => {
        const rawLesson = (rawLessons[lIndex] ?? {}) as Record<string, unknown>;
        const rawContent = (rawLesson.content ?? {}) as Record<string, unknown>;
        return { ...outlineLesson, content: normalizeLessonContent(outlineLesson.type, rawContent) };
      });

      return { title: outlineSection.title, lessons };
    });

    return {
      title: outline.title,
      description: outline.description,
      category: outline.category,
      difficulty: outline.difficulty,
      estimatedMinutes: outline.estimatedMinutes,
      learningObjectives: outline.learningObjectives,
      sections,
      suggestedVideoConcept:
        parsed && typeof parsed.suggestedVideoConcept === "string" ? parsed.suggestedVideoConcept : "",
    };
  });
}

/** Repair-or-drop lesson content by declared lesson type, matching the seed's content shapes. */
function normalizeLessonContent(type: string, raw: Record<string, unknown>): Record<string, unknown> {
  switch (type) {
    case "RICH_TEXT":
      return { blocks: repairBlocks(raw.blocks) };
    case "SCENARIO": {
      const choices = Array.isArray(raw.choices)
        ? (raw.choices as unknown[])
            .map((c) => c as Record<string, unknown>)
            .filter((c) => typeof c.label === "string")
            .map((c) => ({
              id: typeof c.id === "string" ? c.id : crypto.randomUUID(),
              label: c.label as string,
              correct: c.correct === true,
              feedback: typeof c.feedback === "string" ? c.feedback : "",
            }))
        : [];
      return { scenario: typeof raw.scenario === "string" ? raw.scenario : "", choices };
    }
    case "QUIZ": {
      const questions = Array.isArray(raw.questions)
        ? (raw.questions as unknown[]).map((q) => normalizeQuizQuestion(q)).filter((q): q is QuizQuestionDraft => q !== null)
        : [];
      return { questions };
    }
    case "CHECKLIST": {
      const items = Array.isArray(raw.items)
        ? (raw.items as unknown[])
            .map((i) => i as Record<string, unknown>)
            .filter((i) => typeof i.text === "string")
            .map((i) => ({ id: typeof i.id === "string" ? i.id : crypto.randomUUID(), text: i.text as string }))
        : [];
      return { requireAll: raw.requireAll !== false, items };
    }
    case "ACKNOWLEDGEMENT":
      return { statement: typeof raw.statement === "string" ? raw.statement : "" };
    default:
      return raw;
  }
}

// ---------------------------------------------------------------------------
// 4. Quiz question generation
// ---------------------------------------------------------------------------

export type QuizQuestionType =
  | "MULTIPLE_CHOICE"
  | "MULTIPLE_SELECT"
  | "TRUE_FALSE"
  | "FILL_BLANK"
  | "SHORT_ANSWER"
  | "MATCHING"
  | "ORDERING";

export interface QuizQuestionDraft {
  type: QuizQuestionType;
  prompt: string;
  config: Record<string, unknown>;
  explanation: string;
  points: number;
  aiGenerated: true;
  isDraft: true;
}

export interface GenerateQuizInput {
  sourceText: string;
  count: number;
  difficulty: "easy" | "medium" | "hard";
  types: QuizQuestionType[];
  topics?: string[];
}

const QUIZ_QUESTION_TYPES: ReadonlySet<QuizQuestionType> = new Set([
  "MULTIPLE_CHOICE",
  "MULTIPLE_SELECT",
  "TRUE_FALSE",
  "FILL_BLANK",
  "SHORT_ANSWER",
  "MATCHING",
  "ORDERING",
]);

function normalizeQuizQuestion(raw: unknown): QuizQuestionDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = typeof r.type === "string" ? r.type.toUpperCase() : "";
  if (!QUIZ_QUESTION_TYPES.has(type as QuizQuestionType)) return null;
  if (typeof r.prompt !== "string" || r.prompt.trim().length === 0) return null;

  const rawConfig = (r.config ?? {}) as Record<string, unknown>;
  const config = normalizeQuizConfig(type as QuizQuestionType, rawConfig);
  if (!config) return null;

  return {
    type: type as QuizQuestionType,
    prompt: r.prompt.trim(),
    config,
    explanation: typeof r.explanation === "string" ? r.explanation : "",
    points: typeof r.points === "number" && r.points > 0 ? Math.round(r.points) : 1,
    aiGenerated: true,
    isDraft: true,
  };
}

/** Validate and coerce a question config to the exact shape the seed and player expect, per type. */
function normalizeQuizConfig(type: QuizQuestionType, raw: Record<string, unknown>): Record<string, unknown> | null {
  switch (type) {
    case "MULTIPLE_CHOICE": {
      const options = Array.isArray(raw.options) ? raw.options.filter((o): o is string => typeof o === "string") : [];
      const correctIndex = typeof raw.correctIndex === "number" ? raw.correctIndex : -1;
      if (options.length < 2 || correctIndex < 0 || correctIndex >= options.length) return null;
      return { options, correctIndex };
    }
    case "MULTIPLE_SELECT": {
      const options = Array.isArray(raw.options) ? raw.options.filter((o): o is string => typeof o === "string") : [];
      const correctIndexes = Array.isArray(raw.correctIndexes)
        ? raw.correctIndexes.filter((n): n is number => typeof n === "number" && n >= 0 && n < options.length)
        : [];
      if (options.length < 2 || correctIndexes.length === 0) return null;
      return { options, correctIndexes };
    }
    case "TRUE_FALSE": {
      if (typeof raw.correct !== "boolean") return null;
      return { correct: raw.correct };
    }
    case "FILL_BLANK": {
      const acceptableAnswers = Array.isArray(raw.acceptableAnswers)
        ? raw.acceptableAnswers.filter((a): a is string => typeof a === "string" && a.trim().length > 0)
        : [];
      if (acceptableAnswers.length === 0) return null;
      return { acceptableAnswers };
    }
    case "SHORT_ANSWER": {
      const acceptableKeywords = Array.isArray(raw.acceptableKeywords)
        ? raw.acceptableKeywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0)
        : [];
      if (acceptableKeywords.length === 0) return null;
      return { acceptableKeywords };
    }
    case "MATCHING": {
      const pairs = Array.isArray(raw.pairs)
        ? (raw.pairs as unknown[])
            .map((p) => p as Record<string, unknown>)
            .filter((p) => typeof p.left === "string" && typeof p.right === "string")
            .map((p) => ({ left: p.left as string, right: p.right as string }))
        : [];
      if (pairs.length < 2) return null;
      return { pairs };
    }
    case "ORDERING": {
      const items = Array.isArray(raw.items) ? raw.items.filter((i): i is string => typeof i === "string") : [];
      if (items.length < 2) return null;
      return { items };
    }
    default:
      return null;
  }
}

const QUIZ_JSON_SHAPE = `{"questions":[{"type":"MULTIPLE_CHOICE"|"MULTIPLE_SELECT"|"TRUE_FALSE"|"FILL_BLANK"|"SHORT_ANSWER"|"MATCHING"|"ORDERING","prompt":string,"config":object,"explanation":string,"points":number}]}`;

export async function generateQuizQuestions(actor: Actor, input: GenerateQuizInput): Promise<QuizQuestionDraft[]> {
  const count = Math.min(Math.max(input.count, 1), 20);

  return runGeneration(
    actor,
    "QUIZ_SUGGEST",
    { count, difficulty: input.difficulty, types: input.types, topics: input.topics },
    async (provider) => {
      const userMessage = [
        `Write ${count} ${input.difficulty} quiz question(s).`,
        `Allowed question types: ${input.types.join(", ")}.`,
        input.topics && input.topics.length > 0 ? `Focus on: ${input.topics.join(", ")}.` : null,
        "",
        "Source text:",
        sanitizeSourceText(input.sourceText),
      ]
        .filter((line): line is string => line !== null)
        .join("\n");

      const result = await provider.generate({
        system: QUIZ_GENERATION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
        maxTokens: 3500,
        temperature: 0.5,
        jsonSchemaHint: QUIZ_JSON_SHAPE,
      });

      const parsed = parseJsonResponse<{ questions?: unknown[] }>(result.text);
      const raw = Array.isArray(parsed?.questions) ? parsed.questions : [];
      const drafts = raw.map(normalizeQuizQuestion).filter((q): q is QuizQuestionDraft => q !== null);
      return drafts.slice(0, count);
    },
  );
}

// ---------------------------------------------------------------------------
// Duplicate detection ("Similar content already exists")
// ---------------------------------------------------------------------------

export interface SimilarContentMatch {
  entityType: "SOP" | "COURSE";
  entityId: string;
  title: string;
  href: string;
  score: number;
}

/**
 * Title + body trigram similarity against existing published/authorable
 * content. Used both by the AI Studio "similar content already exists"
 * warning and by runQualityCheck's duplicate-content finding. Not gated on
 * ai_text — this is a plain database search, not a model call.
 */
export async function findSimilarContent(title: string, body: string): Promise<SimilarContentMatch[]> {
  const term = title.trim();
  if (term.length < 3) return [];
  const bodySnippet = body.trim().slice(0, 400);

  const [sopRows, courseRows] = await Promise.all([
    prisma.$queryRaw<{ id: string; title: string; score: number }[]>`
      SELECT id, title,
             GREATEST(similarity(title, ${term}), similarity(COALESCE(summary, ''), ${bodySnippet})) AS score
      FROM "Sop"
      WHERE "isDeleted" = false
        AND (similarity(title, ${term}) > 0.3 OR similarity(COALESCE(summary, ''), ${bodySnippet}) > 0.3)
      ORDER BY score DESC
      LIMIT 5
    `,
    prisma.$queryRaw<{ id: string; title: string; score: number }[]>`
      SELECT id, title,
             GREATEST(similarity(title, ${term}), similarity(COALESCE(description, ''), ${bodySnippet})) AS score
      FROM "Course"
      WHERE "isDeleted" = false
        AND (similarity(title, ${term}) > 0.3 OR similarity(COALESCE(description, ''), ${bodySnippet}) > 0.3)
      ORDER BY score DESC
      LIMIT 5
    `,
  ]);

  const matches: SimilarContentMatch[] = [
    ...sopRows.map((r) => ({ entityType: "SOP" as const, entityId: r.id, title: r.title, href: `/sops/${r.id}`, score: Number(r.score) })),
    ...courseRows.map((r) => ({ entityType: "COURSE" as const, entityId: r.id, title: r.title, href: `/courses/${r.id}`, score: Number(r.score) })),
  ];

  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}

// ---------------------------------------------------------------------------
// 5. Translation
// ---------------------------------------------------------------------------

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fil: "Filipino (Tagalog)",
  tl: "Filipino (Tagalog)",
  vi: "Vietnamese",
  zh: "Mandarin Chinese",
  fr: "French",
  pt: "Portuguese",
};

export interface TranslateContentInput {
  entityType: "SOP" | "COURSE";
  entityId: string;
  targetLanguage: string;
}

/** Heuristic structural check: does the translated JSON keep the same shape as the source? */
function roughlyMatchesShape(candidate: unknown, original: unknown): boolean {
  if (Array.isArray(original)) {
    return Array.isArray(candidate) && candidate.length === original.length;
  }
  if (original && typeof original === "object") {
    if (!candidate || typeof candidate !== "object") return false;
    return Object.keys(original as object).every((key) => key in (candidate as object));
  }
  return typeof candidate === typeof original;
}

export async function translateContent(actor: Actor, input: TranslateContentInput) {
  const targetLabel = LANGUAGE_LABELS[input.targetLanguage] ?? input.targetLanguage;

  let sourceTitle: string;
  let sourceVersion: string | null;
  let contentPayload: Record<string, unknown>;

  if (input.entityType === "SOP") {
    const sop = await prisma.sop.findUnique({
      where: { id: input.entityId },
      select: { currentVersion: { select: { versionNumber: true, title: true, blocks: true, meta: true } } },
    });
    if (!sop?.currentVersion) throw new Error("This SOP has no published version to translate yet.");
    sourceTitle = sop.currentVersion.title;
    sourceVersion = sop.currentVersion.versionNumber;
    contentPayload = { title: sop.currentVersion.title, meta: sop.currentVersion.meta, blocks: sop.currentVersion.blocks } as Record<string, unknown>;
  } else {
    const course = await prisma.course.findUnique({
      where: { id: input.entityId },
      select: { currentVersion: { select: { versionNumber: true, title: true, snapshot: true } } },
    });
    if (!course?.currentVersion) throw new Error("This course has no published version to translate yet.");
    sourceTitle = course.currentVersion.title;
    sourceVersion = course.currentVersion.versionNumber;
    contentPayload = course.currentVersion.snapshot as Record<string, unknown>;
  }

  return runGeneration(
    actor,
    "TRANSLATE",
    { entityType: input.entityType, entityId: input.entityId, targetLanguage: input.targetLanguage },
    async (provider) => {
      const userMessage = `Translate this JSON content into ${targetLabel}. Return ONLY the same JSON shape with human-readable text fields translated.\n\n${JSON.stringify(contentPayload).slice(0, 14000)}`;
      const result = await provider.generate({
        system: translationSystemPrompt(targetLabel),
        messages: [{ role: "user", content: userMessage }],
        maxTokens: 8000,
        temperature: 0.2,
      });

      const parsed = parseJsonResponse<Record<string, unknown>>(result.text);
      const translated = parsed && roughlyMatchesShape(parsed, contentPayload) ? parsed : contentPayload;
      const translatedTitle = typeof translated.title === "string" ? translated.title : sourceTitle;

      const translation = await prisma.contentTranslation.upsert({
        where: {
          entityType_entityId_language: {
            entityType: input.entityType as EntityType,
            entityId: input.entityId,
            language: input.targetLanguage,
          },
        },
        create: {
          entityType: input.entityType as EntityType,
          entityId: input.entityId,
          language: input.targetLanguage,
          sourceVersion,
          title: translatedTitle,
          content: translated as Prisma.InputJsonValue,
          status: "DRAFT",
          translatedById: actor.id,
          aiGenerated: true,
        },
        update: {
          sourceVersion,
          title: translatedTitle,
          content: translated as Prisma.InputJsonValue,
          status: "DRAFT",
          translatedById: actor.id,
          aiGenerated: true,
        },
      });

      return translation;
    },
  );
}

/**
 * Call this from the publish flow after a new version goes live. Existing
 * translations no longer match the published English source, so they must be
 * re-reviewed before anyone trusts them again.
 */
export async function markTranslationsOutdated(entityType: "SOP" | "COURSE", entityId: string): Promise<number> {
  const result = await prisma.contentTranslation.updateMany({
    where: { entityType: entityType as EntityType, entityId, status: { not: "OUTDATED" } },
    data: { status: "OUTDATED" },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// 6. Quality check
// ---------------------------------------------------------------------------

export interface QualityFinding {
  severity: "low" | "medium" | "high";
  category: string;
  finding: string;
  suggestion: string;
  location?: string;
}

export interface QualityCheckInput {
  entityType: "SOP" | "COURSE";
  entityId: string;
}

function countSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!cleaned) return 0;
  const matches = cleaned.match(/[aeiouy]+/g);
  let count = matches ? matches.length : 1;
  if (cleaned.endsWith("e") && count > 1) count -= 1;
  return Math.max(1, count);
}

/** Flesch-Kincaid grade level, computed directly — never asked of the model. */
export function fleschKincaidGrade(text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = Math.max(1, words.length);
  const sentenceMatches = text.match(/[^.!?]+[.!?]+/g);
  const sentenceCount = Math.max(1, sentenceMatches ? sentenceMatches.length : 1);
  const syllableCount = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const grade = 0.39 * (wordCount / sentenceCount) + 11.8 * (syllableCount / wordCount) - 15.59;
  return Math.round(grade * 10) / 10;
}

async function checkLinkReachable(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, { method: "HEAD", signal: controller.signal, redirect: "follow" });
      if (response.ok) return true;
      // Some servers reject HEAD; retry with GET before declaring it broken.
      if (response.status === 405 || response.status === 501) {
        const getResponse = await fetch(url, { method: "GET", signal: controller.signal, redirect: "follow" });
        return getResponse.ok;
      }
      return false;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}

async function loadContentForQualityCheck(
  input: QualityCheckInput,
): Promise<{ title: string; ownerId: string | null; blocks: Block[]; plainText: string }> {
  if (input.entityType === "SOP") {
    const sop = await prisma.sop.findUnique({
      where: { id: input.entityId },
      select: { title: true, ownerId: true, currentVersion: { select: { blocks: true } } },
    });
    if (!sop) throw new Error("SOP not found.");
    const parsed = sop.currentVersion ? blocksSchema.safeParse(sop.currentVersion.blocks) : null;
    const blocks = parsed?.success ? parsed.data : [];
    return { title: sop.title, ownerId: sop.ownerId, blocks, plainText: blocksToPlainText(blocks) };
  }

  const course = await prisma.course.findUnique({
    where: { id: input.entityId },
    select: { title: true, ownerId: true, currentVersion: { select: { snapshot: true } } },
  });
  if (!course) throw new Error("Course not found.");
  const snapshot = course.currentVersion?.snapshot as
    | { sections?: { title: string; lessons?: { title: string; type: string; content?: unknown }[] }[] }
    | undefined;

  const blocks: Block[] = [];
  const textParts: string[] = [];
  for (const section of snapshot?.sections ?? []) {
    for (const lesson of section.lessons ?? []) {
      if (lesson.type === "RICH_TEXT") {
        const parsed = blocksSchema.safeParse((lesson.content as { blocks?: unknown })?.blocks);
        if (parsed.success) {
          blocks.push(...parsed.data);
          textParts.push(blocksToPlainText(parsed.data));
        }
      }
    }
  }
  return { title: course.title, ownerId: course.ownerId, blocks, plainText: textParts.join("\n\n") };
}

/**
 * Read-only content quality review. Never modifies the published entity —
 * every finding is handed back for a human author to act on (or dismiss).
 */
export async function runQualityCheck(actor: Actor, input: QualityCheckInput): Promise<QualityFinding[]> {
  const { title, ownerId, blocks, plainText } = await loadContentForQualityCheck(input);

  return runGeneration(actor, "QUALITY_CHECK", { entityType: input.entityType, entityId: input.entityId }, async (provider) => {
    const findings: QualityFinding[] = [];

    // --- Code-computed findings ---
    if (plainText.trim().length > 40) {
      const grade = fleschKincaidGrade(plainText);
      if (grade > 12) {
        findings.push({
          severity: grade > 16 ? "high" : "medium",
          category: "Reading level",
          finding: `This content reads at roughly a ${grade.toFixed(1)} grade level.`,
          suggestion: "Shorten sentences and prefer plain, direct words where the topic allows.",
        });
      }
    }

    if (!ownerId) {
      findings.push({
        severity: "high",
        category: "Ownership",
        finding: "This content has no assigned owner.",
        suggestion: "Assign an owner so questions and review reminders have somewhere to go.",
      });
    }

    const links = extractLinks(blocks);
    const linkChecks = await Promise.all(links.map(async (url) => ({ url, ok: await checkLinkReachable(url) })));
    for (const { url, ok } of linkChecks) {
      if (!ok) {
        findings.push({
          severity: "medium",
          category: "Broken link",
          finding: `The link ${url} did not respond successfully.`,
          suggestion: "Confirm the link still works, or remove/replace it.",
        });
      }
    }

    const duplicates = await findSimilarContent(title, plainText);
    const strongDuplicates = duplicates.filter((d) => d.score > 0.55 && d.entityId !== input.entityId);
    if (strongDuplicates.length > 0) {
      findings.push({
        severity: "low",
        category: "Possible duplicate",
        finding: `This looks similar to existing content: "${strongDuplicates[0]!.title}".`,
        suggestion: "Confirm this isn't duplicating existing coverage, or link the two together instead.",
      });
    }

    // --- Model-judged findings ---
    if (plainText.trim().length > 40) {
      const result = await provider.generate({
        system: QUALITY_CHECK_SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Content: "${title}"\n\n${sanitizeSourceText(plainText, 16000)}` }],
        maxTokens: 2000,
        temperature: 0.2,
        jsonSchemaHint: `{"findings":[{"severity":"low"|"medium"|"high","category":string,"finding":string,"suggestion":string,"location":string}]}`,
      });
      const parsed = parseJsonResponse<{ findings?: unknown[] }>(result.text);
      for (const raw of parsed?.findings ?? []) {
        if (!raw || typeof raw !== "object") continue;
        const f = raw as Record<string, unknown>;
        const severity = f.severity === "high" || f.severity === "medium" || f.severity === "low" ? f.severity : "low";
        if (typeof f.finding !== "string" || typeof f.suggestion !== "string") continue;
        findings.push({
          severity,
          category: typeof f.category === "string" ? f.category : "Clarity",
          finding: f.finding,
          suggestion: f.suggestion,
          location: typeof f.location === "string" ? f.location : undefined,
        });
      }
    }

    return findings;
  });
}

// ---------------------------------------------------------------------------
// 7. Quick reference
// ---------------------------------------------------------------------------

export interface QuickReferenceOutput {
  title: string;
  blocks: Block[];
}

export async function generateQuickReference(actor: Actor, sopId: string): Promise<QuickReferenceOutput> {
  const sop = await prisma.sop.findUnique({
    where: { id: sopId },
    select: { title: true, currentVersion: { select: { title: true, blocks: true } } },
  });
  if (!sop?.currentVersion) throw new Error("This SOP has no published version to summarize yet.");

  const parsed = blocksSchema.safeParse(sop.currentVersion.blocks);
  const sourceText = parsed.success ? blocksToPlainText(parsed.data) : "";

  return runGeneration(actor, "QUICK_REFERENCE", { sopId }, async (provider) => {
    const result = await provider.generate({
      system: QUICK_REFERENCE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `SOP: ${sop.currentVersion!.title}\n\n${sanitizeSourceText(sourceText)}` }],
      maxTokens: 2200,
      temperature: 0.3,
      jsonSchemaHint: `{"title": string, "blocks": [ /* FSW content blocks */ ]}`,
    });

    const parsedOutput = parseJsonResponse<{ title?: string; blocks?: unknown[] }>(result.text);
    return {
      title: parsedOutput?.title?.trim() || `${sop.currentVersion!.title} — Quick Reference`,
      blocks: repairBlocks(parsedOutput?.blocks),
    };
  });
}

// ---------------------------------------------------------------------------
// Job handler
// ---------------------------------------------------------------------------

/** Reconstruct a usable Actor from a userId for job-handler contexts (no HTTP session available). */
export async function loadActorForJob(userId: string): Promise<Actor> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      status: true,
      timezone: true,
      language: true,
      businessUnitId: true,
      departmentId: true,
      teamId: true,
      positionId: true,
      locationId: true,
      managerId: true,
      workerType: true,
      country: true,
      roles: { select: { role: { select: { key: true, permissions: { select: { permission: true } } } } } },
    },
  });

  const permissions = new Set<Actor["permissions"] extends Set<infer P> ? P : never>();
  const roleKeys: string[] = [];
  for (const { role } of user.roles) {
    roleKeys.push(role.key);
    for (const { permission } of role.permissions) {
      permissions.add(permission as never);
    }
  }

  return { ...user, permissions, roleKeys };
}

export interface AiGenerateJobPayload {
  kind:
    | "SOP_DRAFT"
    | "COURSE_OUTLINE"
    | "COURSE_DRAFT"
    | "QUIZ_SUGGEST"
    | "TRANSLATE"
    | "QUALITY_CHECK"
    | "QUICK_REFERENCE";
  createdById: string;
  input: Record<string, unknown>;
  /** Where to write the result once generation completes (author reviews it there). */
  resultAiJobId?: string;
}

/**
 * Job handler for JOB_TYPES.AI_GENERATE, imported by the worker for the (rare)
 * generation flows an author kicks off and then comes back to later rather
 * than waiting on synchronously — most AI Studio flows call the functions
 * above directly from a server action instead.
 */
export async function handleAiGenerateJob(payload: Record<string, unknown>): Promise<void> {
  const kind = payload.kind;
  const createdById = payload.createdById;
  if (typeof kind !== "string" || typeof createdById !== "string") {
    throw new Error(`ai_generate job received an invalid payload: ${JSON.stringify(payload)}`);
  }

  const actor = await loadActorForJob(createdById);
  const input = (payload.input ?? {}) as Record<string, unknown>;

  switch (kind) {
    case "SOP_DRAFT":
      await generateSopDraft(actor, input as unknown as SopDraftInput);
      return;
    case "COURSE_OUTLINE":
      await generateCourseOutline(actor, input as CourseOutlineInput);
      return;
    case "COURSE_DRAFT":
      await generateCourseFromOutline(actor, input as unknown as CourseOutline);
      return;
    case "QUIZ_SUGGEST":
      await generateQuizQuestions(actor, input as unknown as GenerateQuizInput);
      return;
    case "TRANSLATE":
      await translateContent(actor, input as unknown as TranslateContentInput);
      return;
    case "QUALITY_CHECK":
      await runQualityCheck(actor, input as unknown as QualityCheckInput);
      return;
    case "QUICK_REFERENCE":
      await generateQuickReference(actor, String(input.sopId));
      return;
    default:
      throw new Error(`Unknown ai_generate job kind: ${kind}`);
  }
}
