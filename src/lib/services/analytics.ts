import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/**
 * Privacy-conscious product analytics.
 *
 * AnalyticsEvent never stores content bodies, free-text answers, search
 * queries verbatim, or anything from SensitiveField. Metadata is limited to
 * short primitive values so a careless call site cannot leak a lesson body or
 * a person's sensitive data into the analytics table.
 */

export const ANALYTICS_EVENTS = [
  "course_started",
  "lesson_completed",
  "course_completed",
  "assessment_attempted",
  "search_performed",
  "ai_question_asked",
  "sop_viewed",
  "feedback_submitted",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number] | (string & {});

const MAX_STRING_METADATA_LENGTH = 200;

/** Keep only short primitive values; drop anything that could carry content bodies. */
function sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "number" || typeof value === "boolean") {
      clean[key] = value;
    } else if (typeof value === "string" && value.length <= MAX_STRING_METADATA_LENGTH) {
      clean[key] = value;
    }
    // Objects, arrays, long strings, and null/undefined are intentionally dropped.
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

/**
 * Record a product analytics event. Never throws — analytics must not break
 * the user-facing action that triggered it.
 */
export async function track(
  userId: string | null,
  event: AnalyticsEventName,
  entity?: { type: string; id: string },
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.analyticsEvent.create({
      data: {
        userId: userId ?? null,
        event,
        entityType: entity?.type ?? null,
        entityId: entity?.id ?? null,
        metadata: (sanitizeMetadata(metadata) ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (error) {
    console.error("[analytics] failed to record event", event, error instanceof Error ? error.message : error);
  }
}

export interface DayCount {
  date: string; // YYYY-MM-DD
  count: number;
}

/** Daily counts for one or more event names over a trailing window, zero-filled. */
export async function getActivityOverTime(events: string[], days = 30): Promise<DayCount[]> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));

  const rows = await prisma.$queryRaw<{ day: Date; count: bigint }[]>`
    SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
    FROM "AnalyticsEvent"
    WHERE "event" = ANY(${events}) AND "createdAt" >= ${since}
    GROUP BY day
    ORDER BY day ASC
  `;
  const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), Number(r.count)]));

  const out: DayCount[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, count: byDay.get(key) ?? 0 });
  }
  return out;
}

/** Total event count in a trailing window, for simple KPI tiles. */
export async function getEventCount(events: string[], days = 30): Promise<number> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return prisma.analyticsEvent.count({ where: { event: { in: events }, createdAt: { gte: since } } });
}

export interface AiActivitySummary {
  questionsAsked: number;
  searchesPerformed: number;
  aiJobsQueued: number;
  aiJobsCompleted: number;
  aiJobsFailed: number;
}

/** Summary tile data for the admin dashboard's "AI generation activity" panel. */
export async function getAiActivitySummary(days = 30): Promise<AiActivitySummary> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [questionsAsked, searchesPerformed, jobStatusRows] = await Promise.all([
    prisma.analyticsEvent.count({ where: { event: "ai_question_asked", createdAt: { gte: since } } }),
    prisma.analyticsEvent.count({ where: { event: "search_performed", createdAt: { gte: since } } }),
    prisma.aiJob.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
  ]);

  const byStatus = new Map(jobStatusRows.map((r) => [r.status, r._count._all]));
  return {
    questionsAsked,
    searchesPerformed,
    aiJobsQueued: (byStatus.get("QUEUED") ?? 0) + (byStatus.get("RUNNING") ?? 0),
    aiJobsCompleted: byStatus.get("COMPLETE") ?? 0,
    aiJobsFailed: byStatus.get("FAILED") ?? 0,
  };
}

export interface TopEntity {
  entityId: string;
  count: number;
}

/** Most-active entities for a given event within a window (e.g. most-viewed SOPs). */
export async function getTopEntities(event: string, entityType: string, days = 30, limit = 10): Promise<TopEntity[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.analyticsEvent.groupBy({
    by: ["entityId"],
    where: { event, entityType, createdAt: { gte: since }, entityId: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { entityId: "desc" } },
    take: limit,
  });
  return rows
    .filter((r): r is typeof r & { entityId: string } => r.entityId !== null)
    .map((r) => ({ entityId: r.entityId, count: r._count._all }));
}
