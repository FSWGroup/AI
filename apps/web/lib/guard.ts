import "server-only";
import { redirect } from "next/navigation";
import { getSession, type Session } from "./session";

/** Internal-only routes: public/customer principals are redirected to /ask. */
export async function requireInternal(): Promise<Session> {
  const session = await getSession();
  if (!session.isInternal) redirect("/ask");
  return session;
}
