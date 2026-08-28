"use client";

import * as React from "react";
import { VisuallyHiddenDataTable } from "@/components/charts/data-table";
import { categoricalColor, CHART_AXIS_TEXT_COLOR, CHART_GRID_COLOR } from "@/components/charts/tokens";

export interface BarSeries {
  key: string;
  label: string;
  values: number[];
}

/**
 * A grouped/simple vertical bar chart. Thin bars with rounded tops, a
 * recessive gridline, direct value labels on hover/focus, and a legend when
 * there is more than one series (never fewer, never color-alone identity).
 */
export function BarChart({
  categories,
  series,
  height = 220,
  valueFormatter = (v: number) => String(v),
  unit,
  title,
}: {
  categories: string[];
  series: BarSeries[];
  height?: number;
  valueFormatter?: (value: number) => string;
  unit?: string;
  title: string;
}) {
  const [active, setActive] = React.useState<{ categoryIndex: number; seriesIndex: number } | null>(null);
  const width = Math.max(320, categories.length * Math.max(48, series.length * 26));
  const margin = { top: 16, right: 12, bottom: 28, left: 40 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const allValues = series.flatMap((s) => s.values);
  const max = Math.max(1, ...allValues);
  const groupWidth = innerW / Math.max(1, categories.length);
  const barGap = 3;
  const barWidth = Math.max(4, (groupWidth - barGap * (series.length + 1)) / Math.max(1, series.length));

  const yTicks = 4;
  const tickValues = Array.from({ length: yTicks + 1 }, (_, i) => Math.round((max / yTicks) * i));

  if (categories.length === 0 || series.length === 0 || allValues.every((v) => v === 0)) {
    return (
      <div className="flex h-[160px] items-center justify-center rounded-lg border border-dashed border-[var(--border-default)] text-[0.8125rem] text-[var(--text-muted)]">
        No data for this period.
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label={title}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="min-w-full"
        >
          <g transform={`translate(${margin.left},${margin.top})`}>
            {tickValues.map((tick) => {
              const y = innerH - (tick / max) * innerH;
              return (
                <g key={tick}>
                  <line x1={0} x2={innerW} y1={y} y2={y} stroke={CHART_GRID_COLOR} strokeWidth={1} />
                  <text x={-8} y={y} textAnchor="end" dominantBaseline="middle" fontSize={10} fill={CHART_AXIS_TEXT_COLOR}>
                    {tick}
                  </text>
                </g>
              );
            })}

            {categories.map((cat, ci) => {
              const groupX = ci * groupWidth;
              return (
                <g key={cat}>
                  {series.map((s, si) => {
                    const value = s.values[ci] ?? 0;
                    const barHeight = (value / max) * innerH;
                    const x = groupX + barGap + si * (barWidth + barGap);
                    const y = innerH - barHeight;
                    const isActive = active?.categoryIndex === ci && active?.seriesIndex === si;
                    return (
                      <rect
                        key={s.key}
                        x={x}
                        y={y}
                        width={barWidth}
                        height={Math.max(0, barHeight)}
                        rx={2}
                        fill={categoricalColor(si)}
                        opacity={active && !isActive ? 0.55 : 1}
                        tabIndex={0}
                        role="img"
                        aria-label={`${cat}, ${s.label}: ${valueFormatter(value)}${unit ?? ""}`}
                        onMouseEnter={() => setActive({ categoryIndex: ci, seriesIndex: si })}
                        onMouseLeave={() => setActive(null)}
                        onFocus={() => setActive({ categoryIndex: ci, seriesIndex: si })}
                        onBlur={() => setActive(null)}
                      />
                    );
                  })}
                  <text
                    x={groupX + groupWidth / 2 - barGap / 2}
                    y={innerH + 16}
                    textAnchor="middle"
                    fontSize={10}
                    fill={CHART_AXIS_TEXT_COLOR}
                  >
                    {cat.length > 10 ? `${cat.slice(0, 9)}…` : cat}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {active && (
        <p className="mt-1 text-[0.75rem] text-[var(--text-secondary)]" role="status">
          <strong className="font-semibold text-[var(--text-primary)]">{categories[active.categoryIndex]}</strong>
          {" · "}
          {series[active.seriesIndex]?.label}: {valueFormatter(series[active.seriesIndex]?.values[active.categoryIndex] ?? 0)}
          {unit ?? ""}
        </p>
      )}

      {series.length > 1 && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
          {series.map((s, si) => (
            <li key={s.key} className="flex items-center gap-1.5 text-[0.75rem] text-[var(--text-secondary)]">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: categoricalColor(si) }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}

      <VisuallyHiddenDataTable
        caption={title}
        columns={["Category", ...series.map((s) => s.label)]}
        rows={categories.map((cat, ci) => [cat, ...series.map((s) => valueFormatter(s.values[ci] ?? 0))])}
      />
    </div>
  );
}
