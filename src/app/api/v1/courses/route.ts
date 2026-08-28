import { prisma } from "@/lib/db";
import { authenticateApiRequest } from "@/app/api/v1/_lib/auth";
import { parsePagination, listEnvelope } from "@/app/api/v1/_lib/http";

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "training.view");
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const page = parsePagination(url);
  const status = url.searchParams.get("status") ?? "PUBLISHED";
  const category = url.searchParams.get("category");

  const where = {
    isDeleted: false,
    ...(status !== "ALL" ? { status: status as "DRAFT" | "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "PUBLISHED" | "ARCHIVED" } : {}),
    ...(category ? { category } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.course.findMany({
      where,
      orderBy: { title: "asc" },
      skip: page.skip,
      take: page.take,
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        difficulty: true,
        status: true,
        estimatedMinutes: true,
        passingScore: true,
        recertifyMonths: true,
        currentVersion: { select: { versionNumber: true } },
      },
    }),
    prisma.course.count({ where }),
  ]);

  return listEnvelope(
    rows.map((c) => ({ ...c, currentVersionLabel: c.currentVersion?.versionNumber ?? null, currentVersion: undefined })),
    page,
    total,
  );
}
