import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import type { RetentionRecordType } from "@prisma/client";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("org"),
    companyName: z.string().min(1).max(200).optional(),
    privacyContactEmail: z.string().email().max(200).nullable().optional(),
    accommodationContactEmail: z.string().email().max(200).nullable().optional(),
    hrNotificationEmail: z.string().email().max(200).nullable().optional(),
    assessmentDisclaimer: z.string().max(4000).nullable().optional(),
    privacyNoticeConfigured: z.boolean().optional(),
    storageConfigured: z.boolean().optional(),
    httpsConfirmed: z.boolean().optional(),
    recordingAccessRoles: z
      .array(z.enum(["SUPER_ADMIN", "HR_ADMIN", "HIRING_MANAGER", "ASSESSMENT_ADMIN", "VIEWER"]))
      .min(1)
      .optional(),
  }),
  z.object({
    action: z.literal("retention"),
    recordType: z.enum([
      "ASSESSMENT_ANSWERS",
      "SCORE_REPORT_DATA",
      "INVITATION_RECORDS",
      "INTEGRITY_EVENT_LOGS",
      "WEBCAM_RECORDINGS",
      "AUDIT_RECORDS",
    ]),
    retentionDays: z.number().int().min(1).max(3650).nullable(),
  }),
  z.object({
    action: z.literal("legal_hold_create"),
    scope: z.string().min(3).max(120),
    reason: z.string().min(3).max(500),
  }),
  z.object({ action: z.literal("legal_hold_release"), holdId: z.string() }),
]);

export const POST = withErrorHandling(async (req) => {
  const user = await requirePermission("MANAGE_RETENTION");
  const body = await parseBody(req, schema);

  switch (body.action) {
    case "org": {
      const previous = await prisma.orgSettings.findUnique({ where: { id: "org" } });
      const { action: _a, ...data } = body;
      const updated = await prisma.orgSettings.upsert({
        where: { id: "org" },
        create: { id: "org", ...cleanNulls(data) },
        update: cleanNulls(data),
      });
      await audit({
        userId: user.id,
        action: AUDIT_ACTIONS.SETTINGS_UPDATED,
        entityType: "OrgSettings",
        entityId: "org",
        previousValue: previous ? { companyName: previous.companyName, recordingAccessRoles: previous.recordingAccessRoles } : null,
        newValue: { companyName: updated.companyName, recordingAccessRoles: updated.recordingAccessRoles },
      });
      return apiOk({ ok: true });
    }
    case "retention": {
      const previous = await prisma.retentionPolicy.findUnique({
        where: { recordType: body.recordType as RetentionRecordType },
      });
      await prisma.retentionPolicy.upsert({
        where: { recordType: body.recordType as RetentionRecordType },
        create: {
          recordType: body.recordType as RetentionRecordType,
          retentionDays: body.retentionDays,
          updatedById: user.id,
        },
        update: { retentionDays: body.retentionDays, updatedById: user.id },
      });
      await audit({
        userId: user.id,
        action: AUDIT_ACTIONS.RETENTION_CHANGED,
        entityType: "RetentionPolicy",
        entityId: body.recordType,
        previousValue: { retentionDays: previous?.retentionDays ?? null },
        newValue: { retentionDays: body.retentionDays },
      });
      return apiOk({ ok: true });
    }
    case "legal_hold_create": {
      const hold = await prisma.legalHold.create({
        data: { scope: body.scope, reason: body.reason, createdById: user.id },
      });
      await audit({
        userId: user.id,
        action: AUDIT_ACTIONS.LEGAL_HOLD_CREATED,
        entityType: "LegalHold",
        entityId: hold.id,
        newValue: { scope: body.scope, reason: body.reason },
      });
      return apiOk({ ok: true });
    }
    case "legal_hold_release": {
      const hold = await prisma.legalHold.update({
        where: { id: body.holdId },
        data: { active: false, releasedAt: new Date() },
      });
      await audit({
        userId: user.id,
        action: AUDIT_ACTIONS.LEGAL_HOLD_RELEASED,
        entityType: "LegalHold",
        entityId: hold.id,
      });
      return apiOk({ ok: true });
    }
  }
});

function cleanNulls<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj };
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}
