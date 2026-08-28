import { getActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";

/**
 * GET /api/notifications?limit=10 — matches the contract consumed by
 * src/components/shell/topbar.tsx exactly: `{ notifications: [...] }`.
 */
export async function GET(request: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));

  const rows = await prisma.notification.findMany({
    where: { userId: actor.id },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, title: true, body: true, linkUrl: true, createdAt: true, readAt: true },
  });

  return Response.json({
    notifications: rows.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      linkUrl: n.linkUrl,
      createdAt: n.createdAt.toISOString(),
      readAt: n.readAt ? n.readAt.toISOString() : null,
    })),
  });
}
