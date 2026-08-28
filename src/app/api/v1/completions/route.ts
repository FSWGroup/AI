import { prisma } from "@/lib/db";
import { authenticateApiRequest } from "@/app/api/v1/_lib/auth";
import { parsePagination, listEnvelope } from "@/app/api/v1/_lib/http";

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reports.view");
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const page = parsePagination(url);
  const userId = url.searchParams.get("userId");
  const courseId = url.searchParams.get("courseId");
  const since = url.searchParams.get("since");

  const where = {
    ...(userId ? { userId } : {}),
    ...(courseId ? { courseId } : {}),
    ...(since ? { completedAt: { gte: new Date(since) } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.completionRecord.findMany({
      where,
      orderBy: { completedAt: "desc" },
      skip: page.skip,
      take: page.take,
      include: { certificate: { select: { certificateNumber: true } } },
    }),
    prisma.completionRecord.count({ where }),
  ]);

  return listEnvelope(
    rows.map((c) => ({
      id: c.id,
      userId: c.userId,
      targetType: c.targetType,
      title: c.titleSnapshot,
      versionLabel: c.versionLabel,
      scorePercent: c.scorePercent,
      completedAt: c.completedAt,
      expiresAt: c.expiresAt,
      certificateNumber: c.certificate?.certificateNumber ?? null,
    })),
    page,
    total,
  );
}
