import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, apiOk, parseBody, rateLimit, withErrorHandling } from "@/lib/api";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, requestMeta } from "@/lib/auth/session";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";

const schema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export const POST = withErrorHandling(async (req) => {
  const { email, password } = await parseBody(req, schema);
  const meta = await requestMeta();
  if (!rateLimit(`login:${meta.ip ?? "unknown"}`, 10, 5 * 60_000)) {
    return apiError("Too many sign-in attempts. Please wait a few minutes.", 429);
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });
  const valid = user && user.active && (await verifyPassword(password, user.passwordHash));
  if (!valid) {
    await audit({
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      entityType: "User",
      entityId: user?.id,
      actorLabel: email.toLowerCase(),
      ip: meta.ip,
    });
    return apiError("Email or password is incorrect.", 401);
  }

  await createSession(user.id, meta);
  await audit({
    userId: user.id,
    action: AUDIT_ACTIONS.LOGIN,
    entityType: "User",
    entityId: user.id,
    ip: meta.ip,
  });
  return apiOk({ ok: true });
});
