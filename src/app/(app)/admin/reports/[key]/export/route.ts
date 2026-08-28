import { getActor } from "@/lib/auth/guard";
import { getReport, reportColumnsForExport } from "@/lib/services/reports";
import { toCsv, toXlsx, toPdfTable } from "@/lib/export";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { formatCell } from "@/app/(app)/admin/reports/_shared/format";

const MAX_EXPORT_ROWS = 5000;

export async function GET(request: Request, context: { params: Promise<{ key: string }> }): Promise<Response> {
  const actor = await getActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  if (!actor.permissions.has("reports.export")) return new Response("Forbidden: missing reports.export permission", { status: 403 });

  const { key } = await context.params;
  const definition = getReport(key);
  if (!definition) return new Response("Not found", { status: 404 });
  if (!actor.permissions.has(definition.permission)) return new Response("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "csv") as "csv" | "xlsx" | "pdf";

  const filters: Record<string, string | undefined> = {};
  for (const f of definition.filters) filters[f.key] = url.searchParams.get(f.key) ?? undefined;

  const result = await definition.run(actor, { filters, page: 1, pageSize: MAX_EXPORT_ROWS });
  const columns = reportColumnsForExport(definition);

  // Pre-format every cell through the same rules the on-screen table uses,
  // so the export matches what the admin saw.
  const formattedRows = result.rows.map((row) =>
    Object.fromEntries(definition.columns.map((col) => [col.key, formatCell(row[col.key], col.format)])),
  );

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.PERSON_EXPORTED,
    entityType: "REPORT",
    entityId: key,
    metadata: { format, rowCount: formattedRows.length },
  });

  const filenameBase = `${key}-${new Date().toISOString().slice(0, 10)}`;
  const filterSummary = Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  if (format === "xlsx") {
    const buffer = toXlsx([{ name: definition.name.slice(0, 31) || "Report", columns, rows: formattedRows }]);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filenameBase}.xlsx"`,
      },
    });
  }

  if (format === "pdf") {
    const buffer = await toPdfTable(definition.name, columns, formattedRows, { generatedBy: actor.email, filterSummary: filterSummary || undefined });
    return new Response(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filenameBase}.pdf"` },
    });
  }

  const buffer = toCsv(formattedRows, columns);
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filenameBase}.csv"` },
  });
}
