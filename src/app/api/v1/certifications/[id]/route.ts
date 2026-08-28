import { prisma } from "@/lib/db";
import { authenticateApiRequest } from "@/app/api/v1/_lib/auth";
import { itemEnvelope, notFound } from "@/app/api/v1/_lib/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reports.view");
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const c = await prisma.certificate.findUnique({ where: { id } });
  if (!c) return notFound("Certificate");

  return itemEnvelope({
    id: c.id,
    certificateNumber: c.certificateNumber,
    userId: c.userId,
    userName: c.userNameSnapshot,
    courseTitle: c.courseTitleSnapshot,
    issuedAt: c.issuedAt,
    expiresAt: c.expiresAt,
    instructorName: c.instructorName,
    revokedAt: c.revokedAt,
    revokedReason: c.revokedReason,
    status: c.revokedAt ? "REVOKED" : c.expiresAt && c.expiresAt.getTime() < Date.now() ? "EXPIRED" : "VALID",
  });
}
