import "server-only";
import { prisma } from "@/lib/db";
import type { AssignmentStatus, Prisma, TrainingTargetType, WorkerType } from "@prisma/client";
import { type Actor, AuthorizationError, getVisibleUserIds } from "@/lib/auth/guard";
import { USER_CONTEXT_INCLUDE, buildUserContext, evaluateCriteria, type UserForContext } from "@/lib/services/assignment";

/**
 * The enterprise training requirements matrix — people or positions as rows,
 * required training as columns, a compact status per cell.
 *
 * Kept to a small, fixed number of queries regardless of column count: one
 * page of rows, one query for the position/compliance requirement set, and
 * one query each for assignments, exemptions, and completions covering every
 * row on the page. Everything else is assembled in memory.
 */

const PAGE_SIZE = 25;

export type MatrixCellState =
  | "NOT_REQUIRED"
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "COMPLETE"
  | "OVERDUE"
  | "EXPIRED"
  | "EXEMPT"
  | "WAIVED";

export interface MatrixColumn {
  key: string;
  targetType: TrainingTargetType;
  courseId: string | null;
  sopId: string | null;
  pathId: string | null;
  title: string;
  source: "position" | "compliance";
}

export interface MatrixRow {
  id: string;
  label: string;
  sublabel: string | null;
  cells: Record<string, MatrixCellState>;
}

export interface TrainingMatrix {
  rowMode: "people" | "positions";
  columns: MatrixColumn[];
  rows: MatrixRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MatrixFilters {
  departmentId?: string;
  managerId?: string;
  locationId?: string;
  country?: string;
  roleKey?: string;
  workerType?: string;
  courseId?: string;
}

interface TargetLike {
  targetType: TrainingTargetType;
  courseId: string | null;
  sopId: string | null;
  pathId: string | null;
}

function targetKey(t: TargetLike): string {
  return `${t.targetType}:${t.courseId ?? ""}:${t.sopId ?? ""}:${t.pathId ?? ""}`;
}

function keyFor(userId: string, t: TargetLike): string {
  return `${userId}:${targetKey(t)}`;
}

interface CellInputs {
  applicable: boolean;
  assignment?: { status: AssignmentStatus };
  exemption?: boolean;
  completion?: { expiresAt: Date | null };
}

function computeCellState(input: CellInputs): MatrixCellState {
  if (input.exemption) return "EXEMPT";
  if (input.assignment) {
    switch (input.assignment.status) {
      case "WAIVED":
        return "WAIVED";
      case "OVERDUE":
        return "OVERDUE";
      case "IN_PROGRESS":
        return "IN_PROGRESS";
      case "EXPIRED":
        return "EXPIRED";
      case "COMPLETED":
        if (input.completion?.expiresAt && input.completion.expiresAt <= new Date()) return "EXPIRED";
        return "COMPLETE";
      case "ASSIGNED":
        return "NOT_STARTED";
    }
  }
  return input.applicable ? "NOT_STARTED" : "NOT_REQUIRED";
}

type PositionRequirementWithTitles = Prisma.PositionTrainingRequirementGetPayload<{
  include: { course: { select: { title: true } }; sop: { select: { title: true } }; path: { select: { title: true } } };
}>;

function buildColumnsWithCompliance(
  positionReqs: PositionRequirementWithTitles[],
  complianceRules: { name: string; courseId: string | null; criteria: unknown; course: { title: string } | null }[],
): { columns: MatrixColumn[]; complianceCriteriaByKey: Map<string, unknown> } {
  const columns = new Map<string, MatrixColumn>();
  for (const r of positionReqs) {
    const key = targetKey(r);
    if (!columns.has(key)) {
      columns.set(key, {
        key,
        targetType: r.targetType,
        courseId: r.courseId,
        sopId: r.sopId,
        pathId: r.pathId,
        title: r.course?.title ?? r.sop?.title ?? r.path?.title ?? "Untitled training",
        source: "position",
      });
    }
  }

  const complianceCriteriaByKey = new Map<string, unknown>();
  for (const rule of complianceRules) {
    if (!rule.courseId) continue;
    const key = targetKey({ targetType: "COURSE", courseId: rule.courseId, sopId: null, pathId: null });
    if (!columns.has(key)) {
      columns.set(key, {
        key,
        targetType: "COURSE",
        courseId: rule.courseId,
        sopId: null,
        pathId: null,
        title: rule.course?.title ?? rule.name,
        source: "compliance",
      });
    }
    complianceCriteriaByKey.set(key, rule.criteria);
  }

  return { columns: [...columns.values()], complianceCriteriaByKey };
}

async function getPeopleRowsMatrix(actor: Actor, filters: MatrixFilters, page: number): Promise<TrainingMatrix> {
  const visible = await getVisibleUserIds(actor);
  const where: Prisma.UserWhereInput = { status: "ACTIVE" };
  if (visible !== "ALL") where.id = { in: visible };
  if (filters.departmentId) where.departmentId = filters.departmentId;
  if (filters.managerId) where.managerId = filters.managerId;
  if (filters.locationId) where.locationId = filters.locationId;
  if (filters.country) where.country = filters.country;
  if (filters.workerType) where.workerType = filters.workerType as WorkerType;
  if (filters.roleKey) where.roles = { some: { role: { key: filters.roleKey } } };

  const skip = (page - 1) * PAGE_SIZE;
  const [total, people] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, orderBy: { name: "asc" }, skip, take: PAGE_SIZE, include: USER_CONTEXT_INCLUDE }),
  ]);
  if (people.length === 0) return { rowMode: "people", columns: [], rows: [], total, page, pageSize: PAGE_SIZE };

  const rowIds = people.map((p) => p.id);
  const positionIds = [...new Set(people.map((p) => p.positionId).filter((v): v is string => Boolean(v)))];

  const [positionReqs, complianceRules] = await Promise.all([
    prisma.positionTrainingRequirement.findMany({
      where: { positionId: { in: positionIds }, required: true },
      include: { course: { select: { title: true } }, sop: { select: { title: true } }, path: { select: { title: true } } },
    }),
    prisma.complianceRule.findMany({
      where: { isActive: true, courseId: { not: null } },
      include: { course: { select: { title: true } } },
    }),
  ]);

  const built = buildColumnsWithCompliance(positionReqs, complianceRules);
  const { complianceCriteriaByKey } = built;
  const columns = filters.courseId
    ? built.columns.filter((c) => c.courseId === filters.courseId)
    : built.columns;

  const [assignments, exemptions, completions] = await Promise.all([
    prisma.assignment.findMany({ where: { userId: { in: rowIds } } }),
    prisma.trainingExemption.findMany({
      where: { userId: { in: rowIds }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    }),
    prisma.completionRecord.findMany({ where: { userId: { in: rowIds } }, orderBy: { completedAt: "desc" } }),
  ]);

  const assignmentByKey = new Map(assignments.map((a) => [keyFor(a.userId, a), { status: a.status }]));
  const exemptionSet = new Set(exemptions.map((e) => keyFor(e.userId, e)));
  const completionByKey = new Map<string, { expiresAt: Date | null }>();
  for (const c of completions) {
    const key = keyFor(c.userId, c);
    if (!completionByKey.has(key)) completionByKey.set(key, { expiresAt: c.expiresAt });
  }

  const positionReqSet = new Set(positionReqs.map((r) => `${r.positionId}:${targetKey(r)}`));

  const rows: MatrixRow[] = people.map((person: UserForContext) => {
    const context = buildUserContext(person);
    const cells: Record<string, MatrixCellState> = {};
    for (const column of columns) {
      const applicableViaPosition = Boolean(person.positionId) && positionReqSet.has(`${person.positionId}:${column.key}`);
      const criteria = complianceCriteriaByKey.get(column.key);
      const applicableViaCompliance = criteria ? evaluateCriteria(criteria, context) : false;
      cells[column.key] = computeCellState({
        applicable: applicableViaPosition || applicableViaCompliance,
        assignment: assignmentByKey.get(keyFor(person.id, column)),
        exemption: exemptionSet.has(keyFor(person.id, column)),
        completion: completionByKey.get(keyFor(person.id, column)),
      });
    }
    return { id: person.id, label: person.name, sublabel: person.title, cells };
  });

  return { rowMode: "people", columns, rows, total, page, pageSize: PAGE_SIZE };
}

const STATE_PRIORITY: MatrixCellState[] = [
  "OVERDUE",
  "EXPIRED",
  "IN_PROGRESS",
  "NOT_STARTED",
  "COMPLETE",
  "WAIVED",
  "EXEMPT",
  "NOT_REQUIRED",
];

function worstState(states: MatrixCellState[]): MatrixCellState {
  for (const candidate of STATE_PRIORITY) {
    if (states.includes(candidate)) return candidate;
  }
  return "NOT_REQUIRED";
}

async function getPositionRowsMatrix(actor: Actor, filters: MatrixFilters, page: number): Promise<TrainingMatrix> {
  const where: Prisma.PositionWhereInput = { isActive: true };
  if (filters.departmentId) where.departmentId = filters.departmentId;

  const skip = (page - 1) * PAGE_SIZE;
  const [total, positions] = await Promise.all([
    prisma.position.count({ where }),
    prisma.position.findMany({
      where,
      orderBy: { title: "asc" },
      skip,
      take: PAGE_SIZE,
      include: { department: { select: { name: true } } },
    }),
  ]);
  if (positions.length === 0) return { rowMode: "positions", columns: [], rows: [], total, page, pageSize: PAGE_SIZE };

  const positionIds = positions.map((p) => p.id);
  const positionReqs = await prisma.positionTrainingRequirement.findMany({
    where: { positionId: { in: positionIds }, required: true },
    include: { course: { select: { title: true } }, sop: { select: { title: true } }, path: { select: { title: true } } },
  });

  let { columns } = buildColumnsWithCompliance(positionReqs, []);
  if (filters.courseId) columns = columns.filter((c) => c.courseId === filters.courseId);

  const holderWhere: Prisma.UserWhereInput = { positionId: { in: positionIds }, status: "ACTIVE" };
  if (filters.locationId) holderWhere.locationId = filters.locationId;
  if (filters.country) holderWhere.country = filters.country;
  if (filters.workerType) holderWhere.workerType = filters.workerType as WorkerType;
  if (filters.managerId) holderWhere.managerId = filters.managerId;
  if (filters.roleKey) holderWhere.roles = { some: { role: { key: filters.roleKey } } };

  const holders = await prisma.user.findMany({ where: holderWhere, select: { id: true, positionId: true } });
  const holderIds = holders.map((h) => h.id);
  const holdersByPosition = new Map<string, string[]>();
  for (const h of holders) {
    if (!h.positionId) continue;
    const list = holdersByPosition.get(h.positionId) ?? [];
    list.push(h.id);
    holdersByPosition.set(h.positionId, list);
  }

  const [assignments, exemptions, completions] = await Promise.all([
    prisma.assignment.findMany({ where: { userId: { in: holderIds } } }),
    prisma.trainingExemption.findMany({
      where: { userId: { in: holderIds }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    }),
    prisma.completionRecord.findMany({ where: { userId: { in: holderIds } }, orderBy: { completedAt: "desc" } }),
  ]);

  const assignmentByKey = new Map(assignments.map((a) => [keyFor(a.userId, a), { status: a.status }]));
  const exemptionSet = new Set(exemptions.map((e) => keyFor(e.userId, e)));
  const completionByKey = new Map<string, { expiresAt: Date | null }>();
  for (const c of completions) {
    const key = keyFor(c.userId, c);
    if (!completionByKey.has(key)) completionByKey.set(key, { expiresAt: c.expiresAt });
  }

  const positionReqSet = new Set(positionReqs.map((r) => `${r.positionId}:${targetKey(r)}`));

  const rows: MatrixRow[] = positions.map((position) => {
    const holderIdsForPosition = holdersByPosition.get(position.id) ?? [];
    const cells: Record<string, MatrixCellState> = {};
    for (const column of columns) {
      const applicable = positionReqSet.has(`${position.id}:${column.key}`);
      if (!applicable) {
        cells[column.key] = "NOT_REQUIRED";
        continue;
      }
      if (holderIdsForPosition.length === 0) {
        cells[column.key] = "NOT_STARTED";
        continue;
      }
      const states = holderIdsForPosition.map((userId) =>
        computeCellState({
          applicable: true,
          assignment: assignmentByKey.get(keyFor(userId, column)),
          exemption: exemptionSet.has(keyFor(userId, column)),
          completion: completionByKey.get(keyFor(userId, column)),
        }),
      );
      cells[column.key] = worstState(states);
    }
    return { id: position.id, label: position.title, sublabel: position.department?.name ?? null, cells };
  });

  return { rowMode: "positions", columns, rows, total, page, pageSize: PAGE_SIZE };
}

export interface TrainingMatrixParams {
  rowMode: "people" | "positions";
  filters?: MatrixFilters;
  page?: number;
}

export async function getTrainingMatrix(actor: Actor, params: TrainingMatrixParams): Promise<TrainingMatrix> {
  // reports.view covers the org-wide admin matrix; team.view covers a manager's
  // own subtree — getVisibleUserIds still scopes rows correctly either way.
  if (!actor.permissions.has("reports.view") && !actor.permissions.has("team.view")) {
    throw new AuthorizationError("reports.view");
  }
  const filters = params.filters ?? {};
  const page = Math.max(1, Math.floor(params.page ?? 1));
  return params.rowMode === "positions"
    ? getPositionRowsMatrix(actor, filters, page)
    : getPeopleRowsMatrix(actor, filters, page);
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Walks every page of the matrix server-side and renders it as CSV text. */
export async function exportMatrixCsv(actor: Actor, params: TrainingMatrixParams): Promise<string> {
  const filters = params.filters ?? {};
  const rows: MatrixRow[] = [];
  let columns: MatrixColumn[] = [];
  let page = 1;

  for (;;) {
    const result = await getTrainingMatrix(actor, { rowMode: params.rowMode, filters, page });
    if (page === 1) columns = result.columns;
    rows.push(...result.rows);
    if (result.rows.length === 0 || rows.length >= result.total) break;
    page += 1;
  }

  const headers = ["Name", "Detail", ...columns.map((c) => c.title)];
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    const values = [row.label, row.sublabel ?? "", ...columns.map((c) => row.cells[c.key] ?? "NOT_REQUIRED")];
    lines.push(values.map(csvEscape).join(","));
  }
  return lines.join("\n");
}
