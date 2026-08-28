"use server";

import { assertPermission } from "@/lib/auth/guard";
import { runAction, ok, fail, type ActionResult } from "@/lib/action-result";
import { exportMatrixCsv, type MatrixFilters } from "@/lib/services/matrix";

export async function exportTeamStatusCsvAction(filters: MatrixFilters): Promise<ActionResult<string>> {
  return runAction("team.export_status_csv", async () => {
    const actor = await assertPermission("team.view");
    try {
      const csv = await exportMatrixCsv(actor, { rowMode: "people", filters });
      return ok(csv);
    } catch {
      return fail("Could not export your team's status. Try narrowing your filters.");
    }
  });
}
