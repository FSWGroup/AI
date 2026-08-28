import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma, TrainingTargetType } from "@prisma/client";
import { type Actor, AuthorizationError } from "@/lib/auth/guard";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import type { Permission } from "@/lib/permissions";
import { USER_CONTEXT_INCLUDE, buildUserContext, evaluateCriteria, type UserForContext } from "@/lib/services/assignment";

/**
 * Compliance rule management and status reporting.
 *
 * This module never asserts legal compliance — requirements are
 * administrator-entered data (jurisdiction, requirement text, source
 * reference), and every compliance surface must show the disclaimer:
 * "Verify requirement with qualified legal/safety advisor."
 */

export const COMPLIANCE_DISCLAIMER =
  "This platform tracks configured training requirements and evidence. It does not determine legal applicability. Verify requirement with qualified legal/safety advisor.";

function requirePermission(actor: Actor, permission: Permission): void {
  if (!actor.permissions.has(permission)) throw new AuthorizationError(permission);
}

// ---------------------------------------------------------------------------
// Rule CRUD
// ---------------------------------------------------------------------------

export async function listComplianceRules(actor: Actor) {
  requirePermission(actor, "compliance.view");
  return prisma.complianceRule.findMany({
    orderBy: { name: "asc" },
    include: { course: { select: { id: true, title: true } } },
  });
}

export async function getComplianceRule(actor: Actor, id: string) {
  requirePermission(actor, "compliance.view");
  const rule = await prisma.complianceRule.findUnique({
    where: { id },
    include: { course: { select: { id: true, title: true } } },
  });
  if (!rule) throw new Error("That compliance rule no longer exists.");
  return rule;
}

export interface ComplianceRuleInput {
  name: string;
  jurisdiction: string;
  requirement: string;
  sourceReference?: string | null;
  courseId?: string | null;
  criteria: Record<string, unknown>;
  frequencyMonths?: number | null;
  effectiveDate?: Date | null;
  expirationDate?: Date | null;
  retentionYears?: number | null;
  ownerId?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export async function createComplianceRule(actor: Actor, input: ComplianceRuleInput) {
  requirePermission(actor, "compliance.manage");
  const rule = await prisma.complianceRule.create({
    data: { ...input, criteria: input.criteria as Prisma.InputJsonValue },
  });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.COMPLIANCE_RULE_CHANGED,
    entityType: "ComplianceRule",
    entityId: rule.id,
    metadata: { action: "created", name: input.name, jurisdiction: input.jurisdiction },
  });
  return rule;
}

export async function updateComplianceRule(actor: Actor, id: string, input: Partial<ComplianceRuleInput>) {
  requirePermission(actor, "compliance.manage");
  const data: Prisma.ComplianceRuleUpdateInput = {
    ...input,
    criteria: input.criteria !== undefined ? (input.criteria as Prisma.InputJsonValue) : undefined,
  };
  const rule = await prisma.complianceRule.update({ where: { id }, data });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.COMPLIANCE_RULE_CHANGED,
    entityType: "ComplianceRule",
    entityId: id,
    metadata: { action: "updated", fields: Object.keys(input) },
  });
  return rule;
}

export async function verifyRule(actor: Actor, ruleId: string): Promise<void> {
  requirePermission(actor, "compliance.manage");
  await prisma.complianceRule.update({ where: { id: ruleId }, data: { lastVerifiedAt: new Date() } });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.COMPLIANCE_RULE_CHANGED,
    entityType: "ComplianceRule",
    entityId: ruleId,
    metadata: { action: "verified" },
  });
}

// ---------------------------------------------------------------------------
// Exemptions
// ---------------------------------------------------------------------------

export interface CreateExemptionInput {
  userId: string;
  targetType: TrainingTargetType;
  courseId?: string | null;
  sopId?: string | null;
  pathId?: string | null;
  reason: string;
  expiresAt?: Date | null;
}

export async function createExemption(actor: Actor, input: CreateExemptionInput): Promise<{ id: string }> {
  requirePermission(actor, "compliance.manage");
  const exemption = await prisma.trainingExemption.create({
    data: {
      userId: input.userId,
      targetType: input.targetType,
      courseId: input.courseId ?? null,
      sopId: input.sopId ?? null,
      pathId: input.pathId ?? null,
      reason: input.reason,
      expiresAt: input.expiresAt ?? null,
      grantedById: actor.id,
    },
  });
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.EXEMPTION_CREATED,
    entityType: "TrainingExemption",
    entityId: exemption.id,
    metadata: { userId: input.userId, targetType: input.targetType, reason: input.reason },
  });
  return exemption;
}

// ---------------------------------------------------------------------------
// Status reporting
// ---------------------------------------------------------------------------

export interface PersonRef {
  id: string;
  name: string;
  email: string;
}

export interface ComplianceRuleStatus {
  id: string;
  name: string;
  jurisdiction: string;
  requirement: string;
  sourceReference: string | null;
  courseId: string | null;
  courseTitle: string | null;
  hasLinkedCourse: boolean;
  frequencyMonths: number | null;
  effectiveDate: Date | null;
  expirationDate: Date | null;
  retentionYears: number | null;
  ownerName: string | null;
  lastVerifiedAt: Date | null;
  notes: string | null;
  affectedCount: number;
  compliantCount: number;
  nonCompliantCount: number;
  expiringSoonCount: number;
  exemptCount: number;
  compliantPeople: PersonRef[];
  nonCompliantPeople: PersonRef[];
  expiringSoonPeople: PersonRef[];
}

export interface ComplianceStatusFilters {
  ruleId?: string;
}

/**
 * Per-rule status: affected population (via evaluateCriteria against every
 * active person), then — for rules with a linked course — compliant,
 * non-compliant, and expiring-soon breakdowns from CompletionRecord and
 * TrainingExemption. Rules with no linked course report population only;
 * automatic evidence tracking needs a course to check completions against.
 */
export async function getComplianceStatus(
  actor: Actor,
  filters: ComplianceStatusFilters = {},
): Promise<ComplianceRuleStatus[]> {
  requirePermission(actor, "compliance.view");

  const settings = await getSettings();
  const warningDays = Math.max(30, ...settings.training.expiryWarningDays);

  const rules = await prisma.complianceRule.findMany({
    where: { isActive: true, ...(filters.ruleId ? { id: filters.ruleId } : {}) },
    include: { course: { select: { id: true, title: true } } },
  });
  if (rules.length === 0) return [];

  const ownerIds = rules.map((r) => r.ownerId).filter((v): v is string => Boolean(v));
  const owners = ownerIds.length
    ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })
    : [];
  const ownerNameById = new Map(owners.map((o) => [o.id, o.name]));

  // Single pass over active users, matched against every rule's criteria at once.
  const matchedByRule = new Map<string, string[]>(rules.map((r) => [r.id, []]));
  let cursor: string | undefined;
  for (;;) {
    const users: UserForContext[] = await prisma.user.findMany({
      where: { status: "ACTIVE" },
      include: USER_CONTEXT_INCLUDE,
      orderBy: { id: "asc" },
      take: 200,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (users.length === 0) break;

    for (const user of users) {
      const context = buildUserContext(user);
      for (const rule of rules) {
        if (evaluateCriteria(rule.criteria, context)) {
          matchedByRule.get(rule.id)?.push(user.id);
        }
      }
    }

    const last = users[users.length - 1];
    cursor = last?.id;
    if (users.length < 200) break;
  }

  const now = new Date();
  const warnBefore = new Date(now.getTime() + warningDays * 24 * 60 * 60 * 1000);
  const results: ComplianceRuleStatus[] = [];

  for (const rule of rules) {
    const matchedIds = matchedByRule.get(rule.id) ?? [];
    const base = {
      id: rule.id,
      name: rule.name,
      jurisdiction: rule.jurisdiction,
      requirement: rule.requirement,
      sourceReference: rule.sourceReference,
      courseId: rule.courseId,
      courseTitle: rule.course?.title ?? null,
      hasLinkedCourse: Boolean(rule.courseId),
      frequencyMonths: rule.frequencyMonths,
      effectiveDate: rule.effectiveDate,
      expirationDate: rule.expirationDate,
      retentionYears: rule.retentionYears,
      ownerName: rule.ownerId ? (ownerNameById.get(rule.ownerId) ?? null) : null,
      lastVerifiedAt: rule.lastVerifiedAt,
      notes: rule.notes,
      affectedCount: matchedIds.length,
    };

    if (!rule.courseId || matchedIds.length === 0) {
      results.push({
        ...base,
        compliantCount: 0,
        nonCompliantCount: 0,
        expiringSoonCount: 0,
        exemptCount: 0,
        compliantPeople: [],
        nonCompliantPeople: [],
        expiringSoonPeople: [],
      });
      continue;
    }

    const [completions, exemptions, people] = await Promise.all([
      prisma.completionRecord.findMany({
        where: { userId: { in: matchedIds }, courseId: rule.courseId },
        orderBy: { completedAt: "desc" },
        select: { userId: true, completedAt: true, expiresAt: true },
      }),
      prisma.trainingExemption.findMany({
        where: {
          userId: { in: matchedIds },
          targetType: "COURSE",
          courseId: rule.courseId,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { userId: true },
      }),
      prisma.user.findMany({ where: { id: { in: matchedIds } }, select: { id: true, name: true, email: true } }),
    ]);

    const peopleById = new Map(people.map((p) => [p.id, p]));
    const exemptSet = new Set(exemptions.map((e) => e.userId));
    const latestCompletionByUser = new Map<string, { completedAt: Date; expiresAt: Date | null }>();
    for (const c of completions) {
      if (!latestCompletionByUser.has(c.userId)) {
        latestCompletionByUser.set(c.userId, { completedAt: c.completedAt, expiresAt: c.expiresAt });
      }
    }

    const compliantPeople: PersonRef[] = [];
    const nonCompliantPeople: PersonRef[] = [];
    const expiringSoonPeople: PersonRef[] = [];
    let exemptCount = 0;

    for (const userId of matchedIds) {
      const personRef = peopleById.get(userId);
      if (!personRef) continue;
      if (exemptSet.has(userId)) {
        exemptCount += 1;
        continue;
      }
      const completion = latestCompletionByUser.get(userId);
      if (!completion || (completion.expiresAt && completion.expiresAt <= now)) {
        nonCompliantPeople.push(personRef);
        continue;
      }
      compliantPeople.push(personRef);
      if (completion.expiresAt && completion.expiresAt <= warnBefore) {
        expiringSoonPeople.push(personRef);
      }
    }

    results.push({
      ...base,
      compliantCount: compliantPeople.length,
      nonCompliantCount: nonCompliantPeople.length,
      expiringSoonCount: expiringSoonPeople.length,
      exemptCount,
      compliantPeople,
      nonCompliantPeople,
      expiringSoonPeople,
    });
  }

  return results;
}
