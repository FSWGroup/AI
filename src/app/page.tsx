import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/guard";

export default async function RootPage() {
  const actor = await getActor();
  redirect(actor ? "/home" : "/sign-in");
}
