"use client";

import * as React from "react";
import { VisuallyHiddenDataTable } from "@/components/charts/data-table";
import { categoricalColor, CHART_AXIS_TEXT_COLOR, CHART_GRID_COLOR } from "@/components/charts/tokens";

export interface LineSeries {
  key: string;
  label: string;
  values: number[];
}

/**
 * One or more lines over a shared category axis (e.g. days). A single
 * y-axis always — never a dual-axis chart. Hover/keyboard-focus shows a
 * crosshair and the value for every series at that point.
 */
export function LineChart({
  categories,
  series,
  height = 220,
  valueFormatter = (v: number) => String(v),
  unit,
  title,
}: {
  categories: string[];
  series: LineSeries[];
  height?: number;
  valueFormatter?: (value: number) => string;
  unit?: string;
  title: string;
}) {
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);
  const width = Math.max(360, categories.length * 28);
  const margin = { top: 16, right: 16, bottom: 26, left: 40 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const allValues = series.flatMap((s) => s.values);
  const max = Math.max(1, ...allValues);
  const stepX = categories.length > 1 ? innerW / (categories.length - 1) : 0;

  const yTicks = 4;
  const tickValues = Array.from({ length: yTicks + 1 }, (_, i) => Math.round((max / yTicks) * i));

  const pathFor = (values: number[]) =>
    values
      .map((v, i) => {
        const x = i * stepX;
        const y = innerH - (v / max) * innerH;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  if (categories.length === 0 || series.length === 0) {
    return (
      <div className="flex h-[160px] items-center justify-center rounded-lg border border-dashed border-[var(--border-default)] text-[0.8125rem] text-[var(--text-muted)]">
        No data for this period.
      </div>
    );
  }

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = width / rect.width;
    const relX = (event.clientX - rect.left) * scale - margin.left;
    const index = Math.round(relX / (stepX || 1));
    setHoverIndex(Math.max(0, Math.min(categories.length - 1, index)));
  };

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
          onMouseMove={onMove}
          onMouseLeave={() => setHoverIndex(null)}
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

            {hoverIndex !== null && (
              <line x1={hoverIndex * stepX} x2={hoverIndex * stepX} y1={0} y2={innerH} stroke={CHART_GRID_COLOR} strokeWidth={1.5} strokeDasharray="3 3" />
            )}

            {series.map((s, si) => (
              <g key={s.key}>
                <path d={pathFor(s.values)} fill="none" stroke={categoricalColor(si)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                {hoverIndex !== null && s.values[hoverIndex] !== undefined && (
                  <circle
                    cx={hoverIndex * stepX}
                    cy={innerH - ((s.values[hoverIndex] ?? 0) / max) * innerH}
                    r={3.5}
                    fill={categoricalColor(si)}
                    stroke="var(--surface-card)"
                    strokeWidth={1.5}
                  />
                )}
              </g>
            ))}

            {categories.map((cat, i) =>
              i % Math.ceil(categories.length / 8 || 1) === 0 ? (
                <text key={cat + i} x={i * stepX} y={innerH + 16} textAnchor="middle" fontSize={10} fill={CHART_AXIS_TEXT_COLOR}>
                  {cat}
                </text>
              ) : null,
            )}
          </g>
        </svg>
      </div>

      {hoverIndex !== null && (
        <div className="mt-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-[0.75rem]" role="status">
          <p className="font-semibold text-[var(--text-primary)]">{categories[hoverIndex]}</p>
          <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {series.map((s, si) => (
              <li key={s.key} className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                <span aria-hidden="true" className="h-2 w-2 rounded-sm" style={{ backgroundColor: categoricalColor(si) }} />
                {s.label}: {valueFormatter(s.values[hoverIndex] ?? 0)}
                {unit ?? ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {series.length > 1 && !hoverIndex && (
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
