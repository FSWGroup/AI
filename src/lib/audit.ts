import "server-only";
import { prisma } from "@/lib/db";
import { headers } from "next/headers";

/**
 * Append-only audit trail for high-risk operations.
 *
 * There is deliberately no update or delete path here. Metadata must be safe:
 * never secrets, never sensitive field values, never full content bodies.
 */

export const AUDIT_ACTIONS = {
  PERSON_CREATED: "person.created",
  PERSON_UPDATED: "person.updated",
  PERSON_DEACTIVATED: "person.deactivated",
  PERSON_REACTIVATED: "person.reactivated",
  PERSON_IMPORTED: "person.imported",
  ROLE_CHANGED: "person.role_changed",
  SENSITIVE_VIEWED: "person.sensitive_view",
  SENSITIVE_UPDATED: "person.sensitive_update",
  PERSON_EXPORTED: "person.data_exported",
  PERSON_ANONYMIZED: "person.anonymized",

  COURSE_CREATED: "course.created",
  COURSE_UPDATED: "course.updated",
  COURSE_PUBLISHED: "course.published",
  COURSE_ARCHIVED: "course.archived",

  SOP_CREATED: "sop.created",
  SOP_UPDATED: "sop.updated",
  SOP_PUBLISHED: "sop.published",
  SOP_APPROVED: "sop.approved",
  SOP_ARCHIVED: "sop.archived",
  SOP_VERSION_RESTORED: "sop.version_restored",

  PATH_PUBLISHED: "path.published",

  ASSIGNMENT_CREATED: "assignment.created",
  ASSIGNMENT_REMOVED: "assignment.removed",
  ASSIGNMENT_WAIVED: "assignment.waived",
  COMPLETION_OVERRIDDEN: "completion.overridden",
  CERTIFICATE_ISSUED: "certificate.issued",
  CERTIFICATE_REVOKED: "certificate.revoked",

  EXEMPTION_CREATED: "compliance.exemption_created",
  COMPLIANCE_RULE_CHANGED: "compliance.rule_changed",

  /*
   * Near misses. NEAR_MISS_REPORTED is recorded with a null actor when the
   * reporter asked for anonymity: the platform records that a report was filed
   * and when, never who filed it. Anonymity that leaks through the audit log to
   * anyone holding audit.view is not anonymity.
   */
  NEAR_MISS_REPORTED: "nearmiss.reported",
  NEAR_MISS_REVIEWED: "nearmiss.reviewed",
  NEAR_MISS_PUBLISHED: "nearmiss.published",
  NEAR_MISS_ARCHIVED: "nearmiss.archived",

  AI_CONTENT_PUBLISHED: "ai.content_published",
  AI_GENERATION_REQUESTED: "ai.generation_requested",

  INTEGRATION_CHANGED: "integration.changed",
  API_KEY_CREATED: "api_key.created",
  API_KEY_REVOKED: "api_key.revoked",
  SETTINGS_CHANGED: "settings.changed",

  MEDIA_DELETED: "media.deleted",
  AUTH_SIGN_IN: "auth.sign_in",
  AUTH_FAILED: "auth.failed",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS] | string;

export interface AuditInput {
  actorId?: string | null;
  actorEmail?: string | null;
  action: AuditAction;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}

const SENSITIVE_METADATA_KEYS = new Set([
  "password",
  "passwordhash",
  "secret",
  "token",
  "apikey",
  "api_key",
  "ciphertext",
  "authorization",
  "cookie",
  "ssn",
  "tin",
  "bankaccount",
]);

/** Strip anything that must never reach the audit store. */
function sanitizeMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_METADATA_KEYS.has(key.toLowerCase().replace(/[^a-z_]/g, ""))) {
      clean[key] = "[redacted]";
      continue;
    }
    if (typeof value === "string" && value.length > 500) {
      clean[key] = `${value.slice(0, 500)}…[truncated]`;
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

async function requestContext(): Promise<{ ipAddress?: string; requestId?: string }> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    return {
      ipAddress: forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined,
      requestId: h.get("x-request-id") ?? undefined,
    };
  } catch {
    // Outside a request scope (worker, seed) — no request context available.
    return {};
  }
}

export async function recordAudit(input: AuditInput): Promise<void> {
  const ctx = await requestContext();
  try {
    await prisma.auditEvent.create({
      data: {
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        requestId: ctx.requestId ?? null,
        ipAddress: ctx.ipAddress ?? null,
        metadata: (sanitizeMetadata(input.metadata) ?? undefined) as never,
      },
    });
  } catch (error) {
    // Audit writes must never break the user-facing operation, but the failure
    // itself must be visible in server logs.
    console.error("[audit] failed to record event", {
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
