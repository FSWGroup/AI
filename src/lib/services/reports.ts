import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getVisibleUserIds, type Actor } from "@/lib/auth/guard";
import type { Permission } from "@/lib/permissions";
import { getTranscript } from "@/lib/services/completion";
import { getTrainingMatrix } from "@/lib/services/matrix";
import type { ExportColumn } from "@/lib/export";

/**
 * The report engine.
 *
 * Every report is a `ReportDefinition`: a permission, a filter spec, a column
 * spec, and a `run()` that returns one page of rows plus a total. One generic
 * page (src/app/(app)/admin/reports/[key]/page.tsx) renders the filter bar,
 * table, pagination, and export buttons from these specs for all 24 reports —
 * no per-report page code.
 *
 * Every report is scoped by getVisibleUserIds so a manager only ever sees
 * their reporting subtree, never the whole organization.
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type FilterType = "text" | "select" | "date" | "boolean" | "person";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterSpec {
  key: string;
  label: string;
  type: FilterType;
  placeholder?: string;
  options?: FilterOption[] | (() => Promise<FilterOption[]>);
}

export type ColumnFormat = "text" | "number" | "percent" | "date" | "datetime" | "badge";

export interface ColumnSpec {
  key: string;
  label: string;
  format?: ColumnFormat;
  width?: number;
}

export interface ReportRunParams {
  filters: Record<string, string | undefined>;
  page: number;
  pageSize: number;
}

export interface ReportRunResult {
  rows: Record<string, unknown>[];
  total: number;
  summary?: Record<string, unknown>;
}

export interface ReportDefinition {
  key: string;
  name: string;
  description: string;
  category: string;
  permission: Permission;
  filters: FilterSpec[];
  columns: ColumnSpec[];
  run(actor: Actor, params: ReportRunParams): Promise<ReportRunResult>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 25;

function clampPage(params: ReportRunParams): { page: number; pageSize: number; skip: number; take: number } {
  const page = Math.max(1, Math.floor(params.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Math.floor(params.pageSize) || DEFAULT_PAGE_SIZE));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

async function scopedUserWhere(actor: Actor, extra: Prisma.UserWhereInput = {}): Promise<Prisma.UserWhereInput> {
  const visible = await getVisibleUserIds(actor);
  return visible === "ALL" ? extra : { ...extra, id: { in: visible } };
}

async function scopedUserIdsSql(actor: Actor): Promise<Prisma.Sql> {
  const visible = await getVisibleUserIds(actor);
  return visible === "ALL" ? Prisma.empty : Prisma.sql`AND u."id" = ANY(${visible})`;
}

function dateFilter(filters: ReportRunParams["filters"], fromKey = "dateFrom", toKey = "dateTo"): Prisma.DateTimeFilter | undefined {
  const from = filters[fromKey];
  const to = filters[toKey];
  if (!from && !to) return undefined;
  const range: Prisma.DateTimeFilter = {};
  if (from) range.gte = new Date(from);
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    range.lte = end;
  }
  return range;
}

const DATE_RANGE_FILTERS: FilterSpec[] = [
  { key: "dateFrom", label: "From", type: "date" },
  { key: "dateTo", label: "To", type: "date" },
];

async function businessUnitOptions(): Promise<FilterOption[]> {
  const rows = await prisma.businessUnit.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

async function departmentOptions(): Promise<FilterOption[]> {
  const rows = await prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

async function locationOptions(): Promise<FilterOption[]> {
  const rows = await prisma.location.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

const WORKER_TYPE_OPTIONS: FilterOption[] = [
  "US_EMPLOYEE",
  "US_CONTRACTOR",
  "PH_EMPLOYEE",
  "PH_CONTRACTOR",
  "INTL_EMPLOYEE",
  "INTL_CONTRACTOR",
].map((v) => ({ value: v, label: v.replace(/_/g, " ") }));

const ORG_FILTERS: FilterSpec[] = [
  { key: "businessUnitId", label: "Business unit", type: "select", options: businessUnitOptions },
  { key: "departmentId", label: "Department", type: "select", options: departmentOptions },
];

function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? round((numerator / denominator) * 100) : 0;
}

// ---------------------------------------------------------------------------
// 1. Training Completion
// ---------------------------------------------------------------------------

async function runTrainingCompletion(actor: Actor, params: ReportRunParams): Promise<ReportRunResult> {
  const { skip, take } = clampPage(params);
  const userWhere = await scopedUserWhere(actor, {
    ...(params.filters.businessUnitId ? { businessUnitId: params.filters.businessUnitId } : {}),
    ...(params.filters.departmentId ? { departmentId: params.filters.departmentId } : {}),
  });
  const completedAt = dateFilter(params.filters);

  const where: Prisma.CompletionRecordWhereInput = {
    user: userWhere,
    ...(completedAt ? { completedAt } : {}),
    ...(params.filters.targetType ? { targetType: params.filters.targetType as Prisma.EnumTrainingTargetTypeFilter["equals"] } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.completionRecord.findMany({
      where,
      orderBy: { completedAt: "desc" },
      skip,
      take,
      include: { user: { select: { name: true, email: true } }, certificate: { select: { certificateNumber: true } } },
    }),
    prisma.completionRecord.count({ where }),
  ]);

  return {
    rows: rows.map((r) => ({
      person: r.user.name,
      email: r.user.email,
      title: r.titleSnapshot,
      type: r.targetType,
      versionLabel: r.versionLabel,
      completedAt: r.completedAt,
      scorePercent: r.scorePercent,
      expiresAt: r.expiresAt,
      certificateNumber: r.certificate?.certificateNumber ?? null,
    })),
    total,
  };
}

// ---------------------------------------------------------------------------
// 2. Individual Training Transcript
// ---------------------------------------------------------------------------

async function runIndividualTranscript(actor: Actor, params: ReportRunParams): Promise<ReportRunResult> {
  const personId = params.filters.personId;
  if (!personId) return { rows: [], total: 0, summary: { hint: "Choose a person to view their transcript." } };

  const entries = await getTranscript(actor, personId);
  const { skip, take } = clampPage(params);
  const page = entries.slice(skip, skip + take);

  return {
    rows: page.map((e) => ({
      kind: e.kind,
      title: e.title,
      versionLabel: e.versionLabel,
      startedAt: e.startedAt,
      completedAt: e.completedAt,
      scorePercent: e.scorePercent,
      attemptCount: e.attemptCount,
      certificateNumber: e.certificateNumber,
      expiresAt: e.expiresAt,
      overridden: e.overridden,
    })),
    total: entries.length,
  };
}

// ---------------------------------------------------------------------------
// 3. Course Completion
// ---------------------------------------------------------------------------

async function runCourseCompletion(actor: Actor, params: ReportRunParams): Promise<ReportRunResult> {
  const { skip, take } = clampPage(params);
  const userWhere = await scopedUserWhere(actor, {
    ...(params.filters.businessUnitId ? { businessUnitId: params.filters.businessUnitId } : {}),
    ...(params.filters.departmentId ? { departmentId: params.filters.departmentId } : {}),
  });
  const completedAt = dateFilter(params.filters);

  const where: Prisma.CompletionRecordWhereInput = {
    targetType: "COURSE",
    user: userWhere,
    ...(completedAt ? { completedAt } : {}),
    ...(params.filters.q ? { titleSnapshot: { contains: params.filters.q, mode: "insensitive" } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.completionRecord.findMany({
      where,
      orderBy: { completedAt: "desc" },
      skip,
      take,
      include: { user: { select: { name: true, email: true } }, certificate: { select: { certificateNumber: true } } },
    }),
    prisma.completionRecord.count({ where }),
  ]);

  return {
    rows: rows.map((r) => ({
      person: r.user.name,
      email: r.user.email,
      course: r.titleSnapshot,
      versionLabel: r.versionLabel,
      completedAt: r.completedAt,
      scorePercent: r.scorePercent,
      attemptCount: r.attemptCount,
      durationMinutes: r.durationMinutes,
      expiresAt: r.expiresAt,
      certificateNumber: r.certificate?.certificateNumber ?? null,
    })),
    total,
  };
}

// ---------------------------------------------------------------------------
// 4. Learning Path Progress
// ---------------------------------------------------------------------------

async function runLearningPathProgress(actor: Actor, params: ReportRunParams): Promise<ReportRunResult> {
  const { skip, take } = clampPage(params);
  const userWhere = await scopedUserWhere(actor);

  const where: Prisma.AssignmentWhereInput = {
    targetType: "LEARNING_PATH",
    user: userWhere,
    ...(params.filters.status ? { status: params.filters.status as Prisma.EnumAssignmentStatusFilter["equals"] } : {}),
  };

  const [assignments, total] = await Promise.all([
    prisma.assignment.findMany({
      where,
      orderBy: { assignedAt: "desc" },
      skip,
      take,
      include: {
        user: { select: { name: true, email: true } },
        path: { select: { title: true, items: { where: { required: true }, select: { id: true } } } },
      },
    }),
    prisma.assignment.count({ where }),
  ]);

  const parentIds = assignments.map((a) => a.id);
  const childCounts = parentIds.length
    ? await prisma.assignment.groupBy({
        by: ["parentAssignmentId", "status"],
        where: { parentAssignmentId: { in: parentIds } },
        _count: { _all: true },
      })
    : [];

  const completedByParent = new Map<string, number>();
  const totalByParent = new Map<string, number>();
  for (const row of childCounts) {
    const key = row.parentAssignmentId as string;
    totalByParent.set(key, (totalByParent.get(key) ?? 0) + row._count._all);
    if (row.status === "COMPLETED") completedByParent.set(key, (completedByParent.get(key) ?? 0) + row._count._all);
  }

  return {
    rows: assignments.map((a) => {
      const totalItems = a.path?.items.length ?? totalByParent.get(a.id) ?? 0;
      const completedItems = completedByParent.get(a.id) ?? 0;
      return {
        person: a.user.name,
        email: a.user.email,
        path: a.path?.title ?? "—",
        status: a.status,
        assignedAt: a.assignedAt,
        dueAt: a.dueAt,
        completedItems,
        totalItems,
        percentComplete: pct(completedItems, totalItems),
      };
    }),
    total,
  };
}

// ---------------------------------------------------------------------------
// 5. Onboarding Progress
//
// The schema has no dedicated "onboarding path" flag, so this report uses the
// documented, honest heuristic: people whose startDate falls in the selected
// window (default: last 90 days), alongside their earliest-assigned learning
// path's progress, computed the same way as Learning Path Progress above.
// ---------------------------------------------------------------------------

async function runOnboardingProgress(actor: Actor, params: ReportRunParams): Promise<ReportRunResult> {
  const { skip, take } = clampPage(params);
  const from = params.filters.dateFrom ? new Date(params.filters.dateFrom) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const to = params.filters.dateTo ? new Date(params.filters.dateTo) : new Date();

  const userWhere = await scopedUserWhere(actor, {
    startDate: { gte: from, lte: to },
    status: "ACTIVE",
    ...(params.filters.businessUnitId ? { businessUnitId: params.filters.businessUnitId } : {}),
    ...(params.filters.departmentId ? { departmentId: params.filters.departmentId } : {}),
  });

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where: userWhere,
      orderBy: { startDate: "desc" },
      skip,
      take,
      select: {
        id: true,
        name: true,
        email: true,
        startDate: true,
        manager: { select: { name: true } },
        assignments: {
          where: { targetType: "LEARNING_PATH" },
          orderBy: { assignedAt: "asc" },
          take: 1,
          include: { path: { select: { title: true, items: { where: { required: true }, select: { id: true } } } } },
        },
      },
    }),
    prisma.user.count({ where: userWhere }),
  ]);

  const pathAssignmentIds = users.map((u) => u.assignments[0]?.id).filter((id): id is string => Boolean(id));
  const completedCounts = pathAssignmentIds.length
    ? await prisma.assignment.groupBy({
        by: ["parentAssignmentId"],
        where: { parentAssignmentId: { in: pathAssignmentIds }, status: "COMPLETED" },
        _count: { _all: true },
      })
    : [];
  const completedByParent = new Map(completedCounts.map((c) => [c.parentAssignmentId as string, c._count._all]));

  return {
    rows: users.map((u) => {
      const pathAssignment = u.assignments[0];
      const totalItems = pathAssignment?.path?.items.length ?? 0;
      const completedItems = pathAssignment ? (completedByParent.get(pathAssignment.id) ?? 0) : 0;
      const daysSinceStart = u.startDate ? Math.floor((Date.now() - u.startDate.getTime()) / (24 * 60 * 60 * 1000)) : null;
      return {
        person: u.name,
        email: u.email,
        manager: u.manager?.name ?? "—",
        startDate: u.startDate,
        daysSinceStart,
        onboardingPath: pathAssignment?.path?.title ?? "Not assigned",
        percentComplete: pct(completedItems, totalItems),
        pathStatus: pathAssignment?.status ?? "—",
      };
    }),
    total,
  };
}

// ---------------------------------------------------------------------------
// 6. Overdue Training
// ---------------------------------------------------------------------------

async function runOverdueTraining(actor: Actor, params: ReportRunParams): Promise<ReportRunResult> {
  const { skip, take } = clampPage(params);
  const userWhere = await scopedUserWhere(actor, {
    ...(params.filters.businessUnitId ? { businessUnitId: params.filters.businessUnitId } : {}),
    ...(params.filters.departmentId ? { departmentId: params.filters.departmentId } : {}),
    ...(params.filters.locationId ? { locationId: params.filters.locationId } : {}),
  });

  const where: Prisma.AssignmentWhereInput = {
    user: userWhere,
    OR: [{ status: "OVERDUE" }, { status: { in: ["ASSIGNED", "IN_PROGRESS"] }, dueAt: { lt: new Date() } }],
  };

  const [rows, total] = await Promise.all([
    prisma.assignment.findMany({
      where,
      orderBy: { dueAt: "asc" },
      skip,
      take,
      include: {
        user: { select: { name: true, email: true, manager: { select: { name: true } } } },
        course: { select: { title: true } },
        sop: { select: { title: true, sopCode: true } },
        path: { select: { title: true } },
      },
    }),
    prisma.assignment.count({ where }),
  ]);

  const now = Date.now();
  return {
    rows: rows.map((a) => ({
      person: a.user.name,
      email: a.user.email,
      manager: a.user.manager?.name ?? "—",
      title: a.course?.title ?? (a.sop ? `${a.sop.sopCode} — ${a.sop.title}` : a.path?.title) ?? "—",
      type: a.targetType,
      dueAt: a.dueAt,
      daysOverdue: a.dueAt ? Math.max(0, Math.floor((now - a.dueAt.getTime()) / (24 * 60 * 60 * 1000))) : 0,
      source: a.source,
    })),
    total,
  };
}

// ---------------------------------------------------------------------------
// 7 & 8. Certification / Certification Expiration
// ---------------------------------------------------------------------------

async function runCertification(actor: Actor, params: ReportRunParams): Promise<ReportRunResult> {
  const { skip, take } = clampPage(params);
  const userWhere = await scopedUserWhere(actor);
  const issuedAt = dateFilter(params.filters);

  const where: Prisma.CertificateWhereInput = {
    user: userWhere,
    ...(issuedAt ? { issuedAt } : {}),
    ...(params.filters.q ? { courseTitleSnapshot: { contains: params.filters.q, mode: "insensitive" } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.certificate.findMany({ where, orderBy: { issuedAt: "desc" }, skip, take, include: { user: { select: { name: true, email: true } } } }),
    prisma.certificate.count({ where }),
  ]);

  const now = Date.now();
  return {
    rows: rows.map((c) => ({
      person: c.user.name,
      email: c.user.email,
      course: c.courseTitleSnapshot,
      certificateNumber: c.certificateNumber,
      issuedAt: c.issuedAt,
      expiresAt: c.expiresAt,
      status: c.revokedAt ? "REVOKED" : c.expiresAt && c.expiresAt.getTime() < now ? "EXPIRED" : "VALID",
      instructorName: c.instructorName,
    })),
    total,
  };
}

async function runCertificationExpiration(actor: Actor, params: ReportRunParams): Promise<ReportRunResult> {
  const { skip, take } = clampPage(params);
  const userWhere = await scopedUserWhere(actor);
  const daysAhead = Number(params.filters.daysAhead ?? 60);
  const horizon = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);

  const where: Prisma.CertificateWhereInput = {
    user: userWhere,
    revokedAt: null,
    expiresAt: { not: null, lte: horizon },
  };

  const [rows, total] = await Promise.all([
    prisma.certificate.findMany({ where, orderBy: { expiresAt: "asc" }, skip, take, include: { user: { select: { name: true, email: true, manager: { select: { name: true } } } } } }),
    prisma.certificate.count({ where }),
  ]);

  const now = Date.now();
  return {
    rows: rows.map((c) => ({
      person: c.user.name,
      email: c.user.email,
      manager: c.user.manager?.name ?? "—",
      course: c.courseTitleSnapshot,
      certificateNumber: c.certificateNumber,
      expiresAt: c.expiresAt,
      daysRemaining: c.expiresAt ? Math.ceil((c.expiresAt.getTime() - now) / (24 * 60 * 60 * 1000)) : null,
    })),
    total,
  };
}

// QuizAttempt.lessonId has no Prisma relation to Lesson in the schema, so
// quiz/course titles are resolved with a small batched lookup instead of `include`.
async function lessonCourseInfo(lessonIds: string[]): Promise<Map<string, { title: string; courseTitle: string }>> {
  const uniqueIds = [...new Set(lessonIds)];
  if (uniqueIds.length === 0) return new Map();
  const lessons = await prisma.lesson.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, title: true, section: { select: { course: { select: { title: true } } } } },
  });
  return new Map(lessons.map((l) => [l.id, { title: l.title, courseTitle: l.section.course.title }]));
}

// ---------------------------------------------------------------------------
// 9 & 10. Assessment Scores / Assessment Attempts
// ---------------------------------------------------------------------------

async function runAssessmentScores(actor: Actor, params: ReportRunParams): Promise<ReportRunResult> {
  const { skip, take } = clampPage(params);
  const visible = await getVisibleUserIds(actor);
  const submittedAt = dateFilter(params.filters, "dateFrom", "dateTo");

  const where: Prisma.QuizAttemptWhereInput = {
    status: { in: ["PASSED", "FAILED"] },
    ...(visible === "ALL" ? {} : { userId: { in: visible } }),
    ...(submittedAt ? { submittedAt } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.quizAttempt.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      skip,
      take,
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.quizAttempt.count({ where }),
  ]);

  const lessonInfo = await lessonCourseInfo(rows.map((r) => r.lessonId));

  return {
    rows: rows.map((a) => {
      const lesson = lessonInfo.get(a.lessonId);
      return {
        person: a.user.name,
        email: a.user.email,
        course: lesson?.courseTitle ?? "—",
        quiz: lesson?.title ?? "—",
        attemptNumber: a.attemptNumber,
        scorePercent: a.scorePercent,
        status: a.status,
        submittedAt: a.submittedAt,
      };
    }),
    total,
  };
}

async function runAssessmentAttempts(actor: Actor, params: ReportRunParams): Promise<ReportRunResult> {
  const { skip, take } = clampPage(params);
  const visible = await getVisibleUserIds(actor);
  const startedAt = dateFilter(params.filters, "dateFrom", "dateTo");

  const where: Prisma.QuizAttemptWhereInput = {
    ...(visible === "ALL" ? {} : { userId: { in: visible } }),
    ...(startedAt ? { startedAt } : {}),
    ...(params.filters.status ? { status: params.filters.status as Prisma.EnumAttemptStatusFilter["equals"] } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.quizAttempt.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip,
      take,
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.quizAttempt.count({ where }),
  ]);

  const lessonInfo = await lessonCourseInfo(rows.map((r) => r.lessonId));

  return {
    rows: rows.map((a) => {
      const lesson = lessonInfo.get(a.lessonId);
      return {
        person: a.user.name,
        email: a.user.email,
        course: lesson?.courseTitle ?? "—",
        quiz: lesson?.title ?? "—",
        attemptNumber: a.attemptNumber,
        status: a.status,
        startedAt: a.startedAt,
        submittedAt: a.submittedAt,
        gradedAt: a.gradedAt,
      };
    }),
    total,
  };
}

// ---------------------------------------------------------------------------
// 11. Training Matrix — delegates to matrix.ts, owned by another agent.
// ---------------------------------------------------------------------------

/**
 * matrix.ts renders a people×requirement grid with its own internal
 * pagination (25 people per matrix page). This report flattens that grid to
 * one row per (person, requirement) pair, which is what a filterable,
 * exportable table needs — the grid visualization itself lives on the
 * dedicated matrix screen the compliance/training admin pages own.
 */
async function runTrainingMatrix(actor: Actor, params: ReportRunParams): Promise<ReportRunResult> {
  const rowMode = params.filters.rowMode === "positions" ? "positions" : "people";
  const matrixPage = Math.max(1, Math.floor(params.page) || 1);

  try {
    const matrix = await getTrainingMatrix(actor, {
      rowMode,
      page: matrixPage,
      filters: {
        departmentId: params.filters.departmentId || undefined,
        workerType: params.filters.workerType || undefined,
        courseId: params.filters.courseId || undefined,
      },
    });

    const flattened: Record<string, unknown>[] = [];
    for (const row of matrix.rows) {
      for (const column of matrix.columns) {
        flattened.push({
          person: row.label,
          sublabel: row.sublabel,
          requirement: column.title,
          status: row.cells[column.key] ?? "NOT_REQUIRED",
        });
      }
    }
    return {
      rows: flattened,
      total: flattened.length,
      summary: { matrixTotalRows: matrix.total, matrixPage: matrix.page, matrixPageSize: matrix.pageSize },
    };
  } catch (error) {
    console.error("[reports] training_matrix failed", error);
    return { rows: [], total: 0, summary: { error: "Training matrix data is temporarily unavailable." } };
  }
}

// ---------------------------------------------------------------------------
// 12–17. Training by Manager / Department / Business Unit / Country / Location / Worker Type
// ---------------------------------------------------------------------------

interface DimensionRow {
  key: string | null;
  label: string | null;
  headcount: bigint;
  assigned: bigint;
  completed: bigint;
  overdue: bigint;
}

async function runTrainingByDimension(
  actor: Actor,
  params: ReportRunParams,
  joinSql: Prisma.Sql,
  keySql: Prisma.Sql,
  labelSql: Prisma.Sql,
): Promise<ReportRunResult> {
  const { skip, take } = clampPage(params);
  const visibleFilter = await scopedUserIdsSql(actor);
  const buFilter = params.filters.businessUnitId ? Prisma.sql`AND u."businessUnitId" = ${params.filters.businessUnitId}` : Prisma.empty;

  const rows = await prisma.$queryRaw<DimensionRow[]>`
    SELECT ${keySql} AS key, ${labelSql} AS label,
      COUNT(DISTINCT u."id")::bigint AS headcount,
      COUNT(a."id")::bigint AS assigned,
      COUNT(a."id") FILTER (WHERE a."status" = 'COMPLETED')::bigint AS completed,
      COUNT(a."id") FILTER (WHERE a."status" = 'OVERDUE')::bigint AS overdue
    FROM "User" u
    ${joinSql}
    LEFT JOIN "Assignment" a ON a."userId" = u."id"
    WHERE u."status" = 'ACTIVE' ${visibleFilter} ${buFilter}
    GROUP BY ${keySql}, ${labelSql}
    ORDER BY ${labelSql} ASC NULLS LAST
    LIMIT ${take} OFFSET ${skip}
  `;

  const totalRows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(DISTINCT ${keySql})::bigint AS count
    FROM "User" u
    ${joinSql}
    WHERE u."status" = 'ACTIVE' ${visibleFilter} ${buFilter}
  `;

  return {
    rows: rows.map((r) => ({
      group: r.label ?? "Unassigned",
      headcount: Number(r.headcount),
      assigned: Number(r.assigned),
      completed: Number(r.completed),
      overdue: Number(r.overdue),
      completionRate: pct(Number(r.completed), Number(r.assigned)),
    })),
    total: Number(totalRows[0]?.count ?? 0),
  };
}

const trainingByManager = (actor: Actor, params: ReportRunParams) =>
  runTrainingByDimension(actor, params, Prisma.sql`LEFT JOIN "User" m ON m."id" = u."managerId"`, Prisma.sql`m."id"`, Prisma.sql`m."name"`);

const trainingByDepartment = (actor: Actor, params: ReportRunParams) =>
  runTrainingByDimension(actor, params, Prisma.sql`LEFT JOIN "Department" d ON d."id" = u."departmentId"`, Prisma.sql`d."id"`, Prisma.sql`d."name"`);

const trainingByBusinessUnit = (actor: Actor, params: ReportRunParams) =>
  runTrainingByDimension(actor, params, Prisma.sql`LEFT JOIN "BusinessUnit" bu ON bu."id" = u."businessUnitId"`, Prisma.sql`bu."id"`, Prisma.sql`bu."name"`);

const trainingByCountry = (actor: Actor, params: ReportRunParams) =>
  runTrainingByDimension(actor, params, Prisma.empty, Prisma.sql`u."country"`, Prisma.sql`u."country"`);

const trainingByLocation = (actor: Actor, params: ReportRunParams) =>
  runTrainingByDimension(actor, params, Prisma.sql`LEFT JOIN "Location" l ON l."id" = u."locationId"`, Prisma.sql`l."id"`, Prisma.sql`l."name"`);

const trainingByWorkerType = (actor: Actor, params: ReportRunParams) =>
  runTrainingByDimension(actor, params, Prisma.empty, Prisma.sql`u."workerType"`, Prisma.sql`u."workerType"`);

// ---------------------------------------------------------------------------
// 18 & 19. SOP Acknowledgement / Policy Acknowledgement
// ---------------------------------------------------------------------------

async function runAcknowledgementReport(actor: Actor, params: ReportRunParams, kind: "SOP" | "POLICY"): Promise<ReportRunResult> {
  const { skip, take } = clampPage(params);
  const visible = await getVisibleUserIds(actor);
  const acknowledgedAt = dateFilter(params.filters);

  const where: Prisma.AcknowledgementWhereInput = {
    sopVersionId: { not: null },
    sopVersion: { sop: { kind } },
    ...(visible === "ALL" ? {} : { userId: { in: visible } }),
    ...(acknowledgedAt ? { acknowledgedAt } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.acknowledgement.findMany({
      where,
      orderBy: { acknowledgedAt: "desc" },
      skip,
      take,
      include: { user: { select: { name: true, email: true } }, sopVersion: { select: { versionNumber: true, title: true, sop: { select: { sopCode: true } } } } },
    }),
    prisma.acknowledgement.count({ where }),
  ]);

  return {
    rows: rows.map((a) => ({
      person: a.user.name,
      email: a.user.email,
      code: a.sopVersion?.sop.sopCode ?? "—",
      title: a.sopVersion?.title ?? "—",
      versionLabel: a.sopVersion?.versionNumber ?? "—",
      acknowledgedAt: a.acknowledgedAt,
      method: a.signatureMethod,
    })),
    total,
  };
}

// ---------------------------------------------------------------------------
// 20. Content Version
// ---------------------------------------------------------------------------

async function runContentVersion(actor: Actor, params: ReportRunParams): Promise<ReportRunResult> {
  const { skip, take } = clampPage(params);
  const entityType = params.filters.entityType;
  const publishedAt = dateFilter(params.filters);

  const [sopVersions, courseVersions] = await Promise.all([
    entityType === "COURSE"
      ? []
      : prisma.sopVersion.findMany({
          where: publishedAt ? { publishedAt } : {},
          select: { id: true, title: true, versionNumber: true, changeSummary: true, isMaterial: true, publishedAt: true, authorId: true, sop: { select: { sopCode: true } } },
        }),
    entityType === "SOP"
      ? []
      : prisma.courseVersion.findMany({
          where: publishedAt ? { publishedAt } : {},
          select: { id: true, title: true, versionNumber: true, changeSummary: true, publishedAt: true, authorId: true },
        }),
  ]);

  const authorIds = [...new Set([...sopVersions.map((v) => v.authorId), ...courseVersions.map((v) => v.authorId)])];
  const authors = authorIds.length ? await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } }) : [];
  const authorName = new Map(authors.map((a) => [a.id, a.name]));

  const combined = [
    ...sopVersions.map((v) => ({
      entityType: "SOP" as const,
      title: `${v.sop.sopCode} — ${v.title}`,
      versionLabel: v.versionNumber,
      changeSummary: v.changeSummary,
      material: v.isMaterial,
      publishedAt: v.publishedAt,
      author: authorName.get(v.authorId) ?? "—",
    })),
    ...courseVersions.map((v) => ({
      entityType: "COURSE" as const,
      title: v.title,
      versionLabel: v.versionNumber,
      changeSummary: v.changeSummary,
      material: true,
      publishedAt: v.publishedAt,
      author: authorName.get(v.authorId) ?? "—",
    })),
  ].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  return { rows: combined.slice(skip, skip + take), total: combined.length };
}

// ---------------------------------------------------------------------------
// 21. Content Health
// ---------------------------------------------------------------------------

export interface ContentHealthBucket {
  entityType: "SOP" | "COURSE";
  entityId: string;
  title: string;
  metric: string;
  value: number;
  detail: string;
}

/**
 * Aggregated content-quality signals. Shared by the Content Health admin page
 * and the content_health report definition below.
 */
export async function getContentHealth(limit = 10): Promise<{
  mostViewed: ContentHealthBucket[];
  leastViewed: ContentHealthBucket[];
  lowestRated: ContentHealthBucket[];
  mostReported: ContentHealthBucket[];
  mostFailedQuizzes: ContentHealthBucket[];
  noOwner: ContentHealthBucket[];
  brokenLinks: ContentHealthBucket[];
  reviewOverdue: ContentHealthBucket[];
}> {
  const [viewCounts, publishedSops, publishedCourses, feedback, outdatedReports, quizAttempts, lessons, brokenLinkEvents, overdueSops] =
    await Promise.all([
      prisma.contentView.groupBy({ by: ["entityType", "entityId"], _count: { _all: true } }),
      prisma.sop.findMany({ where: { isDeleted: false, status: "PUBLISHED" }, select: { id: true, title: true, sopCode: true, ownerId: true } }),
      prisma.course.findMany({ where: { isDeleted: false, status: "PUBLISHED" }, select: { id: true, title: true, ownerId: true } }),
      prisma.contentFeedback.groupBy({ by: ["entityType", "entityId", "type"], _count: { _all: true } }),
      prisma.outdatedReport.groupBy({ by: ["sopId"], where: { status: "OPEN" }, _count: { _all: true } }),
      prisma.quizAttempt.groupBy({ by: ["lessonId", "status"], _count: { _all: true } }),
      prisma.lesson.findMany({ where: { type: "QUIZ" }, select: { id: true, title: true, section: { select: { course: { select: { id: true, title: true } } } } } }),
      prisma.analyticsEvent.findMany({
        where: { event: "broken_link_detected", createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      prisma.sop.findMany({
        where: { isDeleted: false, status: "PUBLISHED", nextReviewAt: { lt: new Date() } },
        select: { id: true, title: true, sopCode: true, nextReviewAt: true },
      }),
    ]);

  const titleFor = (entityType: string, entityId: string): string => {
    if (entityType === "SOP") {
      const sop = publishedSops.find((s) => s.id === entityId);
      return sop ? `${sop.sopCode} — ${sop.title}` : entityId;
    }
    const course = publishedCourses.find((c) => c.id === entityId);
    return course?.title ?? entityId;
  };

  const viewsByEntity = viewCounts
    .filter((v) => v.entityType === "SOP" || v.entityType === "COURSE")
    .map((v) => ({ entityType: v.entityType as "SOP" | "COURSE", entityId: v.entityId, count: v._count._all }));

  const mostViewed = [...viewsByEntity]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((v) => ({ entityType: v.entityType, entityId: v.entityId, title: titleFor(v.entityType, v.entityId), metric: "views", value: v.count, detail: `${v.count} views (last recorded)` }));

  const viewedIds = new Set(viewsByEntity.map((v) => `${v.entityType}:${v.entityId}`));
  const allPublished: { entityType: "SOP" | "COURSE"; entityId: string }[] = [
    ...publishedSops.map((s) => ({ entityType: "SOP" as const, entityId: s.id })),
    ...publishedCourses.map((c) => ({ entityType: "COURSE" as const, entityId: c.id })),
  ];
  const leastViewed = allPublished
    .map((e) => ({ ...e, count: viewsByEntity.find((v) => v.entityType === e.entityType && v.entityId === e.entityId)?.count ?? 0 }))
    .sort((a, b) => a.count - b.count)
    .slice(0, limit)
    .map((v) => ({ entityType: v.entityType, entityId: v.entityId, title: titleFor(v.entityType, v.entityId), metric: "views", value: v.count, detail: viewedIds.has(`${v.entityType}:${v.entityId}`) ? `${v.count} views` : "Never viewed" }));

  const feedbackByEntity = new Map<string, { helpful: number; notClear: number; outdated: number; question: number }>();
  for (const f of feedback) {
    if (f.entityType !== "SOP" && f.entityType !== "COURSE") continue;
    const key = `${f.entityType}:${f.entityId}`;
    const bucket = feedbackByEntity.get(key) ?? { helpful: 0, notClear: 0, outdated: 0, question: 0 };
    if (f.type === "HELPFUL") bucket.helpful += f._count._all;
    if (f.type === "NOT_CLEAR") bucket.notClear += f._count._all;
    if (f.type === "OUTDATED") bucket.outdated += f._count._all;
    if (f.type === "QUESTION") bucket.question += f._count._all;
    feedbackByEntity.set(key, bucket);
  }
  const lowestRated = [...feedbackByEntity.entries()]
    .map(([key, b]) => {
      const [entityType, entityId] = key.split(":") as ["SOP" | "COURSE", string];
      const total = b.helpful + b.notClear + b.outdated + b.question;
      return { entityType, entityId, rate: pct(b.helpful, total), total };
    })
    .filter((r) => r.total >= 1)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, limit)
    .map((r) => ({ entityType: r.entityType, entityId: r.entityId, title: titleFor(r.entityType, r.entityId), metric: "helpful_rate", value: r.rate, detail: `${r.rate}% helpful of ${r.total} responses` }));

  const mostReported = outdatedReports
    .sort((a, b) => b._count._all - a._count._all)
    .slice(0, limit)
    .map((r) => ({ entityType: "SOP" as const, entityId: r.sopId, title: titleFor("SOP", r.sopId), metric: "open_reports", value: r._count._all, detail: `${r._count._all} open "outdated" report(s)` }));

  const quizFailure = new Map<string, { failed: number; total: number }>();
  for (const row of quizAttempts) {
    const bucket = quizFailure.get(row.lessonId) ?? { failed: 0, total: 0 };
    bucket.total += row._count._all;
    if (row.status === "FAILED") bucket.failed += row._count._all;
    quizFailure.set(row.lessonId, bucket);
  }
  const mostFailedQuizzes = [...quizFailure.entries()]
    .map(([lessonId, b]) => {
      const lesson = lessons.find((l) => l.id === lessonId);
      return { lessonId, course: lesson?.section.course, title: lesson?.title ?? lessonId, rate: pct(b.failed, b.total), total: b.total };
    })
    .filter((r) => r.total >= 3)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, limit)
    .map((r) => ({
      entityType: "COURSE" as const,
      entityId: r.course?.id ?? r.lessonId,
      title: r.course ? `${r.course.title} — ${r.title}` : r.title,
      metric: "quiz_failure_rate",
      value: r.rate,
      detail: `${r.rate}% failure rate over ${r.total} attempts`,
    }));

  const noOwner = [
    ...publishedSops.filter((s) => !s.ownerId).map((s) => ({ entityType: "SOP" as const, entityId: s.id, title: `${s.sopCode} — ${s.title}`, metric: "no_owner", value: 1, detail: "No owner assigned" })),
    ...publishedCourses.filter((c) => !c.ownerId).map((c) => ({ entityType: "COURSE" as const, entityId: c.id, title: c.title, metric: "no_owner", value: 1, detail: "No owner assigned" })),
  ].slice(0, limit);

  const brokenLinkCounts = new Map<string, { count: number; sample: string }>();
  for (const event of brokenLinkEvents) {
    const key = `${event.entityType}:${event.entityId}`;
    const bucket = brokenLinkCounts.get(key) ?? { count: 0, sample: "" };
    bucket.count += 1;
    const meta = event.metadata as { url?: string } | null;
    bucket.sample = meta?.url ?? bucket.sample;
    brokenLinkCounts.set(key, bucket);
  }
  const brokenLinks = [...brokenLinkCounts.entries()]
    .slice(0, limit)
    .map(([key, b]) => {
      const [entityType, entityId] = key.split(":") as ["SOP" | "COURSE", string];
      return { entityType, entityId, title: titleFor(entityType, entityId), metric: "broken_links", value: b.count, detail: b.sample || "Link check failed" };
    });

  const reviewOverdue = overdueSops.slice(0, limit).map((s) => ({
    entityType: "SOP" as const,
    entityId: s.id,
    title: `${s.sopCode} — ${s.title}`,
    metric: "review_overdue",
    value: s.nextReviewAt ? Math.floor((Date.now() - s.nextReviewAt.getTime()) / (24 * 60 * 60 * 1000)) : 0,
    detail: s.nextReviewAt ? `Review was due ${s.nextReviewAt.toISOString().slice(0, 10)}` : "Review overdue",
  }));

  return { mostViewed, leastViewed, lowestRated, mostReported, mostFailedQuizzes, noOwner, brokenLinks, reviewOverdue };
}

async function runContentHealthReport(_actor: Actor, params: ReportRunParams): Promise<ReportRunResult> {
  const { skip, take } = clampPage(params);
  const health = await getContentHealth(50);
  const metric = params.filters.metric;

  const all: ContentHealthBucket[] = metric
    ? (health as unknown as Record<string, ContentHealthBucket[]>)[metric] ?? []
    : [
        ...health.mostViewed,
        ...health.leastViewed,
        ...health.lowestRated,
        ...health.mostReported,
        ...health.mostFailedQuizzes,
        ...health.noOwner,
        ...health.brokenLinks,
        ...health.reviewOverdue,
      ];

  return { rows: all.slice(skip, skip + take) as unknown as Record<string, unknown>[], total: all.length };
}

// ---------------------------------------------------------------------------
// 22. Skill Matrix
// ---------------------------------------------------------------------------

async function runSkillMatrix(actor: Actor, params: ReportRunParams): Promise<ReportRunResult> {
  const { skip, take } = clampPage(params);
  const userWhere = await scopedUserWhere(actor, {
    ...(params.filters.departmentId ? { departmentId: params.filters.departmentId } : {}),
  });

  const where: Prisma.UserSkillWhereInput = {
    user: userWhere,
    ...(params.filters.skillId ? { skillId: params.filters.skillId } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.userSkill.findMany({
      where,
      orderBy: [{ user: { name: "asc" } }, { skill: { name: "asc" } }],
      skip,
      take,
      include: { user: { select: { name: true, email: true } }, skill: { select: { name: true, category: true } } },
    }),
    prisma.userSkill.count({ where }),
  ]);

  return {
    rows: rows.map((r) => ({
      person: r.user.name,
      email: r.user.email,
      skill: r.skill.name,
      category: r.skill.category,
      level: r.level,
      source: r.source,
      updatedAt: r.updatedAt,
    })),
    total,
  };
}

async function skillOptions(): Promise<FilterOption[]> {
  const rows = await prisma.skill.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

// ---------------------------------------------------------------------------
// 23. Skill Gap
// ---------------------------------------------------------------------------

async function runSkillGap(actor: Actor, params: ReportRunParams): Promise<ReportRunResult> {
  const { skip, take } = clampPage(params);
  const userWhere = await scopedUserWhere(actor, {
    positionId: { not: null },
    ...(params.filters.departmentId ? { departmentId: params.filters.departmentId } : {}),
  });

  const users = await prisma.user.findMany({
    where: userWhere,
    select: {
      id: true,
      name: true,
      email: true,
      position: { select: { title: true, skillRequirements: { select: { skillId: true, requiredLevel: true, required: true, skill: { select: { name: true } } } } } },
      skills: { select: { skillId: true, level: true } },
    },
  });

  const gaps: Record<string, unknown>[] = [];
  for (const u of users) {
    if (!u.position) continue;
    const levelBySkill = new Map(u.skills.map((s) => [s.skillId, s.level]));
    for (const req of u.position.skillRequirements) {
      const current = levelBySkill.get(req.skillId) ?? 0;
      if (current < req.requiredLevel) {
        gaps.push({
          person: u.name,
          email: u.email,
          position: u.position.title,
          skill: req.skill.name,
          requiredLevel: req.requiredLevel,
          currentLevel: current,
          gap: req.requiredLevel - current,
          required: req.required,
        });
      }
    }
  }

  gaps.sort((a, b) => (b.gap as number) - (a.gap as number));
  return { rows: gaps.slice(skip, skip + take), total: gaps.length };
}

// ---------------------------------------------------------------------------
// 24. Course Effectiveness
// ---------------------------------------------------------------------------

async function runCourseEffectiveness(_actor: Actor, params: ReportRunParams): Promise<ReportRunResult> {
  const { skip, take } = clampPage(params);

  const where: Prisma.CourseWhereInput = { isDeleted: false, status: "PUBLISHED", ...(params.filters.q ? { title: { contains: params.filters.q, mode: "insensitive" } } : {}) };

  const [courses, total] = await Promise.all([
    prisma.course.findMany({ where, orderBy: { title: "asc" }, skip, take, select: { id: true, title: true } }),
    prisma.course.count({ where }),
  ]);
  const courseIds = courses.map((c) => c.id);
  if (courseIds.length === 0) return { rows: [], total };

  const [assignedCounts, completions, lessonIds, feedbackCounts] = await Promise.all([
    prisma.assignment.groupBy({ by: ["courseId"], where: { courseId: { in: courseIds } }, _count: { _all: true } }),
    prisma.completionRecord.findMany({ where: { courseId: { in: courseIds } }, select: { courseId: true, scorePercent: true, durationMinutes: true } }),
    prisma.lesson.findMany({ where: { section: { courseId: { in: courseIds } }, type: "QUIZ" }, select: { id: true, section: { select: { courseId: true } } } }),
    prisma.contentFeedback.groupBy({ by: ["entityId", "type"], where: { entityType: "COURSE", entityId: { in: courseIds } }, _count: { _all: true } }),
  ]);

  const lessonToCourse = new Map(lessonIds.map((l) => [l.id, l.section.courseId]));
  const quizAttempts = lessonIds.length
    ? await prisma.quizAttempt.findMany({ where: { lessonId: { in: [...lessonToCourse.keys()] }, status: { in: ["PASSED", "FAILED"] } }, select: { lessonId: true, status: true } })
    : [];

  const assignedByCourseCount = new Map(assignedCounts.map((a) => [a.courseId as string, a._count._all]));
  const completionsByCourse = new Map<string, { count: number; scoreSum: number; scoreN: number; durationSum: number; durationN: number }>();
  for (const c of completions) {
    if (!c.courseId) continue;
    const bucket = completionsByCourse.get(c.courseId) ?? { count: 0, scoreSum: 0, scoreN: 0, durationSum: 0, durationN: 0 };
    bucket.count += 1;
    if (c.scorePercent !== null) {
      bucket.scoreSum += c.scorePercent;
      bucket.scoreN += 1;
    }
    if (c.durationMinutes !== null) {
      bucket.durationSum += c.durationMinutes;
      bucket.durationN += 1;
    }
    completionsByCourse.set(c.courseId, bucket);
  }

  const failByCourse = new Map<string, { failed: number; total: number }>();
  for (const attempt of quizAttempts) {
    const courseId = lessonToCourse.get(attempt.lessonId);
    if (!courseId) continue;
    const bucket = failByCourse.get(courseId) ?? { failed: 0, total: 0 };
    bucket.total += 1;
    if (attempt.status === "FAILED") bucket.failed += 1;
    failByCourse.set(courseId, bucket);
  }

  const feedbackByCourse = new Map<string, { helpful: number; total: number }>();
  for (const f of feedbackCounts) {
    const bucket = feedbackByCourse.get(f.entityId) ?? { helpful: 0, total: 0 };
    bucket.total += f._count._all;
    if (f.type === "HELPFUL") bucket.helpful += f._count._all;
    feedbackByCourse.set(f.entityId, bucket);
  }

  return {
    rows: courses.map((course) => {
      const assigned = assignedByCourseCount.get(course.id) ?? 0;
      const completion = completionsByCourse.get(course.id);
      const failure = failByCourse.get(course.id);
      const fb = feedbackByCourse.get(course.id);
      return {
        course: course.title,
        assigned,
        completed: completion?.count ?? 0,
        completionRate: pct(completion?.count ?? 0, assigned),
        avgScore: completion && completion.scoreN > 0 ? round(completion.scoreSum / completion.scoreN, 1) : null,
        quizFailureRate: failure ? pct(failure.failed, failure.total) : null,
        avgDurationMinutes: completion && completion.durationN > 0 ? round(completion.durationSum / completion.durationN) : null,
        helpfulRate: fb && fb.total > 0 ? pct(fb.helpful, fb.total) : null,
      };
    }),
    total,
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const PERSON_FILTER: FilterSpec = { key: "personId", label: "Person", type: "person" };
const Q_FILTER: FilterSpec = { key: "q", label: "Search", type: "text", placeholder: "Search by title…" };

export const REPORTS: ReportDefinition[] = [
  {
    key: "training_completion",
    name: "Training Completion",
    description: "Every completion event across courses, SOPs, and learning paths.",
    category: "Completion",
    permission: "reports.view",
    filters: [...DATE_RANGE_FILTERS, ...ORG_FILTERS],
    columns: [
      { key: "person", label: "Person" },
      { key: "title", label: "Title", width: 2 },
      { key: "type", label: "Type" },
      { key: "versionLabel", label: "Version" },
      { key: "completedAt", label: "Completed", format: "date" },
      { key: "scorePercent", label: "Score", format: "percent" },
      { key: "expiresAt", label: "Expires", format: "date" },
      { key: "certificateNumber", label: "Certificate #" },
    ],
    run: runTrainingCompletion,
  },
  {
    key: "individual_transcript",
    name: "Individual Training Transcript",
    description: "Full completion and acknowledgement history for one person.",
    category: "Completion",
    permission: "reports.view",
    filters: [PERSON_FILTER],
    columns: [
      { key: "kind", label: "Kind" },
      { key: "title", label: "Title", width: 2 },
      { key: "versionLabel", label: "Version" },
      { key: "completedAt", label: "Completed", format: "date" },
      { key: "scorePercent", label: "Score", format: "percent" },
      { key: "certificateNumber", label: "Certificate #" },
      { key: "expiresAt", label: "Expires", format: "date" },
    ],
    run: runIndividualTranscript,
  },
  {
    key: "course_completion",
    name: "Course Completion",
    description: "Course-only completion records with scores and durations.",
    category: "Completion",
    permission: "reports.view",
    filters: [...DATE_RANGE_FILTERS, ...ORG_FILTERS, Q_FILTER],
    columns: [
      { key: "person", label: "Person" },
      { key: "course", label: "Course", width: 2 },
      { key: "versionLabel", label: "Version" },
      { key: "completedAt", label: "Completed", format: "date" },
      { key: "scorePercent", label: "Score", format: "percent" },
      { key: "attemptCount", label: "Attempts", format: "number" },
      { key: "durationMinutes", label: "Duration (min)", format: "number" },
      { key: "certificateNumber", label: "Certificate #" },
    ],
    run: runCourseCompletion,
  },
  {
    key: "learning_path_progress",
    name: "Learning Path Progress",
    description: "Progress through assigned learning paths.",
    category: "Progress",
    permission: "reports.view",
    filters: [
      { key: "status", label: "Status", type: "select", options: ["ASSIGNED", "IN_PROGRESS", "COMPLETED", "OVERDUE", "WAIVED"].map((v) => ({ value: v, label: v })) },
    ],
    columns: [
      { key: "person", label: "Person" },
      { key: "path", label: "Learning path", width: 2 },
      { key: "status", label: "Status", format: "badge" },
      { key: "assignedAt", label: "Assigned", format: "date" },
      { key: "dueAt", label: "Due", format: "date" },
      { key: "percentComplete", label: "% complete", format: "percent" },
    ],
    run: runLearningPathProgress,
  },
  {
    key: "onboarding_progress",
    name: "Onboarding Progress",
    description: "New hires (by start date) and progress through their onboarding learning path.",
    category: "Progress",
    permission: "reports.view",
    filters: [...DATE_RANGE_FILTERS, ...ORG_FILTERS],
    columns: [
      { key: "person", label: "Person" },
      { key: "manager", label: "Manager" },
      { key: "startDate", label: "Start date", format: "date" },
      { key: "daysSinceStart", label: "Days since start", format: "number" },
      { key: "onboardingPath", label: "Onboarding path", width: 2 },
      { key: "percentComplete", label: "% complete", format: "percent" },
    ],
    run: runOnboardingProgress,
  },
  {
    key: "overdue_training",
    name: "Overdue Training",
    description: "Assignments past their due date and not completed.",
    category: "Compliance",
    permission: "reports.view",
    filters: [...ORG_FILTERS, { key: "locationId", label: "Location", type: "select", options: locationOptions }],
    columns: [
      { key: "person", label: "Person" },
      { key: "manager", label: "Manager" },
      { key: "title", label: "Title", width: 2 },
      { key: "type", label: "Type" },
      { key: "dueAt", label: "Due", format: "date" },
      { key: "daysOverdue", label: "Days overdue", format: "number" },
    ],
    run: runOverdueTraining,
  },
  {
    key: "certification",
    name: "Certification",
    description: "Issued certificates and their current validity.",
    category: "Compliance",
    permission: "reports.view",
    filters: [...DATE_RANGE_FILTERS, Q_FILTER],
    columns: [
      { key: "person", label: "Person" },
      { key: "course", label: "Course", width: 2 },
      { key: "certificateNumber", label: "Certificate #" },
      { key: "issuedAt", label: "Issued", format: "date" },
      { key: "expiresAt", label: "Expires", format: "date" },
      { key: "status", label: "Status", format: "badge" },
    ],
    run: runCertification,
  },
  {
    key: "certification_expiration",
    name: "Certification Expiration",
    description: "Certificates expiring within a chosen window.",
    category: "Compliance",
    permission: "reports.view",
    filters: [{ key: "daysAhead", label: "Days ahead", type: "text", placeholder: "60" }],
    columns: [
      { key: "person", label: "Person" },
      { key: "manager", label: "Manager" },
      { key: "course", label: "Course", width: 2 },
      { key: "certificateNumber", label: "Certificate #" },
      { key: "expiresAt", label: "Expires", format: "date" },
      { key: "daysRemaining", label: "Days remaining", format: "number" },
    ],
    run: runCertificationExpiration,
  },
  {
    key: "assessment_scores",
    name: "Assessment Scores",
    description: "Graded quiz attempts with final scores.",
    category: "Assessments",
    permission: "reports.view",
    filters: DATE_RANGE_FILTERS,
    columns: [
      { key: "person", label: "Person" },
      { key: "course", label: "Course" },
      { key: "quiz", label: "Quiz", width: 2 },
      { key: "attemptNumber", label: "Attempt #", format: "number" },
      { key: "scorePercent", label: "Score", format: "percent" },
      { key: "status", label: "Status", format: "badge" },
      { key: "submittedAt", label: "Submitted", format: "date" },
    ],
    run: runAssessmentScores,
  },
  {
    key: "assessment_attempts",
    name: "Assessment Attempts",
    description: "The full quiz attempt log, including in-progress attempts.",
    category: "Assessments",
    permission: "reports.view",
    filters: [...DATE_RANGE_FILTERS, { key: "status", label: "Status", type: "select", options: ["IN_PROGRESS", "SUBMITTED", "GRADED", "PASSED", "FAILED"].map((v) => ({ value: v, label: v })) }],
    columns: [
      { key: "person", label: "Person" },
      { key: "course", label: "Course" },
      { key: "quiz", label: "Quiz", width: 2 },
      { key: "attemptNumber", label: "Attempt #", format: "number" },
      { key: "status", label: "Status", format: "badge" },
      { key: "startedAt", label: "Started", format: "date" },
      { key: "gradedAt", label: "Graded", format: "date" },
    ],
    run: runAssessmentAttempts,
  },
  {
    key: "training_matrix",
    name: "Training Matrix",
    description: "People-by-requirement compliance matrix, flattened to one row per person and requirement.",
    category: "Compliance",
    permission: "reports.view",
    filters: [
      { key: "rowMode", label: "Rows", type: "select", options: [{ value: "people", label: "People" }, { value: "positions", label: "Positions" }] },
      { key: "departmentId", label: "Department", type: "select", options: departmentOptions },
      { key: "workerType", label: "Worker type", type: "select", options: WORKER_TYPE_OPTIONS },
    ],
    columns: [
      { key: "person", label: "Person" },
      { key: "sublabel", label: "Detail" },
      { key: "requirement", label: "Requirement", width: 2 },
      { key: "status", label: "Status", format: "badge" },
    ],
    run: runTrainingMatrix,
  },
  {
    key: "training_by_manager",
    name: "Training by Manager",
    description: "Completion rate rolled up by direct manager.",
    category: "Rollups",
    permission: "reports.view",
    filters: [{ key: "businessUnitId", label: "Business unit", type: "select", options: businessUnitOptions }],
    columns: [
      { key: "group", label: "Manager", width: 2 },
      { key: "headcount", label: "Headcount", format: "number" },
      { key: "assigned", label: "Assigned", format: "number" },
      { key: "completed", label: "Completed", format: "number" },
      { key: "overdue", label: "Overdue", format: "number" },
      { key: "completionRate", label: "Completion rate", format: "percent" },
    ],
    run: trainingByManager,
  },
  {
    key: "training_by_department",
    name: "Training by Department",
    description: "Completion rate rolled up by department.",
    category: "Rollups",
    permission: "reports.view",
    filters: [{ key: "businessUnitId", label: "Business unit", type: "select", options: businessUnitOptions }],
    columns: [
      { key: "group", label: "Department", width: 2 },
      { key: "headcount", label: "Headcount", format: "number" },
      { key: "assigned", label: "Assigned", format: "number" },
      { key: "completed", label: "Completed", format: "number" },
      { key: "overdue", label: "Overdue", format: "number" },
      { key: "completionRate", label: "Completion rate", format: "percent" },
    ],
    run: trainingByDepartment,
  },
  {
    key: "training_by_business_unit",
    name: "Training by Business Unit",
    description: "Completion rate rolled up by business unit.",
    category: "Rollups",
    permission: "reports.view",
    filters: [],
    columns: [
      { key: "group", label: "Business unit", width: 2 },
      { key: "headcount", label: "Headcount", format: "number" },
      { key: "assigned", label: "Assigned", format: "number" },
      { key: "completed", label: "Completed", format: "number" },
      { key: "overdue", label: "Overdue", format: "number" },
      { key: "completionRate", label: "Completion rate", format: "percent" },
    ],
    run: trainingByBusinessUnit,
  },
  {
    key: "training_by_country",
    name: "Training by Country",
    description: "Completion rate rolled up by country.",
    category: "Rollups",
    permission: "reports.view",
    filters: [{ key: "businessUnitId", label: "Business unit", type: "select", options: businessUnitOptions }],
    columns: [
      { key: "group", label: "Country", width: 2 },
      { key: "headcount", label: "Headcount", format: "number" },
      { key: "assigned", label: "Assigned", format: "number" },
      { key: "completed", label: "Completed", format: "number" },
      { key: "overdue", label: "Overdue", format: "number" },
      { key: "completionRate", label: "Completion rate", format: "percent" },
    ],
    run: trainingByCountry,
  },
  {
    key: "training_by_location",
    name: "Training by Location",
    description: "Completion rate rolled up by office location.",
    category: "Rollups",
    permission: "reports.view",
    filters: [{ key: "businessUnitId", label: "Business unit", type: "select", options: businessUnitOptions }],
    columns: [
      { key: "group", label: "Location", width: 2 },
      { key: "headcount", label: "Headcount", format: "number" },
      { key: "assigned", label: "Assigned", format: "number" },
      { key: "completed", label: "Completed", format: "number" },
      { key: "overdue", label: "Overdue", format: "number" },
      { key: "completionRate", label: "Completion rate", format: "percent" },
    ],
    run: trainingByLocation,
  },
  {
    key: "training_by_worker_type",
    name: "Training by Worker Type",
    description: "Completion rate rolled up by employment type.",
    category: "Rollups",
    permission: "reports.view",
    filters: [{ key: "businessUnitId", label: "Business unit", type: "select", options: businessUnitOptions }],
    columns: [
      { key: "group", label: "Worker type", width: 2 },
      { key: "headcount", label: "Headcount", format: "number" },
      { key: "assigned", label: "Assigned", format: "number" },
      { key: "completed", label: "Completed", format: "number" },
      { key: "overdue", label: "Overdue", format: "number" },
      { key: "completionRate", label: "Completion rate", format: "percent" },
    ],
    run: trainingByWorkerType,
  },
  {
    key: "sop_acknowledgement",
    name: "SOP Acknowledgement",
    description: "Who has acknowledged which SOP version.",
    category: "Compliance",
    permission: "reports.view",
    filters: DATE_RANGE_FILTERS,
    columns: [
      { key: "person", label: "Person" },
      { key: "code", label: "Code" },
      { key: "title", label: "SOP", width: 2 },
      { key: "versionLabel", label: "Version" },
      { key: "acknowledgedAt", label: "Acknowledged", format: "date" },
      { key: "method", label: "Method" },
    ],
    run: (actor, params) => runAcknowledgementReport(actor, params, "SOP"),
  },
  {
    key: "policy_acknowledgement",
    name: "Policy Acknowledgement",
    description: "Who has acknowledged which policy version.",
    category: "Compliance",
    permission: "reports.view",
    filters: DATE_RANGE_FILTERS,
    columns: [
      { key: "person", label: "Person" },
      { key: "code", label: "Code" },
      { key: "title", label: "Policy", width: 2 },
      { key: "versionLabel", label: "Version" },
      { key: "acknowledgedAt", label: "Acknowledged", format: "date" },
      { key: "method", label: "Method" },
    ],
    run: (actor, params) => runAcknowledgementReport(actor, params, "POLICY"),
  },
  {
    key: "content_version",
    name: "Content Version",
    description: "Every published SOP and course version.",
    category: "Content",
    permission: "training.create",
    filters: [
      ...DATE_RANGE_FILTERS,
      { key: "entityType", label: "Type", type: "select", options: [{ value: "SOP", label: "SOP" }, { value: "COURSE", label: "Course" }] },
    ],
    columns: [
      { key: "entityType", label: "Type" },
      { key: "title", label: "Title", width: 2 },
      { key: "versionLabel", label: "Version" },
      { key: "changeSummary", label: "Change summary", width: 2 },
      { key: "author", label: "Author" },
      { key: "publishedAt", label: "Published", format: "date" },
    ],
    run: runContentVersion,
  },
  {
    key: "content_health",
    name: "Content Health",
    description: "Views, ratings, reports, quiz failure rates, ownership, links, and review status.",
    category: "Content",
    permission: "training.create",
    filters: [
      {
        key: "metric",
        label: "Metric",
        type: "select",
        options: [
          { value: "mostViewed", label: "Most viewed" },
          { value: "leastViewed", label: "Least viewed" },
          { value: "lowestRated", label: "Lowest rated" },
          { value: "mostReported", label: "Most reported outdated" },
          { value: "mostFailedQuizzes", label: "Highest quiz failure rate" },
          { value: "noOwner", label: "No owner" },
          { value: "brokenLinks", label: "Broken links" },
          { value: "reviewOverdue", label: "Review overdue" },
        ],
      },
    ],
    columns: [
      { key: "entityType", label: "Type" },
      { key: "title", label: "Title", width: 2 },
      { key: "metric", label: "Metric" },
      { key: "value", label: "Value", format: "number" },
      { key: "detail", label: "Detail", width: 2 },
    ],
    run: runContentHealthReport,
  },
  {
    key: "skill_matrix",
    name: "Skill Matrix",
    description: "Recorded skill levels by person.",
    category: "Skills",
    permission: "skills.view",
    filters: [{ key: "departmentId", label: "Department", type: "select", options: departmentOptions }, { key: "skillId", label: "Skill", type: "select", options: skillOptions }],
    columns: [
      { key: "person", label: "Person" },
      { key: "skill", label: "Skill", width: 2 },
      { key: "category", label: "Category" },
      { key: "level", label: "Level", format: "number" },
      { key: "source", label: "Source" },
      { key: "updatedAt", label: "Updated", format: "date" },
    ],
    run: runSkillMatrix,
  },
  {
    key: "skill_gap",
    name: "Skill Gap",
    description: "People whose current skill level falls short of their position's requirement.",
    category: "Skills",
    permission: "skills.view",
    filters: [{ key: "departmentId", label: "Department", type: "select", options: departmentOptions }],
    columns: [
      { key: "person", label: "Person" },
      { key: "position", label: "Position" },
      { key: "skill", label: "Skill", width: 2 },
      { key: "requiredLevel", label: "Required", format: "number" },
      { key: "currentLevel", label: "Current", format: "number" },
      { key: "gap", label: "Gap", format: "number" },
    ],
    run: runSkillGap,
  },
  {
    key: "course_effectiveness",
    name: "Course Effectiveness",
    description: "Completion rate, scores, quiz failure rate, and feedback per course.",
    category: "Content",
    permission: "reports.view",
    filters: [Q_FILTER],
    columns: [
      { key: "course", label: "Course", width: 2 },
      { key: "assigned", label: "Assigned", format: "number" },
      { key: "completed", label: "Completed", format: "number" },
      { key: "completionRate", label: "Completion rate", format: "percent" },
      { key: "avgScore", label: "Avg score", format: "percent" },
      { key: "quizFailureRate", label: "Quiz failure rate", format: "percent" },
      { key: "avgDurationMinutes", label: "Avg duration (min)", format: "number" },
      { key: "helpfulRate", label: "Helpful rate", format: "percent" },
    ],
    run: runCourseEffectiveness,
  },
];

export function getReport(key: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.key === key);
}

export function listReportsForActor(actor: Actor): ReportDefinition[] {
  return REPORTS.filter((r) => actor.permissions.has(r.permission));
}

export async function resolveFilterOptions(definition: ReportDefinition): Promise<Record<string, FilterOption[]>> {
  const out: Record<string, FilterOption[]> = {};
  for (const filter of definition.filters) {
    if (Array.isArray(filter.options)) out[filter.key] = filter.options;
    else if (typeof filter.options === "function") out[filter.key] = await filter.options();
  }
  return out;
}

export function reportColumnsForExport(definition: ReportDefinition): ExportColumn[] {
  return definition.columns.map((c) => ({ key: c.key, label: c.label, width: c.width }));
}

// ---------------------------------------------------------------------------
// Scheduled reports
//
// Schedules are persisted as an AppSetting (key "report_schedules") rather
// than a dedicated table, matching the key/value settings model already used
// for brand and feature flags. A worker tick (owned by src/worker) is expected
// to read this list on a timer and enqueue a "run_scheduled_report" job for
// any schedule due to fire, which renders the export and emails it to
// `recipients` — this module only maintains the schedule list itself.
// ---------------------------------------------------------------------------

export interface ReportSchedule {
  id: string;
  reportKey: string;
  name: string;
  params: Record<string, string | undefined>;
  format: "csv" | "xlsx" | "pdf";
  cron: string;
  recipients: string[];
  createdById: string;
  createdAt: string;
  lastRunAt?: string;
}

async function loadSchedules(): Promise<ReportSchedule[]> {
  const settings = await prisma.appSetting.findUnique({ where: { key: "report_schedules" } });
  return Array.isArray(settings?.value) ? (settings.value as unknown as ReportSchedule[]) : [];
}

export async function listReportSchedules(): Promise<ReportSchedule[]> {
  return loadSchedules();
}

export interface ScheduleReportInput {
  reportKey: string;
  name: string;
  params: Record<string, string | undefined>;
  format: "csv" | "xlsx" | "pdf";
  cron: string;
  recipients: string[];
}

async function saveSchedules(schedules: ReportSchedule[], updatedBy: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: "report_schedules" },
    create: { key: "report_schedules", value: schedules as unknown as Prisma.InputJsonValue, updatedBy },
    update: { value: schedules as unknown as Prisma.InputJsonValue, updatedBy },
  });
}

export async function scheduleReport(actor: Actor, input: ScheduleReportInput): Promise<ReportSchedule> {
  const definition = getReport(input.reportKey);
  if (!definition) throw new Error(`Unknown report: ${input.reportKey}`);

  const schedules = await loadSchedules();
  const schedule: ReportSchedule = {
    id: `sched_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    reportKey: input.reportKey,
    name: input.name || definition.name,
    params: input.params,
    format: input.format,
    cron: input.cron,
    recipients: input.recipients,
    createdById: actor.id,
    createdAt: new Date().toISOString(),
  };

  await saveSchedules([...schedules, schedule], actor.id);
  return schedule;
}

export async function deleteReportSchedule(actor: Actor, scheduleId: string): Promise<void> {
  const schedules = await loadSchedules();
  await saveSchedules(
    schedules.filter((s) => s.id !== scheduleId),
    actor.id,
  );
}
