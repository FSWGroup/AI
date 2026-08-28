import { getActor } from "@/lib/auth/guard";
import { markAllNotificationsRead } from "@/lib/notifications";

export async function POST(): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const count = await markAllNotificationsRead(actor.id);
  return Response.json({ ok: true, count });
}
