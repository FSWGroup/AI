import "server-only";
import { cookies } from "next/headers";
import { loadPrincipalByEmail, PUBLIC_PRINCIPAL, makeContext, createLlmProvider, can, type Principal, type AgentContext } from "@wpi/core";
import { db } from "./db";

/**
 * DEVELOPMENT-ONLY authentication.
 * The `wpi_user` cookie holds a fixture email (or "public"); the principal is resolved server-side on every request
 * via loadPrincipalByEmail. There is no password. Replace with a real identity provider before any deployment.
 */
export const DEV_USERS = [
  { value: "public", label: "Public (ValveMan visitor)" },
  { value: "admin@welsford.example", label: "admin@welsford.example (admin)" },
  { value: "engineer@welsford.example", label: "engineer@welsford.example (app engineer)" },
  { value: "sales@welsford.example", label: "sales@welsford.example (sales)" },
  { value: "cs@valveman.example", label: "cs@valveman.example (customer service)" },
] as const;

export type Channel = "welsford" | "valveman";

export interface Session {
  principal: Principal;
  userKey: string;
  channel: Channel;
  state: string | null;
  isInternal: boolean;
  canReview: boolean;
}

export function isInternalPrincipal(p: Principal): boolean {
  return p.roleId !== "public" && p.roleId !== "customer";
}

export async function getSession(): Promise<Session> {
  const jar = await cookies();
  const userKey = jar.get("wpi_user")?.value ?? "public";
  let principal: Principal = PUBLIC_PRINCIPAL;
  if (userKey !== "public") principal = (await loadPrincipalByEmail(db(), userKey)) ?? PUBLIC_PRINCIPAL;
  const internal = isInternalPrincipal(principal);
  const requested = jar.get("wpi_channel")?.value;
  // Public / customer principals may only act in the ValveMan channel.
  const channel: Channel = internal && requested === "welsford" ? "welsford" : "valveman";
  const rawState = jar.get("wpi_state")?.value?.trim().toUpperCase() ?? "";
  const state = /^[A-Z]{2}$/.test(rawState) ? rawState : null;
  return { principal, userKey: principal === PUBLIC_PRINCIPAL ? "public" : userKey, channel, state, isInternal: internal, canReview: can(principal, "review_knowledge") };
}

/** Build an AgentContext for the current request (principal, channel, state, LLM provider). */
export async function getContext(overrides: Partial<AgentContext> = {}): Promise<{ ctx: AgentContext; session: Session }> {
  const session = await getSession();
  const ctx = makeContext(db(), {
    principal: session.principal,
    channelId: session.channel,
    state: session.state,
    customerId: session.principal.customerId,
    mode: "interactive",
    llm: createLlmProvider(),
    ...overrides,
  });
  return { ctx, session };
}
