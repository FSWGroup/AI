"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { DEV_USERS } from "@/lib/session";

const COOKIE = { path: "/", httpOnly: true, sameSite: "lax" as const, maxAge: 60 * 60 * 24 * 30 };

/** DEV-ONLY role switcher: stores the selected fixture identity, channel and state in cookies. */
export async function setSessionAction(formData: FormData) {
  const jar = await cookies();
  const user = String(formData.get("user") ?? "public");
  const channel = String(formData.get("channel") ?? "valveman");
  const state = String(formData.get("state") ?? "").trim().toUpperCase();
  const allowedUser = DEV_USERS.some((u) => u.value === user) ? user : "public";
  jar.set("wpi_user", allowedUser, COOKIE);
  jar.set("wpi_channel", channel === "welsford" ? "welsford" : "valveman", COOKIE);
  if (/^[A-Z]{2}$/.test(state)) jar.set("wpi_state", state, COOKIE); else jar.delete("wpi_state");
  revalidatePath("/", "layout");
}
