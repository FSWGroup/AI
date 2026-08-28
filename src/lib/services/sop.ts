import "server-only";
import { z } from "zod";
import type { ContentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AuthorizationError, type Actor } from "@/lib/auth/guard";
import type { Permission } from "@/lib/permissions";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { enqueueJob, JOB_TYPES } from "@/lib/jobs/queue";
import { notify, notifyMany } from "@/lib/notifications";
import { getSettings } from "@/lib/settings";
import {
  blocksSchema,
  sopMetaSchema,
  blocksToPlainText,
  EMPTY_SOP_META,
  type Block,
  type SopMeta,
} from "@/lib/content/types";

/**
 * SOP domain logic.
 *
 * Every exported function takes the acting `Actor` and enforces its own
 * permission check (defense in depth — pages and server actions also guard,
 * but this file is safe to call from any future entry point).
 *
 * Note on relations: `Sop.ownerId` / `smeId` / `reviewerId` / `approverId`,
 * `SopVersion.authorId` / `reviewerId` / `approverId`, and similar "who did
 * this" columns across this schema are plain string columns with no Prisma
 * relation declared (see prisma/schema.prisma). Names are always resolved via
 * the batch `resolveUserNames` / `resolveDepartmentNames` helpers below.
 */

// ---------------------------------------------------------------------------
// Errors & small guards
// ---------------------------------------------------------------------------

/** A domain-rule violation (missing content, bad state transition, etc). */
export class SopValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SopValidationError";
  }
}

function ensure(actor: Actor, permission: Permission): void {
  if (!actor.permissions.has(permission)) throw new AuthorizationError(permission);
}

function ensureAny(actor: Actor, permissions: Permission[]): void {
  if (!permissions.some((p) => actor.permissions.has(p))) {
    throw new AuthorizationError(permissions.join(" or "));
  }
}

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function parseBlocks(value: unknown): Block[] {
  const parsed = blocksSchema.safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

function parseMeta(value: unknown): SopMeta {
  const parsed = sopMetaSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : EMPTY_SOP_META;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

// ---------------------------------------------------------------------------
// Batch name resolution (no Prisma relation exists on these FK columns)
// ---------------------------------------------------------------------------

export interface PersonRef {
  id: string;
  name: string;
  email: string;
}

export async function resolveUserNames(ids: (string | null | undefined)[]): Promise<Map<string, PersonRef>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, email: true },
  });
  return new Map(rows.map((row) => [row.id, row]));
}

export async function resolveDepartmentNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.department.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** Options for the owner / SME / reviewer / approver pickers in the editor. */
export async function listPeopleForPicker(): Promise<PersonRef[]> {
  return prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
    take: 500,
  });
}

// ---------------------------------------------------------------------------
// 1. createSop
// ---------------------------------------------------------------------------

export const createSopInputSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters.").max(200),
  summary: z.string().trim().max(500).optional(),
  codePrefix: z.string().trim().min(2, "Choose a code prefix, e.g. OPS or SALES.").max(12),
  kind: z.enum(["SOP", "POLICY"]).default("SOP"),
  category: z.string().trim().max(100).optional(),
  departmentId: z.string().min(1).optional().nullable(),
  businessUnitId: z.string().min(1).optional().nullable(),
  ownerId: z.string().min(1).optional().nullable(),
  smeId: z.string().min(1).optional().nullable(),
  reviewerId: z.string().min(1).optional().nullable(),
  approverId: z.string().min(1).optional().nullable(),
  language: z.string().default("en"),
  reviewCycleDays: z.number().int().positive().max(3650).optional(),
});
export type CreateSopInput = z.infer<typeof createSopInputSchema>;

async function nextSopCode(prefix: string): Promise<string> {
  const clean = prefix
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!clean) throw new SopValidationError("Choose a valid code prefix (letters and numbers only).");

  const existing = await prisma.sop.findMany({
    where: { sopCode: { startsWith: `${clean}-` } },
    select: { sopCode: true },
  });

  let max = 0;
  for (const row of existing) {
    const suffix = row.sopCode.slice(clean.length + 1);
    const parsed = Number.parseInt(suffix, 10);
    if (Number.isFinite(parsed) && parsed > max) max = parsed;
  }
  return `${clean}-${String(max + 1).padStart(3, "0")}`;
}

/** Creates a DRAFT SOP with a freshly minted, race-safe sopCode. */
export async function createSop(actor: Actor, input: CreateSopInput) {
  ensure(actor, "sop.create");
  const parsed = createSopInputSchema.parse(input);

  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const sopCode = await nextSopCode(parsed.codePrefix);
    try {
      const sop = await prisma.sop.create({
        data: {
          sopCode,
          kind: parsed.kind,
          title: parsed.title,
          summary: parsed.summary || null,
          category: parsed.category || null,
          departmentId: parsed.departmentId || null,
          businessUnitId: parsed.businessUnitId || null,
          ownerId: parsed.ownerId || null,
          smeId: parsed.smeId || null,
          reviewerId: parsed.reviewerId || null,
          approverId: parsed.approverId || null,
          language: parsed.language,
          reviewCycleDays: parsed.reviewCycleDays ?? null,
          status: "DRAFT",
          draftBlocks: toJson([] satisfies Block[]),
          draftMeta: toJson(EMPTY_SOP_META),
          createdById: actor.id,
        },
      });

      await recordAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: AUDIT_ACTIONS.SOP_CREATED,
        entityType: "SOP",
        entityId: sop.id,
        metadata: { sopCode: sop.sopCode, kind: sop.kind },
      });

      return sop;
    } catch (error) {
      const isUniqueViolation =
        typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2002";
      if (isUniqueViolation && attempt < maxAttempts - 1) continue;
      throw error;
    }
  }
  throw new SopValidationError("Could not generate a unique SOP code. Try again.");
}

// ---------------------------------------------------------------------------
// 2. updateSopDraft
// ---------------------------------------------------------------------------

export const updateSopDraftInputSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  summary: z.string().trim().max(500).optional().nullable(),
  category: z.string().trim().max(100).optional().nullable(),
  departmentId: z.string().min(1).optional().nullable(),
  businessUnitId: z.string().min(1).optional().nullable(),
  ownerId: z.string().min(1).optional().nullable(),
  smeId: z.string().min(1).optional().nullable(),
  reviewerId: z.string().min(1).optional().nullable(),
  approverId: z.string().min(1).optional().nullable(),
  language: z.string().optional(),
  reviewCycleDays: z.number().int().positive().max(3650).optional().nullable(),
  blocks: blocksSchema.optional(),
  meta: sopMetaSchema.partial().optional(),
});
export type UpdateSopDraftInput = z.infer<typeof updateSopDraftInputSchema>;

export async function updateSopDraft(actor: Actor, sopId: string, input: UpdateSopDraftInput) {
  ensure(actor, "sop.create");
  const parsed = updateSopDraftInputSchema.parse(input);

  const sop = await prisma.sop.findUnique({ where: { id: sopId }, select: { id: true, isDeleted: true, status: true, draftMeta: true } });
  if (!sop || sop.isDeleted) throw new SopValidationError("That SOP no longer exists.");
  if (sop.status === "ARCHIVED") throw new SopValidationError("Unarchive this SOP before editing it.");

  const mergedMeta: SopMeta = parsed.meta ? { ...parseMeta(sop.draftMeta), ...parsed.meta } : parseMeta(sop.draftMeta);
  const contentChanged = parsed.blocks !== undefined || parsed.meta !== undefined || parsed.title !== undefined;
  const revertsToDraft = contentChanged && (sop.status === "IN_REVIEW" || sop.status === "CHANGES_REQUESTED" || sop.status === "APPROVED");

  const updated = await prisma.sop.update({
    where: { id: sopId },
    data: {
      ...(parsed.title !== undefined ? { title: parsed.title } : {}),
      ...(parsed.summary !== undefined ? { summary: parsed.summary } : {}),
      ...(parsed.category !== undefined ? { category: parsed.category } : {}),
      ...(parsed.departmentId !== undefined ? { departmentId: parsed.departmentId } : {}),
      ...(parsed.businessUnitId !== undefined ? { businessUnitId: parsed.businessUnitId } : {}),
      ...(parsed.ownerId !== undefined ? { ownerId: parsed.ownerId } : {}),
      ...(parsed.smeId !== undefined ? { smeId: parsed.smeId } : {}),
      ...(parsed.reviewerId !== undefined ? { reviewerId: parsed.reviewerId } : {}),
      ...(parsed.approverId !== undefined ? { approverId: parsed.approverId } : {}),
      ...(parsed.language !== undefined ? { language: parsed.language } : {}),
      ...(parsed.reviewCycleDays !== undefined ? { reviewCycleDays: parsed.reviewCycleDays } : {}),
      ...(parsed.blocks !== undefined ? { draftBlocks: toJson(parsed.blocks) } : {}),
      ...(parsed.meta !== undefined ? { draftMeta: toJson(mergedMeta) } : {}),
      ...(revertsToDraft ? { status: "DRAFT" as ContentStatus } : {}),
    },
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.SOP_UPDATED,
    entityType: "SOP",
    entityId: sopId,
    metadata: { fields: Object.keys(parsed) },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// 3. publishSop
// ---------------------------------------------------------------------------

export const publishSopInputSchema = z.object({
  changeSummary: z.string().trim().max(1000).optional(),
  isMaterial: z.boolean().default(true),
});
export type PublishSopInput = z.infer<typeof publishSopInputSchema>;

function computeNextVersion(current: string | null, isMaterial: boolean): string {
  if (!current) return "1.0";
  const match = /^(\d+)\.(\d+)$/.exec(current);
  const major = match?.[1] ? Number(match[1]) : 1;
  const minor = match?.[2] ? Number(match[2]) : 0;
  return isMaterial ? `${major + 1}.0` : `${major}.${minor + 1}`;
}

export async function publishSop(actor: Actor, sopId: string, input: PublishSopInput) {
  ensure(actor, "sop.publish");
  const parsed = publishSopInputSchema.parse(input);

  const sop = await prisma.sop.findUnique({
    where: { id: sopId },
    include: { currentVersion: { select: { versionNumber: true } } },
  });
  if (!sop || sop.isDeleted) throw new SopValidationError("That SOP no longer exists.");

  const blocksResult = blocksSchema.safeParse(sop.draftBlocks ?? []);
  if (!blocksResult.success) {
    throw new SopValidationError("The draft has invalid content. Open the editor and fix validation errors before publishing.");
  }
  const blocks = blocksResult.data;
  if (blocks.length === 0) {
    throw new SopValidationError("Add at least one content block before publishing.");
  }
  const missingAlt = blocks.some((block) => block.type === "image" && block.altText.trim().length === 0);
  if (missingAlt) {
    throw new SopValidationError("Every image needs alt text before you can publish.");
  }

  const meta = parseMeta(sop.draftMeta);
  const settings = await getSettings();
  const reviewCycleDays = sop.reviewCycleDays ?? settings.training.defaultReviewCycleDays;
  const versionNumber = computeNextVersion(sop.currentVersion?.versionNumber ?? null, parsed.isMaterial);
  const now = new Date();

  const version = await prisma.$transaction(async (tx) => {
    const created = await tx.sopVersion.create({
      data: {
        sopId,
        versionNumber,
        title: sop.title,
        blocks: toJson(blocks),
        meta: toJson(meta),
        changeSummary: parsed.changeSummary || null,
        isMaterial: parsed.isMaterial,
        authorId: actor.id,
        reviewerId: sop.reviewerId,
        approverId: sop.approverId,
        publishedAt: now,
      },
    });

    await tx.sop.update({
      where: { id: sopId },
      data: {
        currentVersionId: created.id,
        status: "PUBLISHED",
        lastReviewedAt: now,
        nextReviewAt: daysFromNow(reviewCycleDays),
      },
    });

    return created;
  });

  await enqueueJob(JOB_TYPES.INDEX_CONTENT, { entityType: "SOP", entityId: sopId, versionId: version.id });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.SOP_PUBLISHED,
    entityType: "SOP",
    entityId: sopId,
    metadata: { versionNumber, isMaterial: parsed.isMaterial },
  });

  return version;
}

// ---------------------------------------------------------------------------
// 4. getSopForReader
// ---------------------------------------------------------------------------

export interface SopReaderResult {
  id: string;
  sopCode: string;
  kind: "SOP" | "POLICY";
  title: string;
  summary: string | null;
  category: string | null;
  status: ContentStatus;
  language: string;
  blocks: Block[];
  meta: SopMeta;
  versionNumber: string;
  isDraft: boolean;
  publishedAt: Date | null;
  lastReviewedAt: Date | null;
  nextReviewAt: Date | null;
  departmentName: string | null;
  owner: PersonRef | null;
  sme: PersonRef | null;
  reviewer: PersonRef | null;
  approver: PersonRef | null;
}

export async function getSopForReader(actor: Actor, sopId: string): Promise<SopReaderResult | null> {
  if (!actor.permissions.has("sop.view")) return null;

  const sop = await prisma.sop.findUnique({
    where: { id: sopId },
    include: { currentVersion: true },
  });
  if (!sop || sop.isDeleted) return null;

  const canSeeDraft = actor.permissions.has("sop.create");
  let blocks: Block[];
  let meta: SopMeta;
  let versionNumber: string;
  let isDraft: boolean;

  if (sop.status === "PUBLISHED" && sop.currentVersion) {
    blocks = parseBlocks(sop.currentVersion.blocks);
    meta = parseMeta(sop.currentVersion.meta);
    versionNumber = sop.currentVersion.versionNumber;
    isDraft = false;
  } else if (canSeeDraft) {
    blocks = parseBlocks(sop.draftBlocks);
    meta = parseMeta(sop.draftMeta);
    versionNumber = "Draft";
    isDraft = true;
  } else {
    return null;
  }

  const [names, departmentNames] = await Promise.all([
    resolveUserNames([sop.ownerId, sop.smeId, sop.reviewerId, sop.approverId]),
    resolveDepartmentNames([sop.departmentId]),
  ]);

  await prisma.contentView.create({
    data: { userId: actor.id, entityType: "SOP", entityId: sopId },
  });

  return {
    id: sop.id,
    sopCode: sop.sopCode,
    kind: sop.kind,
    title: sop.title,
    summary: sop.summary,
    category: sop.category,
    status: sop.status,
    language: sop.language,
    blocks,
    meta,
    versionNumber,
    isDraft,
    publishedAt: sop.currentVersion?.publishedAt ?? null,
    lastReviewedAt: sop.lastReviewedAt,
    nextReviewAt: sop.nextReviewAt,
    departmentName: sop.departmentId ? (departmentNames.get(sop.departmentId) ?? null) : null,
    owner: sop.ownerId ? (names.get(sop.ownerId) ?? null) : null,
    sme: sop.smeId ? (names.get(sop.smeId) ?? null) : null,
    reviewer: sop.reviewerId ? (names.get(sop.reviewerId) ?? null) : null,
    approver: sop.approverId ? (names.get(sop.approverId) ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// 5. restoreSopVersion
// ---------------------------------------------------------------------------

export async function restoreSopVersion(actor: Actor, sopId: string, versionId: string) {
  ensure(actor, "sop.create");

  const version = await prisma.sopVersion.findUnique({ where: { id: versionId } });
  if (!version || version.sopId !== sopId) throw new SopValidationError("That version could not be found.");

  const sop = await prisma.sop.findUnique({ where: { id: sopId }, select: { status: true, isDeleted: true } });
  if (!sop || sop.isDeleted) throw new SopValidationError("That SOP no longer exists.");

  const updated = await prisma.sop.update({
    where: { id: sopId },
    data: {
      title: version.title,
      draftBlocks: toJson(parseBlocks(version.blocks)),
      draftMeta: toJson(parseMeta(version.meta)),
      status: sop.status === "DRAFT" ? "DRAFT" : "DRAFT",
    },
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.SOP_VERSION_RESTORED,
    entityType: "SOP",
    entityId: sopId,
    metadata: { restoredFromVersionId: versionId, restoredFromVersionNumber: version.versionNumber },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// 6. compareVersions
// ---------------------------------------------------------------------------

export interface VersionSummary {
  id: string;
  versionNumber: string;
  publishedAt: Date;
  authorId: string;
  author: PersonRef | null;
}

export interface VersionDiff {
  versionA: VersionSummary;
  versionB: VersionSummary;
  added: { blockId: string; afterText: string }[];
  removed: { blockId: string; beforeText: string }[];
  changed: { blockId: string; beforeText: string; afterText: string }[];
  unchangedCount: number;
}

export async function compareVersions(sopId: string, versionAId: string, versionBId: string): Promise<VersionDiff> {
  const [versionA, versionB] = await Promise.all([
    prisma.sopVersion.findUnique({ where: { id: versionAId } }),
    prisma.sopVersion.findUnique({ where: { id: versionBId } }),
  ]);
  if (!versionA || versionA.sopId !== sopId) throw new SopValidationError("The first version could not be found.");
  if (!versionB || versionB.sopId !== sopId) throw new SopValidationError("The second version could not be found.");

  const blocksA = parseBlocks(versionA.blocks);
  const blocksB = parseBlocks(versionB.blocks);
  const mapA = new Map(blocksA.map((block) => [block.id, block]));
  const mapB = new Map(blocksB.map((block) => [block.id, block]));

  const added: VersionDiff["added"] = [];
  const removed: VersionDiff["removed"] = [];
  const changed: VersionDiff["changed"] = [];
  let unchangedCount = 0;

  for (const [id, blockA] of mapA) {
    const blockB = mapB.get(id);
    if (!blockB) {
      removed.push({ blockId: id, beforeText: blocksToPlainText([blockA]) });
    } else if (JSON.stringify(blockA) !== JSON.stringify(blockB)) {
      changed.push({ blockId: id, beforeText: blocksToPlainText([blockA]), afterText: blocksToPlainText([blockB]) });
    } else {
      unchangedCount += 1;
    }
  }
  for (const [id, blockB] of mapB) {
    if (!mapA.has(id)) added.push({ blockId: id, afterText: blocksToPlainText([blockB]) });
  }

  const names = await resolveUserNames([versionA.authorId, versionB.authorId]);

  return {
    versionA: {
      id: versionA.id,
      versionNumber: versionA.versionNumber,
      publishedAt: versionA.publishedAt,
      authorId: versionA.authorId,
      author: names.get(versionA.authorId) ?? null,
    },
    versionB: {
      id: versionB.id,
      versionNumber: versionB.versionNumber,
      publishedAt: versionB.publishedAt,
      authorId: versionB.authorId,
      author: names.get(versionB.authorId) ?? null,
    },
    added,
    removed,
    changed,
    unchangedCount,
  };
}

/** All published versions of a SOP, newest first — used by the versions/history page. */
export async function listSopVersions(sopId: string) {
  const versions = await prisma.sopVersion.findMany({
    where: { sopId },
    orderBy: { publishedAt: "desc" },
    select: {
      id: true,
      versionNumber: true,
      changeSummary: true,
      isMaterial: true,
      authorId: true,
      reviewerId: true,
      approverId: true,
      publishedAt: true,
    },
  });
  const names = await resolveUserNames(versions.flatMap((v) => [v.authorId, v.reviewerId, v.approverId]));
  return versions.map((v) => ({
    ...v,
    author: names.get(v.authorId) ?? null,
    reviewer: v.reviewerId ? (names.get(v.reviewerId) ?? null) : null,
    approver: v.approverId ? (names.get(v.approverId) ?? null) : null,
  }));
}

// ---------------------------------------------------------------------------
// 7. analyzeChangeImpact
// ---------------------------------------------------------------------------

export interface ImpactedEntity {
  id: string;
  title: string;
  status: string;
}

export interface ChangeImpact {
  courses: ImpactedEntity[];
  paths: ImpactedEntity[];
  userCount: number;
  certificationCount: number;
}

export async function analyzeChangeImpact(actor: Actor, sopId: string): Promise<ChangeImpact> {
  ensureAny(actor, ["sop.publish", "sop.create"]);

  const sopRefLessons = await prisma.lesson.findMany({
    where: { type: "SOP_REF", content: { path: ["sopId"], equals: sopId } },
    select: { section: { select: { course: { select: { id: true, title: true, status: true } } } } },
  });

  const courseMap = new Map<string, ImpactedEntity>();
  for (const lesson of sopRefLessons) {
    const course = lesson.section.course;
    courseMap.set(course.id, course);
  }

  const courseRelations = await prisma.contentRelationship.findMany({
    where: { toEntityType: "SOP", toEntityId: sopId, fromEntityType: "COURSE" },
    select: { fromEntityId: true },
  });
  const extraCourseIds = courseRelations.map((r) => r.fromEntityId).filter((id) => !courseMap.has(id));
  if (extraCourseIds.length > 0) {
    const extraCourses = await prisma.course.findMany({
      where: { id: { in: extraCourseIds } },
      select: { id: true, title: true, status: true },
    });
    for (const course of extraCourses) courseMap.set(course.id, course);
  }

  const pathItems = await prisma.learningPathItem.findMany({
    where: { sopId },
    select: { path: { select: { id: true, title: true, status: true } } },
  });
  const pathMap = new Map<string, ImpactedEntity>();
  for (const item of pathItems) pathMap.set(item.path.id, item.path);

  const pathRelations = await prisma.contentRelationship.findMany({
    where: { toEntityType: "SOP", toEntityId: sopId, fromEntityType: "LEARNING_PATH" },
    select: { fromEntityId: true },
  });
  const extraPathIds = pathRelations.map((r) => r.fromEntityId).filter((id) => !pathMap.has(id));
  if (extraPathIds.length > 0) {
    const extraPaths = await prisma.learningPath.findMany({
      where: { id: { in: extraPathIds } },
      select: { id: true, title: true, status: true },
    });
    for (const path of extraPaths) pathMap.set(path.id, path);
  }

  const versionIds = await prisma.sopVersion.findMany({ where: { sopId }, select: { id: true } });
  const userCount =
    versionIds.length === 0
      ? 0
      : (
          await prisma.acknowledgement.findMany({
            where: { sopVersionId: { in: versionIds.map((v) => v.id) } },
            select: { userId: true },
            distinct: ["userId"],
          })
        ).length;

  const courseIds = [...courseMap.keys()];
  const certificationCount =
    courseIds.length === 0
      ? 0
      : await prisma.certificate.count({ where: { courseId: { in: courseIds }, revokedAt: null } });

  return {
    courses: [...courseMap.values()],
    paths: [...pathMap.values()],
    userCount,
    certificationCount,
  };
}

/** The actual users targeted by a retraining decision: those who acknowledged an older version. */
async function getImpactedUserIds(sopId: string): Promise<string[]> {
  const versionIds = await prisma.sopVersion.findMany({ where: { sopId }, select: { id: true } });
  if (versionIds.length === 0) return [];
  const rows = await prisma.acknowledgement.findMany({
    where: { sopVersionId: { in: versionIds.map((v) => v.id) } },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.map((r) => r.userId);
}

// ---------------------------------------------------------------------------
// 8. applyRetrainingDecision
// ---------------------------------------------------------------------------

export const retrainingDecisionSchema = z.object({
  decision: z.enum(["NONE", "ACKNOWLEDGE", "LESSON", "FULL_COURSE", "NOTIFY_ONLY"]),
  /** Existing course to attach the assignment to, for LESSON / FULL_COURSE. Courses are owned by the training module. */
  courseId: z.string().optional(),
  dueDays: z.number().int().positive().max(365).default(14),
});
export type RetrainingDecisionInput = z.infer<typeof retrainingDecisionSchema>;

export interface RetrainingDecisionResult {
  decision: RetrainingDecisionInput["decision"];
  affectedUserCount: number;
  assignmentsCreated: number;
  notificationsSent: number;
}

export async function applyRetrainingDecision(
  actor: Actor,
  sopId: string,
  decision: RetrainingDecisionInput,
): Promise<RetrainingDecisionResult> {
  ensure(actor, "training.assign");
  const parsed = retrainingDecisionSchema.parse(decision);

  const sop = await prisma.sop.findUnique({ where: { id: sopId }, select: { title: true, isDeleted: true } });
  if (!sop || sop.isDeleted) throw new SopValidationError("That SOP no longer exists.");

  const impactedUserIds = await getImpactedUserIds(sopId);
  const dueAt = daysFromNow(parsed.dueDays);
  let assignmentsCreated = 0;
  let notificationsSent = 0;

  if (parsed.decision === "NONE") {
    // Explicit no-op — still recorded so the decision is auditable.
  } else if (parsed.decision === "NOTIFY_ONLY") {
    if (impactedUserIds.length > 0) {
      await notifyMany(
        impactedUserIds.map((userId) => ({
          userId,
          type: "SOP_CHANGED",
          title: `SOP updated: ${sop.title}`,
          body: "This procedure changed. Review the latest version when you have a moment.",
          linkUrl: `/sops/${sopId}`,
          dedupeKey: `sop-changed:${sopId}`,
        })),
      );
      notificationsSent = impactedUserIds.length;
    }
  } else if (parsed.decision === "ACKNOWLEDGE") {
    if (impactedUserIds.length > 0) {
      const existing = await prisma.assignment.findMany({
        where: { userId: { in: impactedUserIds }, targetType: "SOP", sopId, courseId: null, pathId: null },
        select: { userId: true },
      });
      const already = new Set(existing.map((a) => a.userId));
      const toCreate = impactedUserIds.filter((id) => !already.has(id));
      if (toCreate.length > 0) {
        const created = await prisma.assignment.createMany({
          data: toCreate.map((userId) => ({
            userId,
            targetType: "SOP" as const,
            sopId,
            status: "ASSIGNED" as const,
            source: "RECERTIFICATION" as const,
            reason: `SOP updated — re-acknowledgement required: ${sop.title}`,
            assignedById: actor.id,
            dueAt,
          })),
        });
        assignmentsCreated = created.count;
      }
      await notifyMany(
        impactedUserIds.map((userId) => ({
          userId,
          type: "REACK_REQUIRED",
          title: `Please re-acknowledge: ${sop.title}`,
          body: "This procedure changed and needs your acknowledgement again.",
          linkUrl: `/sops/${sopId}`,
          dedupeKey: `sop-reack:${sopId}`,
        })),
      );
      notificationsSent = impactedUserIds.length;
    }
  } else if (parsed.decision === "LESSON" || parsed.decision === "FULL_COURSE") {
    const label = parsed.decision === "LESSON" ? "refresher lesson" : "full course";
    if (parsed.courseId && impactedUserIds.length > 0) {
      const existing = await prisma.assignment.findMany({
        where: { userId: { in: impactedUserIds }, targetType: "COURSE", courseId: parsed.courseId },
        select: { userId: true },
      });
      const already = new Set(existing.map((a) => a.userId));
      const toCreate = impactedUserIds.filter((id) => !already.has(id));
      if (toCreate.length > 0) {
        const created = await prisma.assignment.createMany({
          data: toCreate.map((userId) => ({
            userId,
            targetType: "COURSE" as const,
            courseId: parsed.courseId,
            status: "ASSIGNED" as const,
            source: "RECERTIFICATION" as const,
            reason: `SOP updated — ${label} required: ${sop.title}`,
            assignedById: actor.id,
            dueAt,
          })),
        });
        assignmentsCreated = created.count;
      }
      await notifyMany(
        impactedUserIds.map((userId) => ({
          userId,
          type: "TRAINING_ASSIGNED",
          title: `New training assigned: ${sop.title} update`,
          body: `Complete the ${label} to stay current on this procedure.`,
          linkUrl: `/my-training`,
          dedupeKey: `sop-retrain:${sopId}`,
        })),
      );
      notificationsSent = impactedUserIds.length;
    } else if (impactedUserIds.length > 0) {
      // No course selected yet — surface the need without an assignment target.
      await notifyMany(
        impactedUserIds.map((userId) => ({
          userId,
          type: "SOP_CHANGED",
          title: `SOP updated: ${sop.title}`,
          body: `A ${label} covering this update is being prepared. You'll be assigned once it's ready.`,
          linkUrl: `/sops/${sopId}`,
          dedupeKey: `sop-retrain-pending:${sopId}`,
        })),
      );
      notificationsSent = impactedUserIds.length;
    }
  }

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "sop.retraining_decision",
    entityType: "SOP",
    entityId: sopId,
    metadata: { decision: parsed.decision, courseId: parsed.courseId ?? null, affectedUserCount: impactedUserIds.length },
  });

  return { decision: parsed.decision, affectedUserCount: impactedUserIds.length, assignmentsCreated, notificationsSent };
}

// ---------------------------------------------------------------------------
// 9 / 10. Outdated reports
// ---------------------------------------------------------------------------

export async function reportOutdated(actor: Actor, sopId: string, reason: string) {
  ensure(actor, "sop.view");
  const trimmed = reason.trim();
  if (trimmed.length === 0) throw new SopValidationError("Describe what looks outdated.");

  const sop = await prisma.sop.findUnique({ where: { id: sopId }, select: { title: true, ownerId: true, isDeleted: true } });
  if (!sop || sop.isDeleted) throw new SopValidationError("That SOP no longer exists.");

  const report = await prisma.outdatedReport.create({
    data: { sopId, reporterId: actor.id, reason: trimmed },
  });

  if (sop.ownerId) {
    await notify({
      userId: sop.ownerId,
      type: "CONTENT_REVIEW_DUE",
      title: `Outdated report: ${sop.title}`,
      body: trimmed,
      linkUrl: `/admin/sops/${sopId}/edit`,
    });
  }

  return report;
}

export async function resolveOutdatedReport(actor: Actor, reportId: string, status: "RESOLVED" | "DISMISSED") {
  ensure(actor, "sop.create");

  const report = await prisma.outdatedReport.findUnique({ where: { id: reportId } });
  if (!report) throw new SopValidationError("That report could not be found.");

  const updated = await prisma.outdatedReport.update({
    where: { id: reportId },
    data: { status, resolvedAt: new Date(), resolvedBy: actor.id },
  });

  await notify({
    userId: report.reporterId,
    type: "SYSTEM",
    title: status === "RESOLVED" ? "Your outdated report was resolved" : "Your outdated report was reviewed",
    linkUrl: `/sops/${report.sopId}`,
    inAppOnly: true,
  });

  return updated;
}

export async function listOutdatedReports(sopId: string) {
  const reports = await prisma.outdatedReport.findMany({ where: { sopId }, orderBy: { createdAt: "desc" } });
  const names = await resolveUserNames(reports.map((r) => r.reporterId));
  return reports.map((r) => ({ ...r, reporter: names.get(r.reporterId) ?? null }));
}

// ---------------------------------------------------------------------------
// 11-13. Approval workflow
// ---------------------------------------------------------------------------

export async function submitForReview(
  actor: Actor,
  sopId: string,
  input: { assignedToId?: string; stage?: string; comment?: string },
) {
  ensure(actor, "sop.create");

  const sop = await prisma.sop.findUnique({
    where: { id: sopId },
    select: { title: true, isDeleted: true, smeId: true, reviewerId: true, approverId: true },
  });
  if (!sop || sop.isDeleted) throw new SopValidationError("That SOP no longer exists.");

  const stage = input.stage || "SME_REVIEW";
  const assignedToId = input.assignedToId || sop.reviewerId || sop.smeId || sop.approverId || null;

  const [request] = await prisma.$transaction([
    prisma.approvalRequest.create({
      data: {
        entityType: "SOP",
        entityId: sopId,
        stage,
        requestedById: actor.id,
        assignedToId,
        status: "PENDING",
        comment: input.comment || null,
      },
    }),
    prisma.sop.update({ where: { id: sopId }, data: { status: "IN_REVIEW" } }),
  ]);

  if (assignedToId) {
    await notify({
      userId: assignedToId,
      type: "REVIEW_REQUESTED",
      title: `Review requested: ${sop.title}`,
      body: input.comment || undefined,
      linkUrl: `/admin/sops/${sopId}/edit`,
    });
  }

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "sop.review_submitted",
    entityType: "SOP",
    entityId: sopId,
    metadata: { stage, assignedToId },
  });

  return request;
}

export async function approveSop(actor: Actor, sopId: string, input: { approvalRequestId?: string; comment?: string }) {
  ensure(actor, "sop.approve");

  const sop = await prisma.sop.findUnique({ where: { id: sopId }, select: { title: true, createdById: true, isDeleted: true } });
  if (!sop || sop.isDeleted) throw new SopValidationError("That SOP no longer exists.");

  const request = input.approvalRequestId
    ? await prisma.approvalRequest.findUnique({ where: { id: input.approvalRequestId } })
    : await prisma.approvalRequest.findFirst({
        where: { entityType: "SOP", entityId: sopId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      });

  if (request) {
    await prisma.approvalRequest.update({
      where: { id: request.id },
      data: { status: "APPROVED", decidedAt: new Date(), decidedById: actor.id, comment: input.comment || request.comment },
    });
  }

  const updated = await prisma.sop.update({ where: { id: sopId }, data: { status: "APPROVED" } });

  await notify({
    userId: sop.createdById,
    type: "SYSTEM",
    title: `Approved: ${sop.title}`,
    body: input.comment || "Ready to publish.",
    linkUrl: `/admin/sops/${sopId}/edit`,
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.SOP_APPROVED,
    entityType: "SOP",
    entityId: sopId,
    metadata: { approvalRequestId: request?.id ?? null },
  });

  return updated;
}

export async function requestChanges(actor: Actor, sopId: string, input: { approvalRequestId?: string; comment: string }) {
  ensureAny(actor, ["sop.approve", "content.review"]);
  const comment = input.comment.trim();
  if (comment.length === 0) throw new SopValidationError("Explain what needs to change.");

  const sop = await prisma.sop.findUnique({ where: { id: sopId }, select: { title: true, createdById: true, isDeleted: true } });
  if (!sop || sop.isDeleted) throw new SopValidationError("That SOP no longer exists.");

  const request = input.approvalRequestId
    ? await prisma.approvalRequest.findUnique({ where: { id: input.approvalRequestId } })
    : await prisma.approvalRequest.findFirst({
        where: { entityType: "SOP", entityId: sopId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      });

  if (request) {
    await prisma.approvalRequest.update({
      where: { id: request.id },
      data: { status: "CHANGES_REQUESTED", decidedAt: new Date(), decidedById: actor.id, comment },
    });
  }

  const updated = await prisma.sop.update({ where: { id: sopId }, data: { status: "CHANGES_REQUESTED" } });

  await notify({
    userId: sop.createdById,
    type: "REVIEW_REQUESTED",
    title: `Changes requested: ${sop.title}`,
    body: comment,
    linkUrl: `/admin/sops/${sopId}/edit`,
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "sop.changes_requested",
    entityType: "SOP",
    entityId: sopId,
    metadata: { approvalRequestId: request?.id ?? null },
  });

  return updated;
}

export async function listApprovalHistory(sopId: string) {
  const requests = await prisma.approvalRequest.findMany({
    where: { entityType: "SOP", entityId: sopId },
    orderBy: { createdAt: "desc" },
  });
  const names = await resolveUserNames(requests.flatMap((r) => [r.requestedById, r.assignedToId, r.decidedById]));
  return requests.map((r) => ({
    ...r,
    requestedBy: names.get(r.requestedById) ?? null,
    assignedTo: r.assignedToId ? (names.get(r.assignedToId) ?? null) : null,
    decidedBy: r.decidedById ? (names.get(r.decidedById) ?? null) : null,
  }));
}

// ---------------------------------------------------------------------------
// 14. getReviewDashboardData
// ---------------------------------------------------------------------------

export interface ReviewBucketItem {
  id: string;
  sopCode: string;
  title: string;
  status: ContentStatus;
  ownerId: string | null;
  ownerName: string | null;
  nextReviewAt: Date | null;
  lastReviewedAt: Date | null;
  updatedAt: Date;
  openReportCount: number;
}

export interface ReviewBucket {
  count: number;
  items: ReviewBucketItem[];
}

export interface ReviewDashboardData {
  current: ReviewBucket;
  dueForReview: ReviewBucket;
  overdue: ReviewBucket;
  recentlyModified: ReviewBucket;
  withoutOwners: ReviewBucket;
  neverReviewed: ReviewBucket;
  frequentlyReported: ReviewBucket;
}

const DASHBOARD_SELECT = {
  id: true,
  sopCode: true,
  title: true,
  status: true,
  ownerId: true,
  nextReviewAt: true,
  lastReviewedAt: true,
  updatedAt: true,
} as const;

const BUCKET_LIMIT = 25;

export async function getReviewDashboardData(actor: Actor): Promise<ReviewDashboardData> {
  ensureAny(actor, ["sop.approve", "sop.publish", "sop.create"]);

  const now = new Date();
  const in30Days = daysFromNow(30);
  const in14DaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [overdueRows, overdueTotal, dueRows, dueTotal, currentRows, currentTotal, recentRows, recentTotal, noOwnerRows, noOwnerTotal, neverReviewedRows, neverReviewedTotal, reportGroups] =
    await Promise.all([
      prisma.sop.findMany({ where: { isDeleted: false, status: "PUBLISHED", nextReviewAt: { lt: now } }, select: DASHBOARD_SELECT, orderBy: { nextReviewAt: "asc" }, take: BUCKET_LIMIT }),
      prisma.sop.count({ where: { isDeleted: false, status: "PUBLISHED", nextReviewAt: { lt: now } } }),
      prisma.sop.findMany({ where: { isDeleted: false, status: "PUBLISHED", nextReviewAt: { gte: now, lte: in30Days } }, select: DASHBOARD_SELECT, orderBy: { nextReviewAt: "asc" }, take: BUCKET_LIMIT }),
      prisma.sop.count({ where: { isDeleted: false, status: "PUBLISHED", nextReviewAt: { gte: now, lte: in30Days } } }),
      prisma.sop.findMany({ where: { isDeleted: false, status: "PUBLISHED", OR: [{ nextReviewAt: null }, { nextReviewAt: { gt: in30Days } }] }, select: DASHBOARD_SELECT, orderBy: { title: "asc" }, take: BUCKET_LIMIT }),
      prisma.sop.count({ where: { isDeleted: false, status: "PUBLISHED", OR: [{ nextReviewAt: null }, { nextReviewAt: { gt: in30Days } }] } }),
      prisma.sop.findMany({ where: { isDeleted: false, updatedAt: { gte: in14DaysAgo } }, select: DASHBOARD_SELECT, orderBy: { updatedAt: "desc" }, take: BUCKET_LIMIT }),
      prisma.sop.count({ where: { isDeleted: false, updatedAt: { gte: in14DaysAgo } } }),
      prisma.sop.findMany({ where: { isDeleted: false, ownerId: null }, select: DASHBOARD_SELECT, orderBy: { updatedAt: "desc" }, take: BUCKET_LIMIT }),
      prisma.sop.count({ where: { isDeleted: false, ownerId: null } }),
      prisma.sop.findMany({ where: { isDeleted: false, lastReviewedAt: null }, select: DASHBOARD_SELECT, orderBy: { createdAt: "desc" }, take: BUCKET_LIMIT }),
      prisma.sop.count({ where: { isDeleted: false, lastReviewedAt: null } }),
      prisma.outdatedReport.groupBy({ by: ["sopId"], where: { status: "OPEN" }, _count: { sopId: true }, having: { sopId: { _count: { gte: 2 } } } }),
    ]);

  const frequentlyReportedIds = reportGroups.map((g) => g.sopId);
  const openCountBySopId = new Map(reportGroups.map((g) => [g.sopId, g._count.sopId]));
  const frequentlyReportedRows =
    frequentlyReportedIds.length === 0
      ? []
      : await prisma.sop.findMany({ where: { id: { in: frequentlyReportedIds }, isDeleted: false }, select: DASHBOARD_SELECT, take: BUCKET_LIMIT });

  const allRows = [...overdueRows, ...dueRows, ...currentRows, ...recentRows, ...noOwnerRows, ...neverReviewedRows, ...frequentlyReportedRows];
  const ownerNames = await resolveUserNames(allRows.map((r) => r.ownerId));

  // Open report counts for every row shown (frequentlyReported already has its count).
  const otherIds = allRows.filter((r) => !openCountBySopId.has(r.id)).map((r) => r.id);
  if (otherIds.length > 0) {
    const groups = await prisma.outdatedReport.groupBy({ by: ["sopId"], where: { sopId: { in: otherIds }, status: "OPEN" }, _count: { sopId: true } });
    for (const g of groups) openCountBySopId.set(g.sopId, g._count.sopId);
  }

  function toItem(row: (typeof allRows)[number]): ReviewBucketItem {
    return {
      id: row.id,
      sopCode: row.sopCode,
      title: row.title,
      status: row.status,
      ownerId: row.ownerId,
      ownerName: row.ownerId ? (ownerNames.get(row.ownerId)?.name ?? null) : null,
      nextReviewAt: row.nextReviewAt,
      lastReviewedAt: row.lastReviewedAt,
      updatedAt: row.updatedAt,
      openReportCount: openCountBySopId.get(row.id) ?? 0,
    };
  }

  return {
    current: { count: currentTotal, items: currentRows.map(toItem) },
    dueForReview: { count: dueTotal, items: dueRows.map(toItem) },
    overdue: { count: overdueTotal, items: overdueRows.map(toItem) },
    recentlyModified: { count: recentTotal, items: recentRows.map(toItem) },
    withoutOwners: { count: noOwnerTotal, items: noOwnerRows.map(toItem) },
    neverReviewed: { count: neverReviewedTotal, items: neverReviewedRows.map(toItem) },
    frequentlyReported: { count: frequentlyReportedRows.length, items: frequentlyReportedRows.map(toItem) },
  };
}

// ---------------------------------------------------------------------------
// 15. computeContentHealthScore
// ---------------------------------------------------------------------------

export interface HealthFactor {
  label: string;
  met: boolean;
  weight: number;
  detail: string;
}

export interface HealthScoreResult {
  score: number;
  factors: HealthFactor[];
}

export interface SopHealthInput {
  ownerId: string | null;
  nextReviewAt: Date | null;
  openOutdatedReportCount: number;
  hasBeenPublished: boolean;
  purpose: string;
  scope: string;
  /** Average assessment score (0-100) across linked courses, or null when none exist. */
  linkedAssessmentAvgPercent: number | null;
}

/**
 * Pure scorer — always returns the full factor breakdown so the number is
 * never a black box. Weights sum to 100.
 */
export function computeContentHealthScore(input: SopHealthInput): HealthScoreResult {
  const now = Date.now();
  const factors: HealthFactor[] = [];

  factors.push({
    label: "Has an assigned owner",
    weight: 20,
    met: Boolean(input.ownerId),
    detail: input.ownerId ? "An owner is assigned." : "No owner is assigned.",
  });

  const reviewCurrent = Boolean(input.nextReviewAt && input.nextReviewAt.getTime() > now);
  factors.push({
    label: "Review is current",
    weight: 25,
    met: reviewCurrent,
    detail: !input.nextReviewAt
      ? "No review cycle is set."
      : reviewCurrent
        ? `Next review due ${input.nextReviewAt.toLocaleDateString()}.`
        : "The review date has passed.",
  });

  factors.push({
    label: "No open outdated reports",
    weight: 20,
    met: input.openOutdatedReportCount === 0,
    detail: input.openOutdatedReportCount === 0 ? "No open reports." : `${input.openOutdatedReportCount} open report(s).`,
  });

  factors.push({
    label: "Has been published",
    weight: 15,
    met: input.hasBeenPublished,
    detail: input.hasBeenPublished ? "At least one version is published." : "Never published.",
  });

  const metaFilled = input.purpose.trim().length > 0 && input.scope.trim().length > 0;
  factors.push({
    label: "Purpose and scope are documented",
    weight: 10,
    met: metaFilled,
    detail: metaFilled ? "Purpose and scope are filled in." : "Purpose or scope is missing.",
  });

  const assessmentOk = input.linkedAssessmentAvgPercent === null || input.linkedAssessmentAvgPercent >= 80;
  factors.push({
    label: "Linked assessment performance",
    weight: 10,
    met: assessmentOk,
    detail:
      input.linkedAssessmentAvgPercent === null
        ? "No linked course assessments to measure."
        : `Average score ${Math.round(input.linkedAssessmentAvgPercent)}%.`,
  });

  const score = factors.reduce((sum, factor) => sum + (factor.met ? factor.weight : 0), 0);
  return { score, factors };
}

/** Batch health inputs for the admin list — intentionally skips the (expensive) assessment lookup. */
export async function getSopHealthInputs(sopIds: string[]): Promise<Map<string, SopHealthInput>> {
  if (sopIds.length === 0) return new Map();
  const [sops, reportGroups] = await Promise.all([
    prisma.sop.findMany({
      where: { id: { in: sopIds } },
      select: { id: true, ownerId: true, nextReviewAt: true, currentVersionId: true, draftMeta: true },
    }),
    prisma.outdatedReport.groupBy({ by: ["sopId"], where: { sopId: { in: sopIds }, status: "OPEN" }, _count: { sopId: true } }),
  ]);
  const reportCounts = new Map(reportGroups.map((g) => [g.sopId, g._count.sopId]));

  const result = new Map<string, SopHealthInput>();
  for (const sop of sops) {
    const meta = parseMeta(sop.draftMeta);
    result.set(sop.id, {
      ownerId: sop.ownerId,
      nextReviewAt: sop.nextReviewAt,
      openOutdatedReportCount: reportCounts.get(sop.id) ?? 0,
      hasBeenPublished: Boolean(sop.currentVersionId),
      purpose: meta.purpose,
      scope: meta.scope,
      linkedAssessmentAvgPercent: null,
    });
  }
  return result;
}

/** Deeper single-SOP score including linked-course assessment performance — used on the edit/impact screens. */
export async function getSingleSopHealthScore(sopId: string): Promise<HealthScoreResult | null> {
  const sop = await prisma.sop.findUnique({
    where: { id: sopId },
    select: { id: true, ownerId: true, nextReviewAt: true, currentVersionId: true, draftMeta: true, isDeleted: true },
  });
  if (!sop || sop.isDeleted) return null;

  const openOutdatedReportCount = await prisma.outdatedReport.count({ where: { sopId, status: "OPEN" } });
  const meta = parseMeta(sop.draftMeta);

  const sopRefLessons = await prisma.lesson.findMany({
    where: { type: "SOP_REF", content: { path: ["sopId"], equals: sopId } },
    select: { section: { select: { courseId: true } } },
  });
  const courseIds = [...new Set(sopRefLessons.map((l) => l.section.courseId))];

  let linkedAssessmentAvgPercent: number | null = null;
  if (courseIds.length > 0) {
    const quizLessons = await prisma.lesson.findMany({
      where: { type: "QUIZ", section: { courseId: { in: courseIds } } },
      select: { id: true },
    });
    const quizLessonIds = quizLessons.map((l) => l.id);
    if (quizLessonIds.length > 0) {
      const agg = await prisma.quizAttempt.aggregate({
        where: { lessonId: { in: quizLessonIds }, status: { in: ["PASSED", "FAILED", "GRADED"] } },
        _avg: { scorePercent: true },
      });
      linkedAssessmentAvgPercent = agg._avg.scorePercent ?? null;
    }
  }

  return computeContentHealthScore({
    ownerId: sop.ownerId,
    nextReviewAt: sop.nextReviewAt,
    openOutdatedReportCount,
    hasBeenPublished: Boolean(sop.currentVersionId),
    purpose: meta.purpose,
    scope: meta.scope,
    linkedAssessmentAvgPercent,
  });
}

// ---------------------------------------------------------------------------
// Learner library listing
// ---------------------------------------------------------------------------

export interface SopLibraryFilters {
  q?: string;
  department?: string;
  category?: string;
  kind?: "SOP" | "POLICY";
  page?: number;
}

export interface SopLibraryItem {
  id: string;
  sopCode: string;
  kind: "SOP" | "POLICY";
  title: string;
  summary: string | null;
  category: string | null;
  departmentName: string | null;
  lastReviewedAt: Date | null;
  favorited: boolean;
}

export interface SopLibraryPage {
  items: SopLibraryItem[];
  total: number;
  page: number;
  pageSize: number;
}

const LIBRARY_PAGE_SIZE = 20;

export async function listSopsForLibrary(actor: Actor, filters: SopLibraryFilters): Promise<SopLibraryPage> {
  ensure(actor, "sop.view");
  const page = Math.max(1, filters.page ?? 1);
  const q = filters.q?.trim();

  const where: Prisma.SopWhereInput = {
    isDeleted: false,
    status: "PUBLISHED",
    ...(filters.department ? { departmentId: filters.department } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { sopCode: { contains: q, mode: "insensitive" } },
            { summary: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.sop.findMany({
      where,
      select: { id: true, sopCode: true, kind: true, title: true, summary: true, category: true, departmentId: true, lastReviewedAt: true },
      orderBy: { title: "asc" },
      skip: (page - 1) * LIBRARY_PAGE_SIZE,
      take: LIBRARY_PAGE_SIZE,
    }),
    prisma.sop.count({ where }),
  ]);

  const [departmentNames, favorites] = await Promise.all([
    resolveDepartmentNames(rows.map((r) => r.departmentId)),
    prisma.favorite.findMany({
      where: { userId: actor.id, entityType: "SOP", entityId: { in: rows.map((r) => r.id) } },
      select: { entityId: true },
    }),
  ]);
  const favoriteIds = new Set(favorites.map((f) => f.entityId));

  return {
    items: rows.map((r) => ({
      id: r.id,
      sopCode: r.sopCode,
      kind: r.kind,
      title: r.title,
      summary: r.summary,
      category: r.category,
      departmentName: r.departmentId ? (departmentNames.get(r.departmentId) ?? null) : null,
      lastReviewedAt: r.lastReviewedAt,
      favorited: favoriteIds.has(r.id),
    })),
    total,
    page,
    pageSize: LIBRARY_PAGE_SIZE,
  };
}

/** Distinct category values in use, for the library filter control. */
export async function listSopCategories(): Promise<string[]> {
  const rows = await prisma.sop.findMany({
    where: { isDeleted: false, status: "PUBLISHED", category: { not: null } },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });
  return rows.map((r) => r.category).filter((c): c is string => Boolean(c));
}

// ---------------------------------------------------------------------------
// Admin listing
// ---------------------------------------------------------------------------

export interface SopAdminFilters {
  status?: ContentStatus;
  ownerId?: string | "UNASSIGNED";
  q?: string;
  sort?: "title" | "updatedAt" | "nextReviewAt" | "status";
  direction?: "asc" | "desc";
  page?: number;
}

export interface SopAdminItem {
  id: string;
  sopCode: string;
  title: string;
  status: ContentStatus;
  category: string | null;
  ownerId: string | null;
  ownerName: string | null;
  updatedAt: Date;
  nextReviewAt: Date | null;
  health: HealthScoreResult;
}

export interface SopAdminPage {
  items: SopAdminItem[];
  total: number;
  page: number;
  pageSize: number;
}

const ADMIN_PAGE_SIZE = 20;

export async function listSopsForAdmin(actor: Actor, filters: SopAdminFilters): Promise<SopAdminPage> {
  ensureAny(actor, ["sop.create", "sop.approve", "sop.publish"]);
  const page = Math.max(1, filters.page ?? 1);
  const q = filters.q?.trim();
  const sort = filters.sort ?? "updatedAt";
  const direction = filters.direction ?? "desc";

  const where: Prisma.SopWhereInput = {
    isDeleted: false,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.ownerId === "UNASSIGNED" ? { ownerId: null } : filters.ownerId ? { ownerId: filters.ownerId } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { sopCode: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.sop.findMany({
      where,
      select: { id: true, sopCode: true, title: true, status: true, category: true, ownerId: true, updatedAt: true, nextReviewAt: true },
      orderBy: { [sort]: direction },
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
    }),
    prisma.sop.count({ where }),
  ]);

  const [ownerNames, healthInputs] = await Promise.all([
    resolveUserNames(rows.map((r) => r.ownerId)),
    getSopHealthInputs(rows.map((r) => r.id)),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      sopCode: r.sopCode,
      title: r.title,
      status: r.status,
      category: r.category,
      ownerId: r.ownerId,
      ownerName: r.ownerId ? (ownerNames.get(r.ownerId)?.name ?? null) : null,
      updatedAt: r.updatedAt,
      nextReviewAt: r.nextReviewAt,
      health: computeContentHealthScore(
        healthInputs.get(r.id) ?? {
          ownerId: r.ownerId,
          nextReviewAt: r.nextReviewAt,
          openOutdatedReportCount: 0,
          hasBeenPublished: r.status === "PUBLISHED",
          purpose: "",
          scope: "",
          linkedAssessmentAvgPercent: null,
        },
      ),
    })),
    total,
    page,
    pageSize: ADMIN_PAGE_SIZE,
  };
}

/** Full editable record for the SOP editor page. */
export async function getSopDetailForEdit(actor: Actor, sopId: string) {
  ensure(actor, "sop.create");
  const sop = await prisma.sop.findUnique({ where: { id: sopId }, include: { currentVersion: { select: { versionNumber: true } } } });
  if (!sop || sop.isDeleted) return null;

  return {
    ...sop,
    blocks: parseBlocks(sop.draftBlocks),
    meta: parseMeta(sop.draftMeta),
  };
}

/** Simple trigram-based similarity search for the "looks like a duplicate" warning on create. */
export async function findSimilarSopTitles(actor: Actor, title: string): Promise<{ id: string; title: string; sopCode: string; status: ContentStatus }[]> {
  ensure(actor, "sop.create");
  const term = title.trim();
  if (term.length < 3) return [];

  const rows = await prisma.$queryRaw<{ id: string; title: string; sopCode: string; status: ContentStatus }[]>`
    SELECT "id", "title", "sopCode", "status"
    FROM "Sop"
    WHERE "isDeleted" = false AND similarity("title", ${term}) > 0.3
    ORDER BY similarity("title", ${term}) DESC
    LIMIT 5
  `;
  return rows;
}

export async function bulkArchiveSops(actor: Actor, sopIds: string[]): Promise<number> {
  ensure(actor, "sop.archive");
  if (sopIds.length === 0) return 0;
  const result = await prisma.sop.updateMany({ where: { id: { in: sopIds }, isDeleted: false }, data: { status: "ARCHIVED" } });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.SOP_ARCHIVED,
    entityType: "SOP",
    metadata: { sopIds, count: result.count },
  });
  return result.count;
}

export async function bulkAssignOwner(actor: Actor, sopIds: string[], ownerId: string): Promise<number> {
  ensure(actor, "sop.create");
  if (sopIds.length === 0) return 0;
  const result = await prisma.sop.updateMany({ where: { id: { in: sopIds }, isDeleted: false }, data: { ownerId } });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.SOP_UPDATED,
    entityType: "SOP",
    metadata: { sopIds, ownerId, bulk: true },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// Favorites & feedback (reader page interactions)
// ---------------------------------------------------------------------------

export async function toggleFavorite(actor: Actor, sopId: string): Promise<boolean> {
  const existing = await prisma.favorite.findUnique({
    where: { userId_entityType_entityId: { userId: actor.id, entityType: "SOP", entityId: sopId } },
  });
  if (existing) {
    await prisma.favorite.delete({
      where: { userId_entityType_entityId: { userId: actor.id, entityType: "SOP", entityId: sopId } },
    });
    return false;
  }
  await prisma.favorite.create({ data: { userId: actor.id, entityType: "SOP", entityId: sopId } });
  return true;
}

export const feedbackTypeSchema = z.enum(["HELPFUL", "NOT_CLEAR", "OUTDATED", "QUESTION"]);

export async function submitContentFeedback(
  actor: Actor,
  sopId: string,
  type: z.infer<typeof feedbackTypeSchema>,
  comment?: string,
) {
  ensure(actor, "sop.view");
  const parsedType = feedbackTypeSchema.parse(type);
  return prisma.contentFeedback.create({
    data: { entityType: "SOP", entityId: sopId, userId: actor.id, type: parsedType, comment: comment?.trim() || null },
  });
}

// ---------------------------------------------------------------------------
// Background job: SOP review reminders (src/worker/index.ts dispatches
// JOB_TYPES.SOP_REVIEW_REMINDERS here on a daily schedule).
// ---------------------------------------------------------------------------

export async function handleSopReviewRemindersJob(_payload: Record<string, unknown>): Promise<void> {
  const now = new Date();
  const settings = await getSettings();
  const lookaheadDays = Math.max(...settings.training.reminderDaysBefore, 7);

  const dueOrOverdue = await prisma.sop.findMany({
    where: { isDeleted: false, status: "PUBLISHED", ownerId: { not: null }, nextReviewAt: { lte: daysFromNow(lookaheadDays) } },
    select: { id: true, title: true, ownerId: true, nextReviewAt: true },
  });

  const inputs = dueOrOverdue
    .filter((sop): sop is typeof sop & { ownerId: string } => Boolean(sop.ownerId))
    .map((sop) => ({
      userId: sop.ownerId,
      type: "CONTENT_REVIEW_DUE" as const,
      title: sop.nextReviewAt && sop.nextReviewAt < now ? `Review overdue: ${sop.title}` : `Review due soon: ${sop.title}`,
      linkUrl: `/admin/sops/${sop.id}/edit`,
      dedupeKey: `sop-review:${sop.id}`,
    }));

  if (inputs.length > 0) await notifyMany(inputs);
}
