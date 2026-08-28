import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)] shadow-xs border border-transparent",
  secondary:
    "bg-[var(--surface-sunken)] text-[var(--text-primary)] hover:bg-steel-200 border border-[var(--border-subtle)]",
  outline:
    "bg-[var(--surface-card)] text-[var(--text-primary)] hover:bg-[var(--surface-sunken)] border border-[var(--border-default)] shadow-xs",
  ghost:
    "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] border border-transparent",
  danger:
    "bg-danger-600 text-white hover:bg-danger-700 shadow-xs border border-transparent",
  link: "bg-transparent text-[var(--brand-secondary)] hover:underline border border-transparent p-0 h-auto",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "h-8 px-3 text-[0.8125rem] gap-1.5",
  md: "h-9.5 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-[0.9375rem] gap-2",
  icon: "h-9.5 w-9.5 p-0",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Renders a spinner and blocks interaction. Pair with an accessible label. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, children, disabled, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors",
        "disabled:pointer-events-none disabled:opacity-55",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        "whitespace-nowrap",
        VARIANT_CLASSES[variant],
        variant === "link" ? "" : SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      {loading && <Spinner className="shrink-0" />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-4 w-4 animate-spin", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
