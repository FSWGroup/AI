import * as React from "react";
import { cn } from "@/lib/utils";
import { Glyph } from "@/components/icons";

export type StatTone = "neutral" | "good" | "warning" | "serious" | "critical";

const TONE_TEXT: Record<StatTone, string> = {
  neutral: "text-[var(--text-primary)]",
  good: "text-success-700",
  warning: "text-warning-700",
  serious: "text-signal-700",
  critical: "text-danger-700",
};

/**
 * A single KPI number. Trend direction is always paired with an arrow glyph
 * AND a word ("up"/"down"), never color alone.
 */
export function StatTile({
  label,
  value,
  unit,
  tone = "neutral",
  delta,
  deltaLabel,
  description,
  className,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: StatTone;
  /** Positive = improvement, negative = decline, in whatever unit the caller means. */
  delta?: number;
  deltaLabel?: string;
  description?: string;
  className?: string;
}) {
  const trend = delta === undefined ? null : delta > 0 ? "up" : delta < 0 ? "down" : "flat";

  return (
    <div className={cn("rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4", className)}>
      <p className="text-[0.75rem] font-medium text-[var(--text-muted)]">{label}</p>
      <p className={cn("mt-1.5 text-[1.625rem] font-semibold tracking-[-0.02em]", TONE_TEXT[tone])}>
        {value}
        {unit && <span className="ml-1 text-[0.9375rem] font-medium text-[var(--text-muted)]">{unit}</span>}
      </p>
      {trend && (
        <p
          className={cn(
            "mt-1.5 flex items-center gap-1 text-[0.75rem] font-medium",
            trend === "up" ? "text-success-700" : trend === "down" ? "text-danger-700" : "text-[var(--text-muted)]",
          )}
        >
          <Glyph
            name="arrow-right"
            className={cn("h-3 w-3", trend === "up" ? "-rotate-90" : trend === "down" ? "rotate-90" : "rotate-0")}
          />
          <span>
            {trend === "flat" ? "No change" : `${trend === "up" ? "Up" : "Down"} ${Math.abs(delta ?? 0)}${unit ?? ""}`}
            {deltaLabel ? ` ${deltaLabel}` : ""}
          </span>
        </p>
      )}
      {description && <p className="mt-1.5 text-[0.75rem] text-[var(--text-muted)]">{description}</p>}
    </div>
  );
}
