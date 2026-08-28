import "server-only";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import type { Actor } from "@/lib/auth/guard";
import { Prisma } from "@prisma/client";
import type { MediaKind } from "@prisma/client";

/**
 * Media library: listing, usage tracking, and guarded deletion.
 *
 * Deletion is refused whenever a MediaAsset is still referenced by a course
 * thumbnail, a learning path thumbnail, lesson content, or SOP content — the
 * caller gets the usage list back instead of an error, so the admin UI can
 * link straight to what needs to change first.
 */

export interface MediaListParams {
  kind?: MediaKind;
  ownerId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface MediaListItem {
  id: string;
  kind: MediaKind;
  filename: string;
  title: string | null;
  altText: string | null;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  processingStatus: string | null;
  sha256: string | null;
  ownerId: string | null;
  ownerName: string | null;
  createdAt: Date;
}

export async function listMedia(
  params: MediaListParams,
): Promise<{ items: MediaListItem[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 24));

  const where: Prisma.MediaAssetWhereInput = {
    isDeleted: false,
    ...(params.kind ? { kind: params.kind } : {}),
    ...(params.ownerId ? { ownerId: params.ownerId } : {}),
    ...(params.q
      ? {
          OR: [
            { filename: { contains: params.q, mode: "insensitive" } },
            { title: { contains: params.q, mode: "insensitive" } },
            { altText: { contains: params.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.mediaAsset.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        kind: true,
        filename: true,
        title: true,
        altText: true,
        mimeType: true,
        sizeBytes: true,
        durationSeconds: true,
        processingStatus: true,
        sha256: true,
        ownerId: true,
        createdAt: true,
      },
    }),
    prisma.mediaAsset.count({ where }),
  ]);

  const ownerIds = [...new Set(rows.map((r) => r.ownerId).filter((id): id is string => Boolean(id)))];
  const owners = ownerIds.length
    ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })
    : [];
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));

  return {
    items: rows.map((r) => ({ ...r, ownerName: r.ownerId ? (ownerName.get(r.ownerId) ?? null) : null })),
    total,
    page,
    pageSize,
  };
}

export async function getMediaAsset(id: string) {
  return prisma.mediaAsset.findFirst({ where: { id, isDeleted: false } });
}

/** Look up an existing asset by content hash, for upload-time duplicate detection. */
export async function findDuplicateBySha256(sha256: string) {
  return prisma.mediaAsset.findFirst({ where: { sha256, isDeleted: false }, orderBy: { createdAt: "asc" } });
}

export interface MediaUsageRef {
  id: string;
  title: string;
  href: string;
}

export interface MediaUsage {
  total: number;
  courses: MediaUsageRef[];
  paths: MediaUsageRef[];
  sops: MediaUsageRef[];
}

/** Cheap, safe reference check: cuid ids are unique random strings, so a
 * substring match against the serialized JSON blob reliably finds references
 * without needing to know every lesson-content or block shape in the system. */
function jsonReferencesMedia(value: unknown, mediaId: string): boolean {
  if (value === null || value === undefined) return false;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.includes(mediaId);
}

/**
 * Scans lesson content, SOP draft and published blocks, and course/path
 * thumbnails for references to a media asset. Used both to show "used by N
 * courses / N SOPs" in the library and to refuse deletion while in use.
 */
export async function getMediaUsage(mediaId: string): Promise<MediaUsage> {
  const [thumbnailCourses, thumbnailPaths, lessons, sops] = await Promise.all([
    prisma.course.findMany({
      where: { thumbnailMediaId: mediaId, isDeleted: false },
      select: { id: true, title: true },
    }),
    prisma.learningPath.findMany({
      where: { thumbnailMediaId: mediaId, isDeleted: false },
      select: { id: true, title: true },
    }),
    prisma.lesson.findMany({
      where: { content: { not: Prisma.JsonNull } },
      select: {
        id: true,
        content: true,
        section: { select: { course: { select: { id: true, title: true, isDeleted: true } } } },
      },
    }),
    prisma.sop.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        sopCode: true,
        title: true,
        draftBlocks: true,
        currentVersion: { select: { blocks: true } },
      },
    }),
  ]);

  const courseMap = new Map<string, MediaUsageRef>();
  for (const c of thumbnailCourses) {
    courseMap.set(c.id, { id: c.id, title: c.title, href: `/admin/content/courses/${c.id}` });
  }
  for (const lesson of lessons) {
    const course = lesson.section.course;
    if (!course || course.isDeleted || courseMap.has(course.id)) continue;
    if (jsonReferencesMedia(lesson.content, mediaId)) {
      courseMap.set(course.id, { id: course.id, title: course.title, href: `/admin/content/courses/${course.id}` });
    }
  }

  const pathMap = new Map<string, MediaUsageRef>();
  for (const p of thumbnailPaths) {
    pathMap.set(p.id, { id: p.id, title: p.title, href: `/admin/content/paths/${p.id}` });
  }

  const sopMap = new Map<string, MediaUsageRef>();
  for (const sop of sops) {
    const referenced =
      jsonReferencesMedia(sop.draftBlocks, mediaId) || jsonReferencesMedia(sop.currentVersion?.blocks, mediaId);
    if (referenced) {
      sopMap.set(sop.id, { id: sop.id, title: `${sop.sopCode} — ${sop.title}`, href: `/admin/content/sops/${sop.id}` });
    }
  }

  const courses = [...courseMap.values()];
  const paths = [...pathMap.values()];
  const sopsUsed = [...sopMap.values()];

  return { total: courses.length + paths.length + sopsUsed.length, courses, paths, sops: sopsUsed };
}

export interface DeleteMediaResult {
  ok: boolean;
  reason?: string;
  usage?: MediaUsage;
}

/** Deletes a media asset only when nothing references it; otherwise returns the usage list. */
export async function deleteMedia(actor: Actor, mediaId: string): Promise<DeleteMediaResult> {
  const asset = await getMediaAsset(mediaId);
  if (!asset) return { ok: false, reason: "That media asset no longer exists." };

  const usage = await getMediaUsage(mediaId);
  if (usage.total > 0) {
    return {
      ok: false,
      reason: `This file is used by ${usage.courses.length} course${usage.courses.length === 1 ? "" : "s"}, ${usage.paths.length} learning path${usage.paths.length === 1 ? "" : "s"}, and ${usage.sops.length} SOP${usage.sops.length === 1 ? "" : "s"}. Remove those references first.`,
      usage,
    };
  }

  await getStorage()
    .delete(asset.storagePath)
    .catch((error) => console.error("[media] storage delete failed", error));

  await prisma.mediaAsset.update({ where: { id: mediaId }, data: { isDeleted: true } });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.MEDIA_DELETED,
    entityType: "MEDIA",
    entityId: mediaId,
    metadata: { filename: asset.filename, kind: asset.kind },
  });

  return { ok: true };
}

export interface UpdateMediaInput {
  title?: string | null;
  altText?: string | null;
}

export async function updateMediaMetadata(mediaId: string, input: UpdateMediaInput) {
  return prisma.mediaAsset.update({
    where: { id: mediaId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.altText !== undefined ? { altText: input.altText } : {}),
    },
  });
}

/** SCORM package metadata is stored in the otherwise-unused `chapters` JSON
 * column for DOCUMENT-kind zip assets — MediaAsset has no dedicated SCORM
 * field and the schema is owned elsewhere, so this is a deliberate, narrowly
 * scoped reuse rather than a new column. See src/lib/services/scorm.ts. */
export interface ScormPackageMarker {
  scorm: {
    version: "1.2" | "2004";
    launchPath: string;
    identifier: string;
    title: string | null;
  };
}

export function isScormMarker(value: unknown): value is ScormPackageMarker {
  return Boolean(value && typeof value === "object" && "scorm" in (value as Record<string, unknown>));
}
