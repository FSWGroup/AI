import "server-only";
import { z } from "zod";
import type { NearMissCategory, NearMissSeverity, NearMissStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AuthorizationError, type Actor } from "@/lib/auth/guard";
import type { Permission } from "@/lib/permissions";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import {
  findIdentifiers,
  hasBlockingIdentifiers,
  summarizeBlocking,
  type IdentifierFinding,
} from "@/lib/services/near-miss-redaction";

/**
 * The near-miss library: what nearly went wrong, and what changed because of it.
 *
 * Most of what an organization knows about how work actually fails is held by
 * the people it happened to, and it leaves when they do. Formal training
 * teaches the correct procedure; it rarely teaches the eleven ways the correct
 * procedure gets skipped on a busy Thursday. This turns those events into
 * teaching material.
 *
 * Three properties the code, not the policy, has to guarantee:
 *
 *  1. **Blameless.** There is no field anywhere in this model for whose fault
 *     it was. Before publication the narrative is scanned for names, contact
 *     details and blame language (see near-miss-redaction.ts), and blocking
 *     findings refuse the publish outright.
 *  2. **Anonymous when asked.** `reportedById` is null for an anonymous report,
 *     the audit row is written without an actor, and no published read path
 *     selects the column at all — see `PUBLISHED_SELECT`, which is the only
 *     shape the library and detail pages ever see.
 *  3. **Unpublished means reviewer-only.** A report sits in a review queue
 *     behind `nearmiss.review` until a human publishes it. `nearmiss.view`
 *     never reaches a REPORTED or UNDER_REVIEW row.
 *
 * The library is also part of the retrieval corpus once published (see
 * src/lib/ai/indexer.ts), gated on `nearmiss.view`, so "has this happened
 * before?" is answerable — and never answerable to someone without the
 * capability.
 */

export class NearMissValidationError extends Error {
  readonly findings: IdentifierFinding[];
  constructor(message: string, findings: IdentifierFinding[] = []) {
    super(message);
    this.name = "NearMissValidationError";
    this.findings = findings;
  }
}

function ensure(actor: Actor, permission: Permission): void {
  if (!actor.permissions.has(permission)) throw new AuthorizationError(permission);
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const CATEGORY_LABELS: Record<NearMissCategory, string> = {
  PRODUCT_SELECTION: "Product selection",
  ORDER_ACCURACY: "Order accuracy",
  WAREHOUSE_SAFETY: "Warehouse safety",
  CUSTOMER_COMMITMENT: "Customer commitment",
  DATA_SECURITY: "Data security",
  SUPPLIER: "Supplier",
  OTHER: "Other",
};

export const SEVERITY_LABELS: Record<NearMissSeverity, string> = {
  NEAR_MISS: "Caught in time",
  MINOR: "Reached the customer, no loss",
  SIGNIFICANT: "Cost money or time",
  SERIOUS: "Injury or real loss",
};

export const SEVERITY_ORDER: NearMissSeverity[] = ["NEAR_MISS", "MINOR", "SIGNIFICANT", "SERIOUS"];

export const STATUS_LABELS: Record<NearMissStatus, string> = {
  REPORTED: "New",
  UNDER_REVIEW: "In review",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

// ---------------------------------------------------------------------------
// Read shapes
// ---------------------------------------------------------------------------

/**
 * The only shape a published near miss is ever read in.
 *
 * `reportedById` is deliberately absent rather than filtered later: a select
 * that never asks for the column cannot leak it through a careless spread, a
 * new API route, or a JSON dump. The anonymity property is structural.
 */
const PUBLISHED_SELECT = {
  id: true,
  reference: true,
  title: true,
  category: true,
  severity: true,
  occurredOn: true,
  whatHappened: true,
  howItWasCaught: true,
  whyItHappened: true,
  whatChanged: true,
  publishedAt: true,
  department: { select: { id: true, name: true } },
  businessUnit: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  preventingSop: { select: { id: true, sopCode: true, title: true, status: true } },
  teachingCourse: { select: { id: true, title: true, status: true } },
} satisfies Prisma.NearMissSelect;

export type PublishedNearMiss = Prisma.NearMissGetPayload<{ select: typeof PUBLISHED_SELECT }>;

/** The review shape. Adds status and, for a named report, who filed it. */
const REVIEW_SELECT = {
  ...PUBLISHED_SELECT,
  status: true,
  createdAt: true,
  updatedAt: true,
  departmentId: true,
  businessUnitId: true,
  locationId: true,
  preventingSopId: true,
  teachingCourseId: true,
  reportedBy: { select: { id: true, name: true } },
  publishedBy: { select: { id: true, name: true } },
} satisfies Prisma.NearMissSelect;

export type NearMissForReview = Prisma.NearMissGetPayload<{ select: typeof REVIEW_SELECT }>;

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const nonEmpty = (max: number) => z.string().trim().min(1).max(max);

export const reportNearMissInputSchema = z.object({
  title: z.string().trim().min(6, "Give it a one-line summary of at least 6 characters.").max(160),
  category: z.enum([
    "PRODUCT_SELECTION",
    "ORDER_ACCURACY",
    "WAREHOUSE_SAFETY",
    "CUSTOMER_COMMITMENT",
    "DATA_SECURITY",
    "SUPPLIER",
    "OTHER",
  ]),
  severity: z.enum(["NEAR_MISS", "MINOR", "SIGNIFICANT", "SERIOUS"]),
  whatHappened: z
    .string()
    .trim()
    .min(20, "A couple of sentences is enough, but one line is not.")
    .max(4000),
  howItWasCaught: z.string().trim().max(2000).optional(),
  whyItHappened: z.string().trim().max(2000).optional(),
  occurredOn: z.coerce.date().optional(),
  departmentId: z.string().optional(),
  businessUnitId: z.string().optional(),
  locationId: z.string().optional(),
  /** When true the report is filed with no link to the reporter, ever. */
  anonymous: z.boolean().default(false),
});

export type ReportNearMissInput = z.input<typeof reportNearMissInputSchema>;

/** Next human reference, "NM-001". Retried by the caller on collision. */
async function nextReference(): Promise<string> {
  const rows = await prisma.nearMiss.findMany({
    where: { reference: { startsWith: "NM-" } },
    select: { reference: true },
    orderBy: { reference: "desc" },
    take: 1,
  });
  const latest = rows[0]?.reference;
  const parsed = latest ? Number.parseInt(latest.slice(3), 10) : 0;
  const next = Number.isFinite(parsed) && parsed > 0 ? parsed + 1 : 1;
  return `NM-${String(next).padStart(3, "0")}`;
}

/**
 * File a report.
 *
 * Accepts almost anything a person is willing to write: the barrier to filing
 * has to be lower than the barrier to staying quiet. Categorization, causal
 * analysis and the linked procedure are the reviewer's job, not the reporter's.
 */
export async function reportNearMiss(
  actor: Actor,
  input: ReportNearMissInput,
): Promise<{ id: string; reference: string }> {
  ensure(actor, "nearmiss.report");
  const parsed = reportNearMissInputSchema.parse(input);

  const occurredOn = parsed.occurredOn ?? null;
  if (occurredOn && occurredOn.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    throw new NearMissValidationError("The date can't be in the future.");
  }

  /*
   * Where it happened is filled in from the reporter's own department and unit
   * when they did not say — that context is what makes the library
   * pattern-spottable, and asking for it again is friction on a form that
   * should have as little as possible.
   *
   * Not for an anonymous report. A silent department stamp on a two-person
   * department identifies the reporter as surely as their name would, so an
   * anonymous report carries only the placement they chose to give it.
   */
  const inferred = parsed.anonymous
    ? { departmentId: null, businessUnitId: null, locationId: null }
    : {
        departmentId: actor.departmentId,
        businessUnitId: actor.businessUnitId,
        locationId: actor.locationId,
      };

  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const reference = await nextReference();
    try {
      const created = await prisma.nearMiss.create({
        data: {
          reference,
          title: parsed.title,
          category: parsed.category,
          severity: parsed.severity,
          status: "REPORTED",
          whatHappened: parsed.whatHappened,
          howItWasCaught: parsed.howItWasCaught || null,
          whyItHappened: parsed.whyItHappened || null,
          occurredOn,
          departmentId: parsed.departmentId || inferred.departmentId,
          businessUnitId: parsed.businessUnitId || inferred.businessUnitId,
          locationId: parsed.locationId || inferred.locationId,
          // The anonymity guarantee, at the only place it can be broken.
          reportedById: parsed.anonymous ? null : actor.id,
        },
        select: { id: true, reference: true },
      });

      await recordAudit({
        // Null actor for an anonymous report: the log records that a report
        // exists, never who wrote it.
        actorId: parsed.anonymous ? null : actor.id,
        actorEmail: parsed.anonymous ? null : actor.email,
        action: AUDIT_ACTIONS.NEAR_MISS_REPORTED,
        entityType: "NearMiss",
        entityId: created.id,
        // Never the narrative: the audit log is readable by audit.view holders
        // who have no business reading an unreviewed report.
        metadata: {
          reference: created.reference,
          category: parsed.category,
          severity: parsed.severity,
          anonymous: parsed.anonymous,
        },
      });

      await notifyReviewers(created.id, created.reference, parsed.severity);
      return created;
    } catch (error) {
      const isUniqueViolation =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: string }).code === "P2002";
      if (isUniqueViolation && attempt < maxAttempts - 1) continue;
      throw error;
    }
  }
  throw new NearMissValidationError("Could not allocate a reference. Please try again.");
}

/** Everyone who can act on a new report, so it does not sit unseen. */
async function notifyReviewers(
  nearMissId: string,
  reference: string,
  severity: NearMissSeverity,
): Promise<void> {
  const reviewers = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      roles: {
        some: {
          role: { permissions: { some: { permission: "nearmiss.review" } } },
        },
      },
    },
    select: { id: true },
  });

  for (const reviewer of reviewers) {
    await notify({
      userId: reviewer.id,
      type: "REVIEW_REQUESTED",
      title: `Near miss ${reference} needs review`,
      body:
        severity === "SERIOUS" || severity === "SIGNIFICANT"
          ? "Reported as having caused real loss. Worth reading today."
          : "A new report is waiting to be turned into a case study.",
      linkUrl: `/admin/near-misses/${nearMissId}`,
      dedupeKey: `nearmiss:${nearMissId}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export interface NearMissQueueItem {
  id: string;
  reference: string;
  title: string;
  category: NearMissCategory;
  severity: NearMissSeverity;
  status: NearMissStatus;
  occurredOn: Date | null;
  createdAt: Date;
  departmentName: string | null;
  /** True when the reporter asked not to be identified. */
  anonymous: boolean;
  /** How many days it has been waiting. Reviewers respond to a number. */
  waitingDays: number;
}

/** The review queue: what has been reported and not yet published or archived. */
export async function getNearMissQueue(
  actor: Actor,
  options: { status?: NearMissStatus[] } = {},
): Promise<NearMissQueueItem[]> {
  ensure(actor, "nearmiss.review");
  const statuses = options.status ?? ["REPORTED", "UNDER_REVIEW"];

  const rows = await prisma.nearMiss.findMany({
    where: { isDeleted: false, status: { in: statuses } },
    select: {
      id: true,
      reference: true,
      title: true,
      category: true,
      severity: true,
      status: true,
      occurredOn: true,
      createdAt: true,
      reportedById: true,
      department: { select: { name: true } },
    },
    orderBy: [{ createdAt: "asc" }],
  });

  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    title: row.title,
    category: row.category,
    severity: row.severity,
    status: row.status,
    occurredOn: row.occurredOn,
    createdAt: row.createdAt,
    departmentName: row.department?.name ?? null,
    anonymous: row.reportedById === null,
    waitingDays: Math.max(0, Math.floor((now - row.createdAt.getTime()) / 86_400_000)),
  }));
}

/** A single report in full, for the reviewer's editor. Any status. */
export async function getNearMissForReview(
  actor: Actor,
  id: string,
): Promise<NearMissForReview | null> {
  ensure(actor, "nearmiss.review");
  const row = await prisma.nearMiss.findFirst({
    where: { id, isDeleted: false },
    select: REVIEW_SELECT,
  });
  return row;
}

export const reviewNearMissInputSchema = z.object({
  title: nonEmpty(160),
  category: reportNearMissInputSchema.shape.category,
  severity: reportNearMissInputSchema.shape.severity,
  whatHappened: nonEmpty(4000),
  howItWasCaught: z.string().trim().max(2000).optional(),
  whyItHappened: z.string().trim().max(2000).optional(),
  whatChanged: z.string().trim().max(2000).optional(),
  occurredOn: z.coerce.date().nullish(),
  departmentId: z.string().nullish(),
  businessUnitId: z.string().nullish(),
  locationId: z.string().nullish(),
  preventingSopId: z.string().nullish(),
  teachingCourseId: z.string().nullish(),
});

export type ReviewNearMissInput = z.input<typeof reviewNearMissInputSchema>;

/**
 * Save the reviewer's version. Moves a new report into review on first save so
 * two reviewers do not silently work on the same one.
 */
export async function saveNearMissReview(
  actor: Actor,
  id: string,
  input: ReviewNearMissInput,
): Promise<{ id: string; findings: IdentifierFinding[] }> {
  ensure(actor, "nearmiss.review");
  const parsed = reviewNearMissInputSchema.parse(input);

  const existing = await prisma.nearMiss.findFirst({
    where: { id, isDeleted: false },
    select: { id: true, status: true, reference: true },
  });
  if (!existing) throw new NearMissValidationError("That report no longer exists.");
  if (existing.status === "PUBLISHED") {
    throw new NearMissValidationError(
      "This is published. Archive it if the case study needs to be withdrawn.",
    );
  }

  await prisma.nearMiss.update({
    where: { id },
    data: {
      title: parsed.title,
      category: parsed.category,
      severity: parsed.severity,
      whatHappened: parsed.whatHappened,
      howItWasCaught: parsed.howItWasCaught || null,
      whyItHappened: parsed.whyItHappened || null,
      whatChanged: parsed.whatChanged || null,
      occurredOn: parsed.occurredOn ?? null,
      departmentId: parsed.departmentId || null,
      businessUnitId: parsed.businessUnitId || null,
      locationId: parsed.locationId || null,
      preventingSopId: parsed.preventingSopId || null,
      teachingCourseId: parsed.teachingCourseId || null,
      status: existing.status === "REPORTED" ? "UNDER_REVIEW" : existing.status,
    },
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.NEAR_MISS_REVIEWED,
    entityType: "NearMiss",
    entityId: id,
    metadata: { reference: existing.reference, category: parsed.category, severity: parsed.severity },
  });

  return { id, findings: await checkNarrative(parsed) };
}

/** Active-directory scan of a candidate narrative. Exposed for the review UI. */
export async function checkNearMissNarrative(
  actor: Actor,
  narrative: {
    whatHappened?: string | null;
    howItWasCaught?: string | null;
    whyItHappened?: string | null;
    whatChanged?: string | null;
    title?: string | null;
  },
): Promise<IdentifierFinding[]> {
  ensure(actor, "nearmiss.review");
  return checkNarrative(narrative);
}

async function checkNarrative(narrative: {
  title?: string | null;
  whatHappened?: string | null;
  howItWasCaught?: string | null;
  whyItHappened?: string | null;
  whatChanged?: string | null;
}): Promise<IdentifierFinding[]> {
  /*
   * Checked against everyone on record, including deactivated people: a former
   * colleague's name is exactly as identifying as a current one.
   */
  const directory = await prisma.user.findMany({
    select: { name: true, email: true, employeeId: true },
  });

  return findIdentifiers(
    [
      { field: "Summary", text: narrative.title },
      { field: "What happened", text: narrative.whatHappened },
      { field: "How it was caught", text: narrative.howItWasCaught },
      { field: "Why it happened", text: narrative.whyItHappened },
      { field: "What changed", text: narrative.whatChanged },
    ],
    directory,
  );
}

/**
 * Publish a report as a case study.
 *
 * Refuses on two grounds, both of them the point of the feature: the narrative
 * still identifies someone, or it does not yet say what changed. A near miss
 * with no "what changed" is a story; with one it is a lesson.
 */
export async function publishNearMiss(actor: Actor, id: string): Promise<{ id: string }> {
  ensure(actor, "nearmiss.review");

  const row = await prisma.nearMiss.findFirst({
    where: { id, isDeleted: false },
    select: {
      id: true,
      reference: true,
      status: true,
      title: true,
      whatHappened: true,
      howItWasCaught: true,
      whyItHappened: true,
      whatChanged: true,
      severity: true,
      category: true,
      reportedById: true,
    },
  });
  if (!row) throw new NearMissValidationError("That report no longer exists.");
  if (row.status === "PUBLISHED") return { id };
  if (row.status === "ARCHIVED") {
    throw new NearMissValidationError("This report is archived. Reopen it before publishing.");
  }

  if (!row.whyItHappened || row.whyItHappened.trim().length < 10) {
    throw new NearMissValidationError(
      "Fill in why it happened before publishing. Without a cause it teaches nothing.",
    );
  }
  if (!row.whatChanged || row.whatChanged.trim().length < 10) {
    throw new NearMissValidationError(
      "Fill in what changed before publishing. A near miss with no change is a story, not a lesson.",
    );
  }

  const findings = await checkNarrative(row);
  if (hasBlockingIdentifiers(findings)) {
    throw new NearMissValidationError(
      `This still identifies someone (${summarizeBlocking(findings)}). Rewrite it in terms of roles before publishing.`,
      findings,
    );
  }

  const now = new Date();
  await prisma.nearMiss.update({
    where: { id },
    data: { status: "PUBLISHED", publishedById: actor.id, publishedAt: now },
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.NEAR_MISS_PUBLISHED,
    entityType: "NearMiss",
    entityId: id,
    metadata: {
      reference: row.reference,
      category: row.category,
      severity: row.severity,
      warnings: findings.length,
    },
  });

  /*
   * Close the loop with the reporter. People stop filing reports when nothing
   * visible ever comes of them, and this is the cheapest possible answer to
   * "did anything happen?". Anonymous reports have nobody to tell, by design.
   */
  if (row.reportedById) {
    await notify({
      userId: row.reportedById,
      type: "SYSTEM",
      title: "Your near-miss report is now a case study",
      body: `${row.reference} was published to the library so others can learn from it. Thank you for filing it.`,
      linkUrl: `/near-misses/${row.reference}`,
      inAppOnly: true,
    });
  }

  await indexPublishedNearMiss(id);
  return { id };
}

/** Withdraw a case study, or close a report that needed no change. */
export async function archiveNearMiss(
  actor: Actor,
  id: string,
  reason?: string,
): Promise<{ id: string }> {
  ensure(actor, "nearmiss.review");
  const row = await prisma.nearMiss.findFirst({
    where: { id, isDeleted: false },
    select: { id: true, reference: true, status: true },
  });
  if (!row) throw new NearMissValidationError("That report no longer exists.");

  await prisma.nearMiss.update({ where: { id }, data: { status: "ARCHIVED" } });
  await prisma.knowledgeChunk.deleteMany({ where: { entityType: "NEAR_MISS", entityId: id } });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.NEAR_MISS_ARCHIVED,
    entityType: "NearMiss",
    entityId: id,
    metadata: { reference: row.reference, previousStatus: row.status, reason: reason ?? null },
  });

  return { id };
}

/** Move an archived or published report back into review. */
export async function reopenNearMiss(actor: Actor, id: string): Promise<{ id: string }> {
  ensure(actor, "nearmiss.review");
  const row = await prisma.nearMiss.findFirst({
    where: { id, isDeleted: false },
    select: { id: true, reference: true, status: true },
  });
  if (!row) throw new NearMissValidationError("That report no longer exists.");
  if (row.status === "REPORTED" || row.status === "UNDER_REVIEW") return { id };

  await prisma.nearMiss.update({
    where: { id },
    data: { status: "UNDER_REVIEW", publishedAt: null, publishedById: null },
  });
  // A withdrawn case study must leave the retrieval corpus with it.
  await prisma.knowledgeChunk.deleteMany({ where: { entityType: "NEAR_MISS", entityId: id } });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.NEAR_MISS_REVIEWED,
    entityType: "NearMiss",
    entityId: id,
    metadata: { reference: row.reference, previousStatus: row.status, reopened: true },
  });

  return { id };
}

// ---------------------------------------------------------------------------
// The published library
// ---------------------------------------------------------------------------

export interface LibraryFilters {
  q?: string;
  category?: NearMissCategory;
  severity?: NearMissSeverity;
  departmentId?: string;
  /** Only case studies linked to this procedure. */
  sopId?: string;
  limit?: number;
}

/** Published case studies the actor may read. Never selects the reporter. */
export async function getPublishedNearMisses(
  actor: Actor,
  filters: LibraryFilters = {},
): Promise<PublishedNearMiss[]> {
  ensure(actor, "nearmiss.view");
  const term = filters.q?.trim();

  return prisma.nearMiss.findMany({
    where: {
      isDeleted: false,
      status: "PUBLISHED",
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.severity ? { severity: filters.severity } : {}),
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(filters.sopId ? { preventingSopId: filters.sopId } : {}),
      ...(term && term.length >= 2
        ? {
            OR: [
              { title: { contains: term, mode: "insensitive" } },
              { whatHappened: { contains: term, mode: "insensitive" } },
              { howItWasCaught: { contains: term, mode: "insensitive" } },
              { whyItHappened: { contains: term, mode: "insensitive" } },
              { whatChanged: { contains: term, mode: "insensitive" } },
              { reference: { contains: term, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: PUBLISHED_SELECT,
    orderBy: [{ publishedAt: "desc" }],
    take: Math.min(Math.max(filters.limit ?? 60, 1), 200),
  });
}

/** One case study, by id or by its human reference ("NM-004"). */
export async function getPublishedNearMiss(
  actor: Actor,
  idOrReference: string,
): Promise<PublishedNearMiss | null> {
  ensure(actor, "nearmiss.view");
  return prisma.nearMiss.findFirst({
    where: {
      isDeleted: false,
      status: "PUBLISHED",
      OR: [{ id: idOrReference }, { reference: idOrReference.toUpperCase() }],
    },
    select: PUBLISHED_SELECT,
  });
}

/**
 * Case studies attached to a procedure, for the SOP page.
 *
 * This is the join that makes an SOP feel earned rather than imposed: the step
 * that reads like bureaucracy is next to the day it would have saved.
 */
export async function getNearMissesForSop(
  actor: Actor,
  sopId: string,
): Promise<Pick<PublishedNearMiss, "id" | "reference" | "title" | "severity" | "whatChanged">[]> {
  if (!actor.permissions.has("nearmiss.view")) return [];
  return prisma.nearMiss.findMany({
    where: { isDeleted: false, status: "PUBLISHED", preventingSopId: sopId },
    select: { id: true, reference: true, title: true, severity: true, whatChanged: true },
    orderBy: [{ publishedAt: "desc" }],
    take: 5,
  });
}

/** Same, for a course page. */
export async function getNearMissesForCourse(
  actor: Actor,
  courseId: string,
): Promise<Pick<PublishedNearMiss, "id" | "reference" | "title" | "severity" | "whatChanged">[]> {
  if (!actor.permissions.has("nearmiss.view")) return [];
  return prisma.nearMiss.findMany({
    where: { isDeleted: false, status: "PUBLISHED", teachingCourseId: courseId },
    select: { id: true, reference: true, title: true, severity: true, whatChanged: true },
    orderBy: [{ publishedAt: "desc" }],
    take: 5,
  });
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

export interface NearMissPattern {
  category: NearMissCategory;
  count: number;
  /** Published case studies in this category with no linked procedure. */
  withoutProcedure: number;
  latestAt: Date | null;
}

export interface NearMissStats {
  published: number;
  awaitingReview: number;
  /** Reported in the last 90 days, whatever their status. */
  recent: number;
  patterns: NearMissPattern[];
}

/**
 * What the library adds up to.
 *
 * `withoutProcedure` is the number worth acting on: a repeated category of
 * failure that no procedure covers is the strongest signal in here for what to
 * write next.
 */
export async function getNearMissStats(actor: Actor): Promise<NearMissStats> {
  ensure(actor, "nearmiss.view");
  const since = new Date(Date.now() - 90 * 86_400_000);

  const [published, awaiting, recent, grouped, unlinked] = await Promise.all([
    prisma.nearMiss.count({ where: { isDeleted: false, status: "PUBLISHED" } }),
    actor.permissions.has("nearmiss.review")
      ? prisma.nearMiss.count({
          where: { isDeleted: false, status: { in: ["REPORTED", "UNDER_REVIEW"] } },
        })
      : Promise.resolve(0),
    prisma.nearMiss.count({ where: { isDeleted: false, createdAt: { gte: since } } }),
    prisma.nearMiss.groupBy({
      by: ["category"],
      where: { isDeleted: false, status: "PUBLISHED" },
      _count: { _all: true },
      _max: { publishedAt: true },
    }),
    prisma.nearMiss.groupBy({
      by: ["category"],
      where: { isDeleted: false, status: "PUBLISHED", preventingSopId: null },
      _count: { _all: true },
    }),
  ]);

  const unlinkedByCategory = new Map(unlinked.map((row) => [row.category, row._count._all]));

  return {
    published,
    awaitingReview: awaiting,
    recent,
    patterns: grouped
      .map((row) => ({
        category: row.category,
        count: row._count._all,
        withoutProcedure: unlinkedByCategory.get(row.category) ?? 0,
        latestAt: row._max.publishedAt,
      }))
      .sort((a, b) => b.count - a.count),
  };
}

// ---------------------------------------------------------------------------
// Retrieval corpus
// ---------------------------------------------------------------------------

/**
 * Index a published case study for Ask FSW AI.
 *
 * Imported lazily so this service can be used from the seed process and from
 * tests without pulling in the AI provider chain.
 */
async function indexPublishedNearMiss(id: string): Promise<void> {
  try {
    const { indexNearMiss } = await import("@/lib/ai/indexer");
    await indexNearMiss(id);
  } catch (error) {
    // Indexing is best-effort: a missing embedding provider must never stop a
    // reviewer from publishing.
    console.error("[near-miss] indexing failed", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
