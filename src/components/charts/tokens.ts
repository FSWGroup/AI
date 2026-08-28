/**
 * Chart color tokens — drawn from the existing FSW design system
 * (src/app/globals.css), never raw hex. Categorical hues are assigned in a
 * fixed order and never cycled or reassigned when a filter changes the
 * series count; sequential magnitude uses one hue from light to dark; status
 * colors are reserved for state and always paired with a text label.
 */

/** Fixed categorical order — distinct hue + lightness, never reassigned by rank. */
export const CATEGORICAL_COLORS = [
  "var(--color-navy-600)",
  "var(--color-signal-500)",
  "var(--color-fswblue-400)",
  "var(--color-success-600)",
  "var(--color-steel-500)",
  "var(--color-navy-300)",
] as const;

/** Single-hue sequential ramp (light → dark) for magnitude encodings. */
export const SEQUENTIAL_RAMP = [
  "var(--color-fswblue-200)",
  "var(--color-fswblue-400)",
  "var(--color-fswblue-600)",
  "var(--color-navy-700)",
] as const;

/** Reserved status colors — always shown with a text label, never color alone. */
export const STATUS_COLORS: Record<"good" | "warning" | "serious" | "critical" | "neutral", string> = {
  good: "var(--color-success-600)",
  warning: "var(--color-warning-500)",
  serious: "var(--color-signal-600)",
  critical: "var(--color-danger-600)",
  neutral: "var(--color-steel-400)",
};

export const CHART_GRID_COLOR = "var(--border-subtle)";
export const CHART_AXIS_TEXT_COLOR = "var(--text-muted)";
export const CHART_LABEL_TEXT_COLOR = "var(--text-secondary)";

export function categoricalColor(index: number): string {
  return CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length] as string;
}
