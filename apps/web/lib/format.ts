export function fmtDate(v: unknown): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export function fmtPct(v: unknown, digits = 2): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return (n * 100).toFixed(digits) + "%";
}

export function fmtNum(v: unknown): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : String(v);
}

export function short(id: unknown, n = 8): string {
  return String(id ?? "").slice(0, n);
}

export function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}
