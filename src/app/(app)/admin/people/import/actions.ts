"use server";

import { assertPermission } from "@/lib/auth/guard";
import { runAction, ok, fail, type ActionResult } from "@/lib/action-result";
import {
  buildRejectedCsv,
  importPeople,
  parseCsv,
  validateImportRows,
  type ImportCommitResult,
  type ImportMapping,
  type ImportPreview,
} from "@/lib/services/people";

export async function parseImportFileAction(
  text: string,
): Promise<ActionResult<{ headers: string[]; rowCount: number; sample: Record<string, string>[] }>> {
  return runAction("people.import_parse", async () => {
    await assertPermission("people.import");
    const { headers, rows } = parseCsv(text);
    if (headers.length === 0) return fail("That file has no header row.");
    return ok({ headers, rowCount: rows.length, sample: rows.slice(0, 5) });
  });
}

export async function validateImportAction(text: string, mapping: ImportMapping): Promise<ActionResult<ImportPreview>> {
  return runAction("people.import_validate", async () => {
    await assertPermission("people.import");
    if (!mapping.email || !mapping.name) return fail("Map at least the email and name columns.");
    const { rows } = parseCsv(text);
    const preview = await validateImportRows(rows, mapping);
    return ok(preview);
  });
}

export async function commitImportAction(
  valid: ImportPreview["valid"],
): Promise<ActionResult<ImportCommitResult>> {
  return runAction("people.import_commit", async () => {
    if (valid.length === 0) return fail("There are no valid rows to import.");
    const actor = await assertPermission("people.import");
    const result = await importPeople(actor, valid);
    return ok(result);
  });
}

export async function downloadRejectedCsvAction(
  rejected: ImportPreview["rejected"],
  headers: string[],
): Promise<ActionResult<string>> {
  return runAction("people.import_rejected_csv", async () => {
    await assertPermission("people.import");
    return ok(buildRejectedCsv(rejected, headers));
  });
}
