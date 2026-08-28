import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { getSettings } from "@/lib/settings";

export class ServiceError extends Error {}

// ---------------------------------------------------------------------------
// Issuance
// ---------------------------------------------------------------------------

export interface IssueCertificateInput {
  userId: string;
  userNameSnapshot: string;
  courseTitleSnapshot: string;
  courseId?: string | null;
  courseVersionId?: string | null;
  expiresAt?: Date | null;
  instructorName?: string | null;
}

/**
 * A certificate number is "FSW-YYYY-NNNNNN", sequential within its issue
 * year. There is no dedicated counter table (schema is frozen for this
 * service), so the sequence is made race-safe with a Postgres transaction-
 * scoped advisory lock keyed by year: concurrent issuances for the same year
 * serialize on that lock, so the COUNT-then-format-then-INSERT below can
 * never observe or produce a duplicate number.
 */
export async function issueCertificate(input: IssueCertificateInput) {
  const settings = await getSettings();
  const year = new Date().getFullYear();

  const certificate = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BigInt(700_000_000 + year)})`;

    const count = await tx.certificate.count({
      where: { certificateNumber: { startsWith: `FSW-${year}-` } },
    });
    const certificateNumber = `FSW-${year}-${String(count + 1).padStart(6, "0")}`;
    const verificationToken = settings.features.publicCertificateVerification
      ? randomBytes(16).toString("hex")
      : null;

    return tx.certificate.create({
      data: {
        certificateNumber,
        userId: input.userId,
        userNameSnapshot: input.userNameSnapshot,
        courseTitleSnapshot: input.courseTitleSnapshot,
        courseId: input.courseId ?? null,
        courseVersionId: input.courseVersionId ?? null,
        expiresAt: input.expiresAt ?? null,
        instructorName: input.instructorName ?? null,
        verificationToken,
      },
    });
  });

  await recordAudit({
    actorId: null,
    action: AUDIT_ACTIONS.CERTIFICATE_ISSUED,
    entityType: "CERTIFICATE",
    entityId: certificate.id,
    metadata: { certificateNumber: certificate.certificateNumber, userId: input.userId },
  });

  return certificate;
}

// ---------------------------------------------------------------------------
// PDF rendering
// ---------------------------------------------------------------------------

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

/** Renders a landscape A4 certificate PDF. Returns the raw PDF bytes. */
export async function renderCertificatePdf(certificateId: string): Promise<Uint8Array> {
  const certificate = await prisma.certificate.findUnique({ where: { id: certificateId } });
  if (!certificate) throw new ServiceError("Certificate not found.");

  const settings = await getSettings();
  const doc = await PDFDocument.create();
  const pageWidth = 841.89; // A4 landscape, points
  const pageHeight = 595.28;
  const page = doc.addPage([pageWidth, pageHeight]);

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const navy = rgb(0x17 / 255, 0x36 / 255, 0x5c / 255);
  const navyDark = rgb(0x10 / 255, 0x28 / 255, 0x45 / 255);
  const steel = rgb(0x5f / 255, 0x6b / 255, 0x80 / 255);
  const gold = rgb(0xf9 / 255, 0x8d / 255, 0x07 / 255);
  const white = rgb(1, 1, 1);

  // Header band.
  const bandHeight = 96;
  page.drawRectangle({ x: 0, y: pageHeight - bandHeight, width: pageWidth, height: bandHeight, color: navy });
  page.drawRectangle({ x: 0, y: pageHeight - bandHeight - 4, width: pageWidth, height: 4, color: gold });

  const appName = settings.brand.appName;
  page.drawText(appName, {
    x: 48,
    y: pageHeight - 58,
    size: 22,
    font: bold,
    color: white,
  });
  page.drawText(settings.brand.companyName, {
    x: 48,
    y: pageHeight - 80,
    size: 11,
    font: regular,
    color: rgb(0.85, 0.89, 0.95),
  });

  // Border.
  page.drawRectangle({
    x: 24,
    y: 24,
    width: pageWidth - 48,
    height: pageHeight - 48,
    borderColor: navy,
    borderWidth: 1.5,
  });

  const centerText = (text: string, y: number, size: number, font: typeof bold, color = navyDark) => {
    const width = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (pageWidth - width) / 2, y, size, font, color });
  };

  centerText("CERTIFICATE OF COMPLETION", pageHeight - 170, 20, bold, steel);

  centerText("This certifies that", pageHeight - 220, 13, regular, steel);
  centerText(certificate.userNameSnapshot, pageHeight - 258, 30, bold, navyDark);

  centerText("has successfully completed", pageHeight - 292, 13, regular, steel);
  centerText(certificate.courseTitleSnapshot, pageHeight - 326, 20, bold, navy);

  const completedLine = `Completed ${formatDate(certificate.issuedAt)}${
    certificate.expiresAt ? `  ·  Valid until ${formatDate(certificate.expiresAt)}` : ""
  }`;
  centerText(completedLine, pageHeight - 358, 12, italic, steel);

  // Footer.
  page.drawLine({
    start: { x: 64, y: 90 },
    end: { x: pageWidth - 64, y: 90 },
    thickness: 0.75,
    color: rgb(0.85, 0.87, 0.9),
  });

  page.drawText(`Certificate No. ${certificate.certificateNumber}`, {
    x: 64,
    y: 68,
    size: 10,
    font: regular,
    color: steel,
  });
  if (certificate.instructorName) {
    const label = `Instructor: ${certificate.instructorName}`;
    const width = regular.widthOfTextAtSize(label, 10);
    page.drawText(label, { x: pageWidth - 64 - width, y: 68, size: 10, font: regular, color: steel });
  }

  const footerNote = certificate.verificationToken
    ? `Verify this certificate at your FSW Academy verification page using certificate number ${certificate.certificateNumber}.`
    : `Issued by ${appName}. This certificate reflects internal training records at the time of issuance.`;
  centerText(footerNote, 48, 8.5, italic, steel);

  const bytes = await doc.save();
  return bytes;
}

// ---------------------------------------------------------------------------
// Public verification
// ---------------------------------------------------------------------------

export interface CertificateVerification {
  valid: boolean;
  certificateNumber?: string;
  userNameSnapshot?: string;
  courseTitleSnapshot?: string;
  issuedAt?: Date;
  expiresAt?: Date | null;
  revoked?: boolean;
  reason?: string;
}

export async function verifyCertificate(token: string): Promise<CertificateVerification> {
  const settings = await getSettings();
  if (!settings.features.publicCertificateVerification) {
    return { valid: false, reason: "Public certificate verification is not enabled." };
  }

  const certificate = await prisma.certificate.findUnique({ where: { verificationToken: token } });
  if (!certificate) return { valid: false, reason: "No certificate matches this verification link." };

  if (certificate.revokedAt) {
    return {
      valid: false,
      reason: certificate.revokedReason ?? "This certificate has been revoked.",
      certificateNumber: certificate.certificateNumber,
      revoked: true,
    };
  }

  if (certificate.expiresAt && certificate.expiresAt.getTime() < Date.now()) {
    return {
      valid: false,
      reason: "This certificate has expired.",
      certificateNumber: certificate.certificateNumber,
      issuedAt: certificate.issuedAt,
      expiresAt: certificate.expiresAt,
    };
  }

  return {
    valid: true,
    certificateNumber: certificate.certificateNumber,
    userNameSnapshot: certificate.userNameSnapshot,
    courseTitleSnapshot: certificate.courseTitleSnapshot,
    issuedAt: certificate.issuedAt,
    expiresAt: certificate.expiresAt,
    revoked: false,
  };
}
