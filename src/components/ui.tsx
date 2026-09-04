/** Small, consistent UI kit for FSW Talent Scout (candidate + admin surfaces). */

import * as React from "react";

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-2xl border border-navy-100 bg-white shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const styles: Record<ButtonVariant, string> = {
    primary:
      "bg-fsw-600 text-white hover:bg-fsw-700 disabled:bg-navy-200 disabled:text-navy-400",
    secondary:
      "border border-navy-200 bg-white text-navy-800 hover:bg-navy-50 disabled:text-navy-300",
    ghost: "text-navy-600 hover:bg-navy-100 disabled:text-navy-300",
    danger:
      "bg-red-700 text-white hover:bg-red-800 disabled:bg-navy-200 disabled:text-navy-400",
  };
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "w-full rounded-lg border border-navy-200 bg-white px-3 py-2.5 text-sm text-navy-900 placeholder:text-navy-300 focus:border-fsw-500",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A checkbox at the product's one size and accent colour.
 *
 * Positioning (`mt-1`, `shrink-0`) stays with the caller, because it depends
 * on the label it sits beside; the box itself does not.
 */
export function Checkbox({
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <input
      type="checkbox"
      className={cx("h-4 w-4 accent-fsw-600", className)}
      {...props}
    />
  );
}

/**
 * An inline form error.
 *
 * `role="alert"` is not optional here, and that is the reason this exists:
 * when each site wrote its own <p>, most of them left it off, so a screen
 * reader user submitted a form and was told nothing had happened. Spacing is
 * still the caller's, because it depends on what the error sits under.
 */
export function ErrorText({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p role="alert" className={cx("text-sm text-red-700", className)}>
      {children}
    </p>
  );
}

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        "w-full rounded-lg border border-navy-200 bg-white px-3 py-2.5 text-sm text-navy-900",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(
        "w-full rounded-lg border border-navy-200 bg-white px-3 py-2.5 text-sm text-navy-900 placeholder:text-navy-300",
        className,
      )}
      {...props}
    />
  );
}

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cx("mb-1.5 block text-sm font-medium text-navy-800", className)}
      {...props}
    />
  );
}

type BadgeTone = "neutral" | "blue" | "green" | "amber" | "red" | "navy";

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  const tones: Record<BadgeTone, string> = {
    neutral: "bg-navy-100 text-navy-700",
    blue: "bg-fsw-100 text-fsw-800",
    green: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
    navy: "bg-navy-800 text-white",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div>
      {eyebrow && (
        <p className="text-xs font-semibold uppercase tracking-widest text-fsw-600">
          {eyebrow}
        </p>
      )}
      <h2 className="mt-1 text-xl font-bold text-navy-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-navy-500">{description}</p>}
    </div>
  );
}

export function ProgressBar({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label ?? "Progress"}
      className="h-2 w-full overflow-hidden rounded-full bg-navy-100"
    >
      <div
        className="h-full rounded-full bg-fsw-500 transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
