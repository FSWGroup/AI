import { apiOk, withErrorHandling } from "@/lib/api";
import { destroySession, getCurrentUser } from "@/lib/auth/session";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";

export const POST = withErrorHandling(async () => {
  const user = await getCurrentUser();
  await destroySession();
  if (user) {
    await audit({
      userId: user.id,
      action: AUDIT_ACTIONS.LOGOUT,
      entityType: "User",
      entityId: user.id,
    });
  }
  return apiOk({ ok: true });
});
