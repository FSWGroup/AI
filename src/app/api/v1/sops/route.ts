import { prisma } from "@/lib/db";
import { authenticateApiRequest } from "@/app/api/v1/_lib/auth";
import { parsePagination, listEnvelope } from "@/app/api/v1/_lib/http";

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "sop.view");
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const page = parsePagination(url);
  const status = url.searchParams.get("status") ?? "PUBLISHED";
  const kind = url.searchParams.get("kind");

  const where = {
    isDeleted: false,
    ...(status !== "ALL" ? { status: status as "DRAFT" | "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "PUBLISHED" | "ARCHIVED" } : {}),
    ...(kind ? { kind: kind as "SOP" | "POLICY" } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.sop.findMany({
      where,
      orderBy: { sopCode: "asc" },
      skip: page.skip,
      take: page.take,
      select: {
        id: true,
        sopCode: true,
        kind: true,
        title: true,
        summary: true,
        category: true,
        status: true,
        nextReviewAt: true,
        currentVersion: { select: { versionNumber: true } },
      },
    }),
    prisma.sop.count({ where }),
  ]);

  return listEnvelope(
    rows.map((s) => ({ ...s, currentVersionLabel: s.currentVersion?.versionNumber ?? null, currentVersion: undefined })),
    page,
    total,
  );
}
