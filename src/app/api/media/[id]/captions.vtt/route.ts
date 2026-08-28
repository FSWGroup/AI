import { getActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";

/** Serves a video's stored WebVTT captions track. Authenticated, like all media. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const actor = await getActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });

  const { id } = await context.params;
  const asset = await prisma.mediaAsset.findFirst({ where: { id, isDeleted: false }, select: { captionsVtt: true } });
  if (!asset?.captionsVtt) return new Response("Not found", { status: 404 });

  return new Response(asset.captionsVtt, {
    status: 200,
    headers: {
      "Content-Type": "text/vtt; charset=utf-8",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
