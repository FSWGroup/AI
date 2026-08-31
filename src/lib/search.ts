import "server-only";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/auth/guard";
import { getVisibleUserIds } from "@/lib/auth/guard";

/**
 * Global search.
 *
 * Permission filtering happens inside the queries, not after them. A person can
 * only ever match content they are entitled to see:
 *  - SOPs and courses: PUBLISHED only, unless the actor can author.
 *  - Near misses: PUBLISHED only, and only for nearmiss.view holders. A report
 *    still in the review queue is never searchable, at any permission level —
 *    reviewers reach it through their queue, not through search.
 *  - People: only those inside the actor's visibility scope.
 *  - Sensitive profile fields: never searchable, at any permission level.
 *
 * Typo tolerance comes from pg_trgm similarity; exact and prefix matches rank
 * above fuzzy ones.
 */

export type SearchEntityType =
  | "SOP"
  | "COURSE"
  | "LESSON"
  | "LEARNING_PATH"
  | "PERSON"
  | "SKILL"
  | "VIDEO"
  | "NEAR_MISS";

export interface SearchResult {
  entityType: SearchEntityType;
  id: string;
  title: string;
  subtitle: string | null;
  snippet: string | null;
  href: string;
  score: number;
}

export interface SearchOptions {
  types?: SearchEntityType[];
  limit?: number;
}

/** Escape a term for safe use inside a LIKE pattern. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function excerpt(body: string | null, term: string, length = 160): string | null {
  if (!body) return null;
  const lower = body.toLowerCase();
  const index = lower.indexOf(term.toLowerCase());
  if (index === -1) return body.slice(0, length).trim() + (body.length > length ? "…" : "");
  const start = Math.max(0, index - 60);
  const slice = body.slice(start, start + length).trim();
  return `${start > 0 ? "…" : ""}${slice}${start + length < body.length ? "…" : ""}`;
}

export async function search(
  actor: Actor,
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const term = query.trim();
  if (term.length < 2) return [];

  const limit = Math.min(options.limit ?? 20, 50);
  const types = options.types;
  const wants = (type: SearchEntityType) => !types || types.includes(type);
  const pattern = likePattern(term);

  const canAuthorSops = actor.permissions.has("sop.create");
  const canAuthorCourses = actor.permissions.has("training.create");

  const results: SearchResult[] = [];

  // --- SOPs (title, summary, and full body text) ---
  if (wants("SOP") && actor.permissions.has("sop.view")) {
    const rows = await prisma.$queryRaw<
      {
        id: string;
        sopCode: string;
        title: string;
        category: string | null;
        status: string;
        body: string | null;
        score: number;
      }[]
    >`
      SELECT s."id", s."sopCode", s."title", s."category", s."status",
             LEFT(COALESCE(v."blocks"::text, s."draftBlocks"::text), 4000) AS body,
             GREATEST(
               CASE WHEN LOWER(s."title") = LOWER(${term}) THEN 1.0 ELSE 0 END,
               CASE WHEN LOWER(s."sopCode") = LOWER(${term}) THEN 1.0 ELSE 0 END,
               CASE WHEN s."title" ILIKE ${pattern} THEN 0.85 ELSE 0 END,
               CASE WHEN s."summary" ILIKE ${pattern} THEN 0.6 ELSE 0 END,
               CASE WHEN COALESCE(v."blocks"::text, '') ILIKE ${pattern} THEN 0.45 ELSE 0 END,
               similarity(s."title", ${term}) * 0.7
             ) AS score
      FROM "Sop" s
      LEFT JOIN "SopVersion" v ON v."id" = s."currentVersionId"
      WHERE s."isDeleted" = false
        AND (s."status" = 'PUBLISHED' OR ${canAuthorSops})
        AND (
          s."title" ILIKE ${pattern}
          OR s."sopCode" ILIKE ${pattern}
          OR s."summary" ILIKE ${pattern}
          OR s."category" ILIKE ${pattern}
          OR COALESCE(v."blocks"::text, '') ILIKE ${pattern}
          OR similarity(s."title", ${term}) > 0.25
        )
      ORDER BY score DESC
      LIMIT ${limit}
    `;

    for (const row of rows) {
      results.push({
        entityType: "SOP",
        id: row.id,
        title: row.title,
        subtitle: [row.sopCode, row.category].filter(Boolean).join(" · ") || null,
        snippet: excerpt(row.body, term),
        href: `/sops/${row.id}`,
        score: Number(row.score),
      });
    }
  }

  // --- Courses ---
  if (wants("COURSE") && actor.permissions.has("training.view")) {
    const rows = await prisma.$queryRaw<
      {
        id: string;
        title: string;
        description: string | null;
        category: string | null;
        score: number;
      }[]
    >`
      SELECT c."id", c."title", c."description", c."category",
             GREATEST(
               CASE WHEN LOWER(c."title") = LOWER(${term}) THEN 1.0 ELSE 0 END,
               CASE WHEN c."title" ILIKE ${pattern} THEN 0.85 ELSE 0 END,
               CASE WHEN c."description" ILIKE ${pattern} THEN 0.55 ELSE 0 END,
               similarity(c."title", ${term}) * 0.7
             ) AS score
      FROM "Course" c
      WHERE c."isDeleted" = false
        AND (c."status" = 'PUBLISHED' OR ${canAuthorCourses})
        AND (
          c."title" ILIKE ${pattern}
          OR c."description" ILIKE ${pattern}
          OR c."category" ILIKE ${pattern}
          OR similarity(c."title", ${term}) > 0.25
        )
      ORDER BY score DESC
      LIMIT ${limit}
    `;

    for (const row of rows) {
      results.push({
        entityType: "COURSE",
        id: row.id,
        title: row.title,
        subtitle: row.category ? `Course · ${row.category}` : "Course",
        snippet: excerpt(row.description, term),
        href: `/courses/${row.id}`,
        score: Number(row.score),
      });
    }
  }

  // --- Video transcripts ---
  if (wants("VIDEO") && actor.permissions.has("training.view")) {
    const rows = await prisma.mediaAsset.findMany({
      where: {
        kind: "VIDEO",
        isDeleted: false,
        OR: [
          { title: { contains: term, mode: "insensitive" } },
          { transcript: { contains: term, mode: "insensitive" } },
        ],
      },
      select: { id: true, title: true, filename: true, transcript: true },
      take: Math.min(limit, 10),
    });

    for (const row of rows) {
      results.push({
        entityType: "VIDEO",
        id: row.id,
        title: row.title ?? row.filename,
        subtitle: "Video transcript",
        snippet: excerpt(row.transcript, term),
        href: `/media/${row.id}`,
        score: 0.5,
      });
    }
  }

  // --- Learning paths ---
  if (wants("LEARNING_PATH")) {
    const rows = await prisma.learningPath.findMany({
      where: {
        isDeleted: false,
        status: actor.permissions.has("path.create") ? undefined : "PUBLISHED",
        OR: [
          { title: { contains: term, mode: "insensitive" } },
          { description: { contains: term, mode: "insensitive" } },
        ],
      },
      select: { id: true, title: true, description: true },
      take: Math.min(limit, 10),
    });

    for (const row of rows) {
      results.push({
        entityType: "LEARNING_PATH",
        id: row.id,
        title: row.title,
        subtitle: "Learning path",
        snippet: excerpt(row.description, term),
        href: `/paths/${row.id}`,
        score: 0.6,
      });
    }
  }

  // --- Skills ---
  if (wants("SKILL") && actor.permissions.has("skills.view")) {
    const rows = await prisma.skill.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { description: { contains: term, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, category: true, description: true },
      take: Math.min(limit, 8),
    });

    for (const row of rows) {
      results.push({
        entityType: "SKILL",
        id: row.id,
        title: row.name,
        subtitle: row.category ? `Skill · ${row.category}` : "Skill",
        snippet: excerpt(row.description, term),
        href: `/skills/${row.id}`,
        score: 0.5,
      });
    }
  }

  /*
   * --- Near misses (published case studies only) ---
   *
   * Deliberately never widened for reviewers the way SOPs and courses are
   * widened for authors: an unpublished report has not yet had identifying
   * detail removed, so it must not be reachable by a text search that a
   * reviewer might run for an unrelated reason.
   */
  if (wants("NEAR_MISS") && actor.permissions.has("nearmiss.view")) {
    const rows = await prisma.nearMiss.findMany({
      where: {
        isDeleted: false,
        status: "PUBLISHED",
        OR: [
          { title: { contains: term, mode: "insensitive" } },
          { reference: { contains: term, mode: "insensitive" } },
          { whatHappened: { contains: term, mode: "insensitive" } },
          { howItWasCaught: { contains: term, mode: "insensitive" } },
          { whyItHappened: { contains: term, mode: "insensitive" } },
          { whatChanged: { contains: term, mode: "insensitive" } },
        ],
      },
      // No reporter column: the published shape cannot leak who filed it.
      select: {
        id: true,
        reference: true,
        title: true,
        whatChanged: true,
        whatHappened: true,
      },
      orderBy: { publishedAt: "desc" },
      take: Math.min(limit, 8),
    });

    for (const row of rows) {
      results.push({
        entityType: "NEAR_MISS",
        id: row.id,
        title: row.title,
        subtitle: `Near miss · ${row.reference}`,
        snippet: excerpt(row.whatChanged ?? row.whatHappened, term),
        href: `/near-misses/${row.reference}`,
        score: 0.55,
      });
    }
  }

  // --- People (scoped, and never sensitive fields) ---
  if (wants("PERSON") && actor.permissions.has("people.view")) {
    const visible = await getVisibleUserIds(actor);
    const rows = await prisma.user.findMany({
      where: {
        status: { not: "INACTIVE" },
        ...(visible === "ALL" ? {} : { id: { in: visible } }),
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { email: { contains: term, mode: "insensitive" } },
          { title: { contains: term, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        title: true,
        email: true,
        department: { select: { name: true } },
      },
      take: Math.min(limit, 10),
    });

    for (const row of rows) {
      results.push({
        entityType: "PERSON",
        id: row.id,
        title: row.name,
        subtitle: [row.title, row.department?.name].filter(Boolean).join(" · ") || row.email,
        snippet: null,
        href: `/people/${row.id}`,
        score: row.name.toLowerCase() === term.toLowerCase() ? 1 : 0.7,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Record a search for the analytics dashboard. Query text is stored, never PII. */
export async function recordSearch(userId: string, query: string, resultCount: number): Promise<void> {
  await prisma.analyticsEvent.create({
    data: {
      userId,
      event: "search_performed",
      metadata: { queryLength: query.length, resultCount },
    },
  });
}
