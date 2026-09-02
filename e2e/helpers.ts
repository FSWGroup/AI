import { request, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

export const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "fsw-talentscout-dev";

let prisma: PrismaClient | null = null;
export function db(): PrismaClient {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

export async function adminApi(
  baseURL: string,
  email: string,
): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post("/api/admin/auth/login", {
    data: { email, password: ADMIN_PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`Admin login failed for ${email}: ${res.status()}`);
  }
  return ctx;
}

export async function welsfordOpeningId(): Promise<string> {
  const opening = await db().jobOpening.findFirstOrThrow({
    where: { jobProfile: { name: "Welsford Inside Technical Sales" } },
  });
  return opening.id;
}

export async function createInvitation(
  hr: APIRequestContext,
  jobOpeningId: string,
  candidate: { firstName: string; lastName: string; email: string },
): Promise<{ launchUrl: string; token: string }> {
  const res = await hr.post("/api/admin/invitations", {
    data: { ...candidate, jobOpeningId },
  });
  if (!res.ok()) {
    throw new Error(`Invitation failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { launchUrl: string };
  const token = body.launchUrl.split("/").pop()!;
  return { launchUrl: body.launchUrl, token };
}
