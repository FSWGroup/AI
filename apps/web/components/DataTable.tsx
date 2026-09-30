import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T, index: number) => ReactNode;
  className?: string;
  numeric?: boolean;
}

/** Dense, generic table. `columns[].render` defaults to reading `row[key]`. */
export function DataTable<T extends Record<string, unknown>>({ rows, columns, empty = "No rows.", rowKey, caption }: { rows: T[]; columns: Column<T>[]; empty?: ReactNode; rowKey?: (row: T, i: number) => string; caption?: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="data">
        {caption ? <caption className="p-2 text-left text-xs text-slate-500">{caption}</caption> : null}
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={`${c.numeric ? "num" : ""} ${c.className ?? ""}`}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="py-3 text-center text-slate-500">{empty}</td></tr>
          ) : rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : i}>
              {columns.map((c) => <td key={c.key} className={`${c.numeric ? "num" : ""} ${c.className ?? ""}`}>{c.render ? c.render(r, i) : cell(r[c.key])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function cell(v: unknown): ReactNode {
  if (v == null || v === "") return <span className="text-slate-400">—</span>;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (v instanceof Date) return v.toISOString().replace("T", " ").slice(0, 19);
  if (typeof v === "object") return <code className="text-[11px]">{JSON.stringify(v)}</code>;
  return String(v);
}

export function Panel({ title, children, right, className = "" }: { title: ReactNode; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head"><h2>{title}</h2>{right}</div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-slate-500">{children}</p>;
}
