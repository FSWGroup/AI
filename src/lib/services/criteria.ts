/**
 * Assignment and compliance criteria evaluation — pure logic.
 *
 * Deliberately dependency-free: no database, no session, no clock. Rules decide
 * who is *required* to complete what, so a wrong answer here either withholds
 * mandatory training or assigns it to the wrong people. Keeping the evaluator
 * pure means it can be tested exhaustively against fixtures, and reused by the
 * assignment engine, the compliance center, and the reporting layer alike.
 *
 * Criteria shape: `{all:[...]}`, `{any:[...]}`, `{not:{...}}`, or a bare
 * `{field, op, value}` condition, nestable to any depth.
 */

import type { AssignmentRule } from "@prisma/client";

export type CriteriaOp =
  | "eq"
  | "neq"
  | "in"
  | "nin"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "exists";

export type CriteriaField =
  | "workerType"
  | "country"
  | "state"
  | "departmentId"
  | "departmentName"
  | "teamId"
  | "businessUnitId"
  | "businessUnitSlug"
  | "positionId"
  | "positionTitle"
  | "locationId"
  | "managerId"
  | "status"
  | "roleKey"
  | "hireDaysAgo"
  | "startDate";

export interface CriteriaCondition {
  field: CriteriaField | string;
  op: CriteriaOp;
  value?: unknown;
}

export interface CriteriaAll {
  all: CriteriaNode[];
}
export interface CriteriaAny {
  any: CriteriaNode[];
}
export interface CriteriaNot {
  not: CriteriaNode;
}

export type CriteriaNode = CriteriaAll | CriteriaAny | CriteriaNot | CriteriaCondition;

/** The flat set of values a rule's criteria can test against a person. */
export interface UserContext {
  userId: string;
  workerType: string;
  country: string;
  state: string | null;
  status: string;
  departmentId: string | null;
  departmentName: string | null;
  teamId: string | null;
  teamName: string | null;
  businessUnitId: string | null;
  businessUnitSlug: string | null;
  businessUnitName: string | null;
  positionId: string | null;
  positionTitle: string | null;
  locationId: string | null;
  locationName: string | null;
  managerId: string | null;
  managerName: string | null;
  /** All role keys the person currently holds. */
  roleKeys: string[];
  /** Days since start date (or trainingStartDate, or record creation). Null if unknown. */
  hireDaysAgo: number | null;
  /** ISO date string, for gt/gte/lt/lte comparisons against a fixed date. */
  startDate: string | null;
}

const FIELD_ACCESSORS: Record<string, (ctx: UserContext) => unknown> = {
  workerType: (c) => c.workerType,
  country: (c) => c.country,
  state: (c) => c.state,
  departmentId: (c) => c.departmentId,
  departmentName: (c) => c.departmentName,
  teamId: (c) => c.teamId,
  businessUnitId: (c) => c.businessUnitId,
  businessUnitSlug: (c) => c.businessUnitSlug,
  positionId: (c) => c.positionId,
  positionTitle: (c) => c.positionTitle,
  locationId: (c) => c.locationId,
  managerId: (c) => c.managerId,
  status: (c) => c.status,
  roleKey: (c) => c.roleKeys,
  hireDaysAgo: (c) => c.hireDaysAgo,
  startDate: (c) => c.startDate,
};

function toEpoch(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
    const num = Number(value);
    if (!Number.isNaN(num)) return num;
  }
  if (value instanceof Date) return value.getTime();
  return null;
}

function evaluateCondition(cond: CriteriaCondition, context: UserContext): boolean {
  const accessor = FIELD_ACCESSORS[cond.field];
  if (!accessor) return false; // unknown field never matches — fail closed
  const fieldValue = accessor(context);
  const target = cond.value;

  switch (cond.op) {
    case "exists": {
      const wantExists = target === undefined ? true : Boolean(target);
      const has = Array.isArray(fieldValue)
        ? fieldValue.length > 0
        : fieldValue !== null && fieldValue !== undefined && fieldValue !== "";
      return wantExists ? has : !has;
    }
    case "eq":
      return Array.isArray(fieldValue) ? fieldValue.includes(target) : fieldValue === target;
    case "neq":
      return Array.isArray(fieldValue) ? !fieldValue.includes(target) : fieldValue !== target;
    case "in": {
      const list = Array.isArray(target) ? target : [target];
      return Array.isArray(fieldValue)
        ? fieldValue.some((v) => list.includes(v))
        : list.includes(fieldValue);
    }
    case "nin": {
      const list = Array.isArray(target) ? target : [target];
      return Array.isArray(fieldValue)
        ? !fieldValue.some((v) => list.includes(v))
        : !list.includes(fieldValue);
    }
    case "contains": {
      if (Array.isArray(fieldValue)) return fieldValue.includes(target);
      if (typeof fieldValue === "string" && typeof target === "string") {
        return fieldValue.toLowerCase().includes(target.toLowerCase());
      }
      return false;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = toEpoch(fieldValue);
      const b = toEpoch(target);
      if (a === null || b === null) return false;
      if (cond.op === "gt") return a > b;
      if (cond.op === "gte") return a >= b;
      if (cond.op === "lt") return a < b;
      return a <= b;
    }
    default:
      return false;
  }
}

function isCondition(node: CriteriaNode): node is CriteriaCondition {
  return typeof (node as CriteriaCondition).field === "string" && typeof (node as CriteriaCondition).op === "string";
}

/**
 * Evaluate an AssignmentRule/ComplianceRule criteria JSON blob against a
 * person's context. Pure — safe to unit test without a database.
 *
 * Shape: `{all:[...]}`, `{any:[...]}`, `{not:{...}}`, or a bare
 * `{field, op, value}` condition, nestable to any depth. An empty `all` is
 * vacuously true (matches everyone); an empty `any` is vacuously false.
 */
export function evaluateCriteria(criteria: unknown, context: UserContext): boolean {
  if (!criteria || typeof criteria !== "object") return false;
  const node = criteria as Record<string, unknown>;

  if (Array.isArray(node.all)) {
    return (node.all as CriteriaNode[]).every((n) => evaluateCriteria(n, context));
  }
  if (Array.isArray(node.any)) {
    return (node.any as CriteriaNode[]).some((n) => evaluateCriteria(n, context));
  }
  if (node.not !== undefined && node.not !== null) {
    return !evaluateCriteria(node.not, context);
  }
  if (isCondition(node as unknown as CriteriaNode)) {
    return evaluateCondition(node as unknown as CriteriaCondition, context);
  }
  return false;
}

/** Human-readable summary of a condition, used to build assignment reasons. */
function describeCondition(field: string, value: unknown, context: UserContext): string | null {
  switch (field) {
    case "workerType":
      return `your worker type is ${String(value ?? context.workerType).replace(/_/g, " ").toLowerCase()}`;
    case "country":
      return `you are located in ${value ?? context.country}`;
    case "state":
      return context.state ? `you are located in ${context.state}` : null;
    case "departmentId":
    case "departmentName":
      return context.departmentName ? `you are in the ${context.departmentName} department` : null;
    case "teamId":
      return context.teamName ? `you are on the ${context.teamName} team` : null;
    case "businessUnitId":
    case "businessUnitSlug":
      return context.businessUnitName ? `you are in the ${context.businessUnitName} business unit` : null;
    case "positionId":
    case "positionTitle":
      return context.positionTitle ? `your position is ${context.positionTitle}` : null;
    case "locationId":
      return context.locationName ? `you work at ${context.locationName}` : null;
    case "managerId":
      return context.managerName ? `your manager is ${context.managerName}` : null;
    case "roleKey":
      return `you hold the ${String(value)} role`;
    case "hireDaysAgo":
    case "startDate":
      return "of your start date";
    default:
      return null;
  }
}

/** Walk a criteria tree looking for the first condition worth mentioning in a reason. */
function findMeaningfulCondition(node: CriteriaNode | undefined): CriteriaCondition | null {
  if (!node) return null;
  if (isCondition(node)) {
    if (node.field === "status") return null; // "status is ACTIVE" is not descriptive
    return node;
  }
  const children: CriteriaNode[] = "all" in node ? node.all : "any" in node ? node.any : "not" in node ? [node.not] : [];
  for (const child of children) {
    const found = findMeaningfulCondition(child);
    if (found) return found;
  }
  return null;
}

/**
 * Human-readable explanation of why a rule matched, used as the Assignment
 * `reason` so mandatory training always states why it was assigned.
 */
export function buildAssignmentReason(rule: Pick<AssignmentRule, "name" | "criteria">, context: UserContext): string {
  const condition = findMeaningfulCondition(rule.criteria as unknown as CriteriaNode);
  if (condition) {
    const phrase = describeCondition(condition.field, condition.value, context);
    if (phrase) return `Assigned because ${phrase}.`;
  }
  return `Assigned because you match the "${rule.name}" assignment rule.`;
}
