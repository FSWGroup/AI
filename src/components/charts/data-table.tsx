import * as React from "react";

/**
 * The accessible alternative required alongside every chart (WCAG 1.1.1 /
 * 1.4.1): a real `<table>` with the same data, visually hidden but present
 * for screen readers and for anyone who prefers tabular data.
 */
export function VisuallyHiddenDataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col} scope="col">
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
