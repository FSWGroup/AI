import { getActor } from "@/lib/auth/guard";
import { markNotificationRead } from "@/lib/notifications";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  await markNotificationRead(actor.id, id);
  return Response.json({ ok: true });
}
