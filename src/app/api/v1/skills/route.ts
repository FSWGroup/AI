import { prisma } from "@/lib/db";
import { authenticateApiRequest } from "@/app/api/v1/_lib/auth";
import { parsePagination, listEnvelope } from "@/app/api/v1/_lib/http";

/** GET /api/v1/skills — the skill catalog. Use ?userId= to see one person's recorded levels instead. */
export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "skills.view");
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const page = parsePagination(url);
  const userId = url.searchParams.get("userId");

  if (userId) {
    const [rows, total] = await Promise.all([
      prisma.userSkill.findMany({
        where: { userId },
        orderBy: { level: "desc" },
        skip: page.skip,
        take: page.take,
        include: { skill: { select: { id: true, name: true, category: true } } },
      }),
      prisma.userSkill.count({ where: { userId } }),
    ]);
    return listEnvelope(
      rows.map((r) => ({ skill: r.skill, level: r.level, source: r.source, updatedAt: r.updatedAt })),
      page,
      total,
    );
  }

  const where = { isActive: true };
  const [rows, total] = await Promise.all([
    prisma.skill.findMany({ where, orderBy: { name: "asc" }, skip: page.skip, take: page.take }),
    prisma.skill.count({ where }),
  ]);
  return listEnvelope(rows, page, total);
}
