import { prisma } from "@/lib/db";
import { authenticateApiRequest } from "@/app/api/v1/_lib/auth";
import { parsePagination, listEnvelope } from "@/app/api/v1/_lib/http";

function statusOf(c: { revokedAt: Date | null; expiresAt: Date | null }): "VALID" | "EXPIRED" | "REVOKED" {
  if (c.revokedAt) return "REVOKED";
  if (c.expiresAt && c.expiresAt.getTime() < Date.now()) return "EXPIRED";
  return "VALID";
}

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reports.view");
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const page = parsePagination(url);
  const userId = url.searchParams.get("userId");
  const status = url.searchParams.get("status");

  const where = { ...(userId ? { userId } : {}) };

  const [rows, total] = await Promise.all([
    prisma.certificate.findMany({ where, orderBy: { issuedAt: "desc" }, skip: page.skip, take: page.take }),
    prisma.certificate.count({ where }),
  ]);

  const mapped = rows.map((c) => ({
    id: c.id,
    certificateNumber: c.certificateNumber,
    userId: c.userId,
    userName: c.userNameSnapshot,
    courseTitle: c.courseTitleSnapshot,
    issuedAt: c.issuedAt,
    expiresAt: c.expiresAt,
    status: statusOf(c),
  }));

  const filtered = status ? mapped.filter((c) => c.status === status.toUpperCase()) : mapped;
  return listEnvelope(filtered, page, status ? filtered.length : total);
}
