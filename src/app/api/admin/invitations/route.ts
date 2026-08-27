import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, withErrorHandling } from "@/lib/api";
import { requirePermission, requestMeta } from "@/lib/auth/session";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { generateAssessmentCode, generateToken, hashToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { getEmailProvider } from "@/lib/email";

const schema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(200),
  jobOpeningId: z.string().min(1),
  expiresInDays: z.number().int().min(1).max(60).optional(),
});

export const POST = withErrorHandling(async (req) => {
  const user = await requirePermission("INVITE_CANDIDATES");
  const body = await parseBody(req, schema);
  const meta = await requestMeta();

  const opening = await prisma.jobOpening.findUnique({
    where: { id: body.jobOpeningId },
    include: { jobProfile: true },
  });
  if (!opening || opening.status !== "OPEN") {
    return apiError("That job opening is not open for invitations.", 422);
  }
  const version = await prisma.assessmentVersion.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { versionNumber: "desc" },
  });
  if (!version) {
    return apiError("No active assessment version is configured.", 422);
  }

  // Production-readiness gate for webcam assessments.
  const settings = await prisma.orgSettings.findUnique({ where: { id: "org" } });
  if (env.isProduction) {
    const missing: string[] = [];
    if (!settings?.privacyNoticeConfigured) missing.push("privacy notice");
    const retention = await prisma.retentionPolicy.findUnique({
      where: { recordType: "WEBCAM_RECORDINGS" },
    });
    if (!retention?.retentionDays) missing.push("recording retention policy");
    // s3 and netlify providers are durable managed storage; only the
    // dev-only local-disk provider requires an explicit settings override.
    if (!settings?.storageConfigured && env.storageProvider === "local") {
      missing.push("object storage");
    }
    if (!settings?.httpsConfirmed && !env.appBaseUrl.startsWith("https://")) {
      missing.push("HTTPS environment");
    }
    if (missing.length > 0) {
      return apiError(
        `Webcam assessment invitations are disabled until the following are configured: ${missing.join(", ")}.`,
        409,
      );
    }
  }

  const candidate = await prisma.candidate.create({
    data: {
      firstName: body.firstName.trim(),
      lastName: body.lastName.trim(),
      email: body.email.trim().toLowerCase(),
    },
  });

  const token = generateToken();
  const expiresAt = new Date(
    Date.now() + (body.expiresInDays ?? 14) * 24 * 3600 * 1000,
  );
  const invitation = await prisma.invitation.create({
    data: {
      candidateId: candidate.id,
      jobOpeningId: opening.id,
      assessmentVersionId: version.id,
      tokenHash: hashToken(token),
      code: generateAssessmentCode(),
      expiresAt,
      invitedById: user.id,
    },
  });

  const launchUrl = `${env.appBaseUrl}/assessment/${token}`;
  await getEmailProvider().send({
    to: candidate.email,
    template: "invitation",
    subject: `${settings?.companyName ?? "FSW Group"} — assessment invitation for ${opening.title}`,
    bodyText:
      `Hello ${candidate.firstName},\n\n` +
      `${settings?.companyName ?? "FSW Group"} invites you to complete the FSW WorkFit assessment ` +
      `as part of the evaluation process for: ${opening.title}.\n\n` +
      `Before you begin:\n` +
      `- Reserve approximately 1 hour and 10 minutes in one uninterrupted sitting.\n` +
      `- Use a desktop or laptop computer (phones and tablets are not supported).\n` +
      `- A working webcam is required for the duration of the assessment.\n` +
      `- If you need an accommodation that may affect timing, computer use, or the webcam ` +
      `requirement, contact ${settings?.accommodationContactEmail ?? "your hiring representative"} before beginning.\n\n` +
      `Start your assessment:\n${launchUrl}\n\n` +
      `Assessment code: ${invitation.code}\n` +
      `This link expires on ${expiresAt.toDateString()}.\n\n` +
      `This assessment is one part of the evaluation process and is not the sole basis ` +
      `for an employment decision.`,
  });

  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.INVITATION_CREATED,
    entityType: "Invitation",
    entityId: invitation.id,
    newValue: {
      candidateId: candidate.id,
      jobOpeningId: opening.id,
      expiresAt: expiresAt.toISOString(),
    },
    ip: meta.ip,
  });

  return apiOk({
    invitationId: invitation.id,
    code: invitation.code,
    // Returned to the inviting admin (who is already fully authorized) so
    // the link can be shared directly when no email provider is wired.
    // The token itself is stored only as a hash.
    launchUrl,
  });
});
