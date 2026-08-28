import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeTone =
  | "neutral"
  | "navy"
  | "blue"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "accent";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-steel-100 text-steel-700 border-steel-200",
  navy: "bg-navy-50 text-navy-800 border-navy-200",
  blue: "bg-fswblue-50 text-fswblue-800 border-fswblue-200",
  success: "bg-success-50 text-success-700 border-success-100",
  warning: "bg-warning-50 text-warning-700 border-warning-100",
  danger: "bg-danger-50 text-danger-700 border-danger-100",
  info: "bg-info-50 text-info-700 border-info-100",
  accent: "bg-signal-50 text-signal-800 border-signal-200",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /**
   * Renders a leading dot. Status is always conveyed by text as well, so the
   * dot is decorative and never the sole signal (WCAG 1.4.1).
   */
  dot?: boolean;
}

export function Badge({ className, tone = "neutral", dot, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[0.75rem] font-medium whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      {dot && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
