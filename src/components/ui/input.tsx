import * as React from "react";
import { cn } from "@/lib/utils";

const FIELD_BASE =
  "w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-sm " +
  "text-[var(--text-primary)] placeholder:text-[var(--text-muted)] shadow-xs transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--focus-ring)] " +
  "focus-visible:border-[var(--focus-ring)] disabled:opacity-60 disabled:bg-[var(--surface-sunken)] " +
  "aria-[invalid=true]:border-danger-500 aria-[invalid=true]:focus-visible:outline-danger-500";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(FIELD_BASE, "h-9.5", className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, rows = 4, ...props }, ref) => (
  <textarea ref={ref} rows={rows} className={cn(FIELD_BASE, "py-2 leading-6", className)} {...props} />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(FIELD_BASE, "h-9.5 pr-8", className)} {...props}>
    {children}
  </select>
));
Select.displayName = "Select";

/**
 * Labelled field wrapper. Associates label, hint, and error text with the
 * control via aria-describedby so screen readers announce validation state.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[0.8125rem] font-medium text-[var(--text-primary)]">
        {label}
        {required && (
          <span className="ml-1 text-danger-600" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            id: htmlFor,
            "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined,
            "aria-invalid": error ? true : undefined,
            required: required || undefined,
          })
        : children}
      {hint && !error && (
        <p id={hintId} className="text-[0.75rem] text-[var(--text-muted)]">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-[0.75rem] font-medium text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
}
