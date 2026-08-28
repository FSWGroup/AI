import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Accessible progress bar. The numeric value is always exposed to assistive
 * technology, and callers render a visible label alongside it — progress is
 * never communicated by bar length alone.
 */
export function ProgressBar({
  value,
  label,
  tone = "brand",
  size = "md",
  className,
}: {
  value: number;
  label: string;
  tone?: "brand" | "success" | "warning" | "danger";
  size?: "sm" | "md";
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const toneClass = {
    brand: "bg-[var(--brand-primary)]",
    success: "bg-success-600",
    warning: "bg-warning-600",
    danger: "bg-danger-600",
  }[tone];

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn(
        "w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]",
        size === "sm" ? "h-1.5" : "h-2",
        className,
      )}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", toneClass)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/** Circular completion indicator for dashboard tiles. */
export function ProgressRing({
  value,
  label,
  size = 64,
}: {
  value: number;
  label: string;
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const stroke = size >= 64 ? 6 : 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      role="img"
      aria-label={`${label}: ${clamped}%`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-[var(--surface-sunken)]"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="stroke-[var(--brand-primary)] transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <span
        className="absolute font-semibold text-[var(--text-primary)]"
        style={{ fontSize: size >= 64 ? "0.9375rem" : "0.75rem" }}
        aria-hidden="true"
      >
        {clamped}%
      </span>
    </div>
  );
}
