"use server";

import { assertPermission } from "@/lib/auth/guard";
import { runAction, ok, fail, type ActionResult } from "@/lib/action-result";
import { exportMatrixCsv, type MatrixFilters } from "@/lib/services/matrix";

export async function exportMatrixCsvAction(params: {
  rowMode: "people" | "positions";
  filters: MatrixFilters;
}): Promise<ActionResult<string>> {
  return runAction("matrix.export_csv", async () => {
    const actor = await assertPermission("reports.export");
    try {
      const csv = await exportMatrixCsv(actor, params);
      return ok(csv);
    } catch {
      return fail("Could not export the matrix. Try narrowing your filters.");
    }
  });
}
