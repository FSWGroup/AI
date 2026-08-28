import * as React from "react";
import { VisuallyHiddenDataTable } from "@/components/charts/data-table";

/** A tiny inline trend line with no axes — used inside stat tiles and dense rows. */
export function Sparkline({
  values,
  labels,
  color = "var(--brand-secondary)",
  width = 96,
  height = 28,
  caption,
}: {
  values: number[];
  labels?: string[];
  color?: string;
  width?: number;
  height?: number;
  caption: string;
}) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return [x, y] as const;
  });
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1];

  return (
    <span className="inline-block align-middle">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img">
        <title>{caption}</title>
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {last && <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} />}
      </svg>
      <VisuallyHiddenDataTable
        caption={caption}
        columns={["Point", "Value"]}
        rows={values.map((v, i) => [labels?.[i] ?? String(i + 1), v])}
      />
    </span>
  );
}
