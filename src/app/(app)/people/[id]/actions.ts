"use server";

import { assertPermission } from "@/lib/auth/guard";
import { runAction, ok, type ActionResult } from "@/lib/action-result";
import { getSensitiveFields, type SensitiveFieldValue } from "@/lib/services/people";

/**
 * Sensitive fields are never auto-loaded with the page — this action only
 * runs when a person with people.sensitive_view explicitly clicks "Reveal",
 * and every call is audited inside getSensitiveFields.
 */
export async function revealSensitiveFieldsAction(userId: string): Promise<ActionResult<SensitiveFieldValue[]>> {
  return runAction("people.reveal_sensitive", async () => {
    const actor = await assertPermission("people.sensitive_view");
    const fields = await getSensitiveFields(actor, userId);
    return ok(fields);
  });
}
