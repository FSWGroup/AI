import type { ColumnFormat } from "@/lib/services/reports";

/** Renders one cell value for the report table and for CSV/PDF export previews. */
export function formatCell(value: unknown, format?: ColumnFormat): string {
  if (value === null || value === undefined || value === "") return "—";

  if (format === "date" || format === "datetime") {
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return "—";
    return format === "date" ? date.toISOString().slice(0, 10) : date.toISOString().replace("T", " ").slice(0, 16);
  }
  if (format === "percent") {
    return `${Math.round(Number(value))}%`;
  }
  if (format === "number") {
    return String(value);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}
