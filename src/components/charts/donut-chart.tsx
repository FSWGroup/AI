"use client";

import * as React from "react";
import { VisuallyHiddenDataTable } from "@/components/charts/data-table";
import { categoricalColor } from "@/components/charts/tokens";

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  /** Optional explicit color (e.g. a reserved status color); falls back to the categorical order. */
  color?: string;
}

/**
 * A proportion chart. Every slice is direct-labeled in the legend with its
 * percentage (never color-alone), and the center shows the total so the
 * chart still reads as a number, not just a shape.
 */
export function DonutChart({
  slices,
  size = 160,
  title,
  centerLabel,
}: {
  slices: DonutSlice[];
  size?: number;
  title: string;
  centerLabel?: string;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);

  if (total <= 0) {
    return (
      <div className="flex h-[160px] items-center justify-center rounded-lg border border-dashed border-[var(--border-default)] text-[0.8125rem] text-[var(--text-muted)]">
        No data yet.
      </div>
    );
  }

  const radius = size / 2;
  const stroke = size * 0.22;
  const innerRadius = radius - stroke / 2;
  const circumference = 2 * Math.PI * innerRadius;

  let cumulative = 0;
  const segments = slices.map((slice, i) => {
    const fraction = slice.value / total;
    const dash = fraction * circumference;
    const offset = cumulative * circumference;
    cumulative += fraction;
    return { ...slice, dash, offset, fraction, color: slice.color ?? categoricalColor(i) };
  });

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg role="img" aria-label={title} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${radius} ${radius})`}>
          <circle cx={radius} cy={radius} r={innerRadius} fill="none" stroke="var(--surface-sunken)" strokeWidth={stroke} />
          {segments.map((seg, i) => (
            <circle
              key={seg.key}
              cx={radius}
              cy={radius}
              r={innerRadius}
              fill="none"
              stroke={seg.color}
              strokeWidth={activeIndex === i ? stroke + 3 : stroke}
              strokeDasharray={`${seg.dash} ${circumference - seg.dash}`}
              strokeDashoffset={-seg.offset}
              strokeLinecap={segments.length > 1 ? "butt" : "round"}
              style={{ transition: "stroke-width 120ms" }}
              tabIndex={0}
              role="img"
              aria-label={`${seg.label}: ${seg.value} (${Math.round(seg.fraction * 100)}%)`}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(i)}
              onBlur={() => setActiveIndex(null)}
            />
          ))}
        </g>
        <text x={radius} y={radius - 4} textAnchor="middle" fontSize={size * 0.14} fontWeight={600} fill="var(--text-primary)">
          {activeIndex !== null ? segments[activeIndex]?.value : total}
        </text>
        <text x={radius} y={radius + 14} textAnchor="middle" fontSize={size * 0.075} fill="var(--text-muted)">
          {activeIndex !== null ? segments[activeIndex]?.label : (centerLabel ?? "Total")}
        </text>
      </svg>

      <ul className="flex flex-col gap-1.5" aria-label="Legend">
        {segments.map((seg, i) => (
          <li key={seg.key}>
            <button
              type="button"
              onMouseEnter={() => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(i)}
              onBlur={() => setActiveIndex(null)}
              className="flex items-center gap-2 rounded-sm text-left text-[0.8125rem] text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            >
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: seg.color }} />
              <span className="font-medium text-[var(--text-primary)]">{seg.label}</span>
              <span className="text-[var(--text-muted)]">
                {seg.value} · {Math.round(seg.fraction * 100)}%
              </span>
            </button>
          </li>
        ))}
      </ul>

      <VisuallyHiddenDataTable
        caption={title}
        columns={["Category", "Value", "Percent"]}
        rows={segments.map((s) => [s.label, s.value, `${Math.round(s.fraction * 100)}%`])}
      />
    </div>
  );
}
