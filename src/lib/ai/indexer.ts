import "server-only";
import { prisma } from "@/lib/db";
import { getEmbeddingProvider } from "@/lib/ai/index";
import { blocksSchema, blocksToChunks, blocksToPlainText } from "@/lib/content/types";

/**
 * RAG corpus builder.
 *
 * Populates KnowledgeChunk from PUBLISHED content only. This file owns the
 * write side of the retrieval corpus; src/lib/ai/rag.ts owns the permission-
 * filtered read side. Re-running any of these functions is safe: each one
 * deletes its entity's prior chunks before inserting fresh ones, so a
 * re-index never leaves stale or duplicate rows behind.
 */

const MAX_EMBED_BATCH = 64;

/** Lightweight shape of a course-version snapshot (see prisma/seed-content.ts). */
interface CourseSnapshotLesson {
  id: string;
  title: string;
  type: string;
  content: unknown;
}

interface CourseSnapshotSection {
  id: string;
  title: string;
  lessons: CourseSnapshotLesson[];
}

interface CourseSnapshot {
  title?: string;
  sections?: CourseSnapshotSection[];
}

/** Turn arbitrary lesson content into plain text, defensively, by lesson type. Shared with coach.ts. */
export function lessonContentToText(type: string, content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const c = content as Record<string, unknown>;

  switch (type) {
    case "RICH_TEXT": {
      const parsed = blocksSchema.safeParse(c.blocks);
      return parsed.success ? blocksToPlainText(parsed.data) : "";
    }
    case "SCENARIO": {
      const lines: string[] = [];
      if (typeof c.scenario === "string") lines.push(c.scenario);
      if (Array.isArray(c.choices)) {
        for (const choice of c.choices as Record<string, unknown>[]) {
          if (typeof choice.label === "string") lines.push(`Option: ${choice.label}`);
          if (choice.correct === true && typeof choice.feedback === "string") {
            lines.push(`Correct approach: ${choice.feedback}`);
          }
        }
      }
      return lines.join("\n");
    }
    case "CHECKLIST": {
      if (!Array.isArray(c.items)) return "";
      return (c.items as Record<string, unknown>[])
        .map((item) => (typeof item.text === "string" ? `- ${item.text}` : ""))
        .filter(Boolean)
        .join("\n");
    }
    case "ACKNOWLEDGEMENT":
      return typeof c.statement === "string" ? c.statement : "";
    case "QUIZ":
      // Quiz questions live on the Question rows in the live schema, or as an
      // inline `questions` array in a version snapshot — handle both.
      if (Array.isArray(c.questions)) {
        return (c.questions as Record<string, unknown>[])
          .map((q) => (typeof q.prompt === "string" ? `Question: ${q.prompt}` : ""))
          .filter(Boolean)
          .join("\n");
      }
      return "";
    case "SOP_REF":
      return ""; // The referenced SOP is indexed separately under its own entity.
    default:
      // VIDEO / AI_VIDEO / SCREEN_RECORDING transcripts are pulled by caller
      // (they require a MediaAsset lookup); other types have no indexable text.
      return "";
  }
}

/** Entity types this file writes chunks for. */
type IndexableEntityType = "SOP" | "COURSE" | "NEAR_MISS";

async function deleteChunks(entityType: IndexableEntityType, entityId: string): Promise<void> {
  await prisma.knowledgeChunk.deleteMany({ where: { entityType, entityId } });
}

async function embedAndStore(
  rows: { id: string; content: string }[],
): Promise<void> {
  const provider = getEmbeddingProvider();
  if (!provider || rows.length === 0) return;

  for (let i = 0; i < rows.length; i += MAX_EMBED_BATCH) {
    const batch = rows.slice(i, i + MAX_EMBED_BATCH);
    let vectors: number[][];
    try {
      vectors = await provider.embed(batch.map((r) => r.content));
    } catch (error) {
      // Embedding is an enhancement, not a hard requirement — keyword search
      // still works without it. Log and continue rather than failing the index.
      console.error("[indexer] embedding batch failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (let j = 0; j < batch.length; j += 1) {
      const row = batch[j];
      const vector = vectors[j];
      if (!row || !vector) continue;
      const literal = `[${vector.join(",")}]`;
      await prisma.$executeRaw`
        UPDATE "KnowledgeChunk" SET embedding = ${literal}::vector WHERE id = ${row.id}
      `;
    }
  }
}

export interface IndexResult {
  entityType: IndexableEntityType;
  entityId: string;
  chunkCount: number;
  embedded: boolean;
}

/**
 * Index the currently PUBLISHED version of one SOP. A draft-only SOP (never
 * published) has nothing to index yet — it is intentionally excluded from the
 * corpus until it publishes, since retrieval only ever serves published,
 * approved content.
 */
export async function indexSop(sopId: string): Promise<IndexResult | null> {
  const sop = await prisma.sop.findUnique({
    where: { id: sopId },
    select: {
      id: true,
      title: true,
      status: true,
      isDeleted: true,
      businessUnitId: true,
      departmentId: true,
      language: true,
      currentVersion: {
        select: { versionNumber: true, blocks: true },
      },
    },
  });

  await deleteChunks("SOP", sopId);

  if (!sop || sop.isDeleted || sop.status !== "PUBLISHED" || !sop.currentVersion) {
    return null;
  }

  const parsedBlocks = blocksSchema.safeParse(sop.currentVersion.blocks);
  if (!parsedBlocks.success) {
    console.error("[indexer] SOP version blocks failed schema validation", {
      sopId,
      issues: parsedBlocks.error.issues.slice(0, 3),
    });
    return null;
  }

  const chunks = blocksToChunks(parsedBlocks.data);
  if (chunks.length === 0) return { entityType: "SOP", entityId: sopId, chunkCount: 0, embedded: false };

  const created = await prisma.$transaction(
    chunks.map((chunk) =>
      prisma.knowledgeChunk.create({
        data: {
          entityType: "SOP",
          entityId: sop.id,
          versionLabel: sop.currentVersion?.versionNumber ?? null,
          title: sop.title,
          sectionPath: chunk.sectionPath || null,
          content: chunk.content,
          language: sop.language,
          businessUnitId: sop.businessUnitId,
          departmentId: sop.departmentId,
          requiredPermission: null,
        },
        select: { id: true, content: true },
      }),
    ),
  );

  await embedAndStore(created);

  return {
    entityType: "SOP",
    entityId: sopId,
    chunkCount: created.length,
    embedded: getEmbeddingProvider() !== null,
  };
}

/**
 * Index the currently PUBLISHED version of one course: rich-text lesson
 * bodies, scenario/checklist/acknowledgement text, and video transcripts.
 * Quiz question banks are intentionally excluded from the retrieval corpus
 * (they would let Ask FSW AI leak answers) — the surrounding lesson text
 * still teaches the material.
 */
export async function indexCourse(courseId: string): Promise<IndexResult | null> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      title: true,
      status: true,
      isDeleted: true,
      businessUnitId: true,
      departmentId: true,
      language: true,
      currentVersion: { select: { versionNumber: true, snapshot: true } },
    },
  });

  await deleteChunks("COURSE", courseId);

  if (!course || course.isDeleted || course.status !== "PUBLISHED" || !course.currentVersion) {
    return null;
  }

  const snapshot = course.currentVersion.snapshot as unknown as CourseSnapshot;
  const sections = Array.isArray(snapshot?.sections) ? snapshot.sections : [];

  // Collect video media ids up front so transcripts can be fetched in one query.
  const videoLessons: { sectionTitle: string; lessonTitle: string; mediaId: string }[] = [];
  const textChunks: { sectionPath: string; content: string }[] = [];

  for (const section of sections) {
    for (const lesson of section.lessons ?? []) {
      const isVideoType = lesson.type === "VIDEO" || lesson.type === "AI_VIDEO" || lesson.type === "SCREEN_RECORDING";
      const content = lesson.content as Record<string, unknown> | null | undefined;

      if (isVideoType && content && typeof content.mediaId === "string") {
        videoLessons.push({
          sectionTitle: section.title,
          lessonTitle: lesson.title,
          mediaId: content.mediaId,
        });
        continue;
      }

      const text = lessonContentToText(lesson.type, lesson.content);
      if (text.trim().length > 0) {
        // Re-chunk long lesson bodies the same way SOPs are chunked, so no
        // single chunk grows unbounded.
        const subChunks = chunkPlainText(text, `${section.title} > ${lesson.title}`);
        textChunks.push(...subChunks);
      }
    }
  }

  const mediaIds = videoLessons.map((v) => v.mediaId);
  const media = mediaIds.length
    ? await prisma.mediaAsset.findMany({
        where: { id: { in: mediaIds }, isDeleted: false },
        select: { id: true, transcript: true },
      })
    : [];
  const transcriptById = new Map(media.map((m) => [m.id, m.transcript]));

  for (const v of videoLessons) {
    const transcript = transcriptById.get(v.mediaId);
    if (transcript && transcript.trim().length > 0) {
      textChunks.push(
        ...chunkPlainText(transcript, `${v.sectionTitle} > ${v.lessonTitle} (video transcript)`),
      );
    }
  }

  if (textChunks.length === 0) {
    return { entityType: "COURSE", entityId: courseId, chunkCount: 0, embedded: false };
  }

  const created = await prisma.$transaction(
    textChunks.map((chunk) =>
      prisma.knowledgeChunk.create({
        data: {
          entityType: "COURSE",
          entityId: course.id,
          versionLabel: course.currentVersion?.versionNumber ?? null,
          title: course.title,
          sectionPath: chunk.sectionPath || null,
          content: chunk.content,
          language: course.language,
          businessUnitId: course.businessUnitId,
          departmentId: course.departmentId,
          requiredPermission: null,
        },
        select: { id: true, content: true },
      }),
    ),
  );

  await embedAndStore(created);

  return {
    entityType: "COURSE",
    entityId: courseId,
    chunkCount: created.length,
    embedded: getEmbeddingProvider() !== null,
  };
}

/** Split a plain-text block into ~1400 char chunks, reusing the SOP chunker's limit. */
function chunkPlainText(text: string, sectionPath: string, maxChars = 1400): { sectionPath: string; content: string }[] {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return [{ sectionPath, content: trimmed }];

  const chunks: { sectionPath: string; content: string }[] = [];
  const paragraphs = trimmed.split(/\n{2,}/);
  let buffer = "";
  for (const para of paragraphs) {
    if ((buffer + "\n\n" + para).length > maxChars && buffer.length > 0) {
      chunks.push({ sectionPath, content: buffer.trim() });
      buffer = para;
    } else {
      buffer = buffer ? `${buffer}\n\n${para}` : para;
    }
  }
  if (buffer.trim().length > 0) chunks.push({ sectionPath, content: buffer.trim() });
  return chunks;
}

/** Remove all chunks for one entity, e.g. when it is archived or deleted. */
export async function removeFromIndex(
  entityType: IndexableEntityType,
  entityId: string,
): Promise<void> {
  await deleteChunks(entityType, entityId);
}

/**
 * Index one published near miss as a single chunk.
 *
 * Two differences from SOPs and courses, both deliberate:
 *
 *  - `requiredPermission` is set to "nearmiss.view", so retrieval can never
 *    hand a case study to someone without the capability — contractors hold
 *    "nearmiss.report" but not "nearmiss.view", and the ACL clause in rag.ts
 *    enforces that inside the same WHERE as every other rule.
 *  - The reporter is never read, let alone indexed. The narrative is the only
 *    text that reaches the corpus, and it has already been checked for
 *    identifying detail as a condition of publication.
 *
 * One chunk rather than many: a case study is short and only makes sense whole
 * — "what changed" is meaningless without "what happened".
 */
export async function indexNearMiss(nearMissId: string): Promise<IndexResult | null> {
  const nearMiss = await prisma.nearMiss.findUnique({
    where: { id: nearMissId },
    select: {
      id: true,
      reference: true,
      title: true,
      status: true,
      isDeleted: true,
      businessUnitId: true,
      departmentId: true,
      whatHappened: true,
      howItWasCaught: true,
      whyItHappened: true,
      whatChanged: true,
      occurredOn: true,
    },
  });

  await deleteChunks("NEAR_MISS", nearMissId);

  if (!nearMiss || nearMiss.isDeleted || nearMiss.status !== "PUBLISHED") return null;

  const content = [
    `What happened: ${nearMiss.whatHappened}`,
    nearMiss.howItWasCaught ? `How it was caught: ${nearMiss.howItWasCaught}` : null,
    nearMiss.whyItHappened ? `Why it happened: ${nearMiss.whyItHappened}` : null,
    nearMiss.whatChanged ? `What changed: ${nearMiss.whatChanged}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n\n");

  const created = await prisma.knowledgeChunk.create({
    data: {
      entityType: "NEAR_MISS",
      entityId: nearMiss.id,
      versionLabel: nearMiss.reference,
      title: nearMiss.title,
      sectionPath: "Near miss",
      content,
      language: "en",
      businessUnitId: nearMiss.businessUnitId,
      departmentId: nearMiss.departmentId,
      requiredPermission: "nearmiss.view",
    },
    select: { id: true, content: true },
  });

  await embedAndStore([created]);

  return {
    entityType: "NEAR_MISS",
    entityId: nearMissId,
    chunkCount: 1,
    embedded: getEmbeddingProvider() !== null,
  };
}

/**
 * Full corpus rebuild: every published SOP, course and near miss. Safe to run
 * repeatedly — each index call clears its own entity's chunks first.
 */
export async function indexAll(): Promise<{
  sops: number;
  courses: number;
  nearMisses: number;
  totalChunks: number;
}> {
  const [sops, courses, nearMisses] = await Promise.all([
    prisma.sop.findMany({
      where: { status: "PUBLISHED", isDeleted: false },
      select: { id: true },
    }),
    prisma.course.findMany({
      where: { status: "PUBLISHED", isDeleted: false },
      select: { id: true },
    }),
    prisma.nearMiss.findMany({
      where: { status: "PUBLISHED", isDeleted: false },
      select: { id: true },
    }),
  ]);

  let totalChunks = 0;
  for (const sop of sops) {
    const result = await indexSop(sop.id);
    totalChunks += result?.chunkCount ?? 0;
  }
  for (const course of courses) {
    const result = await indexCourse(course.id);
    totalChunks += result?.chunkCount ?? 0;
  }
  for (const nearMiss of nearMisses) {
    const result = await indexNearMiss(nearMiss.id);
    totalChunks += result?.chunkCount ?? 0;
  }

  return {
    sops: sops.length,
    courses: courses.length,
    nearMisses: nearMisses.length,
    totalChunks,
  };
}

export interface IndexContentJobPayload {
  entityType: IndexableEntityType;
  entityId: string;
  /** When true, remove the entity's chunks instead of indexing (archive/delete). */
  remove?: boolean;
}

/** Job handler for JOB_TYPES.INDEX_CONTENT, imported by the worker. */
export async function handleIndexContentJob(payload: Record<string, unknown>): Promise<void> {
  const entityType = payload.entityType;
  const entityId = payload.entityId;
  const known = entityType === "SOP" || entityType === "COURSE" || entityType === "NEAR_MISS";
  if (!known || typeof entityId !== "string") {
    throw new Error(`index_content job received an invalid payload: ${JSON.stringify(payload)}`);
  }

  if (payload.remove === true) {
    await removeFromIndex(entityType, entityId);
    return;
  }

  if (entityType === "SOP") {
    await indexSop(entityId);
  } else if (entityType === "COURSE") {
    await indexCourse(entityId);
  } else {
    await indexNearMiss(entityId);
  }
}
