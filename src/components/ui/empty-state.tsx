import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Every list and collection view uses this instead of rendering nothing.
 * An empty state always explains the situation and offers the next action.
 */
export function EmptyState({
  icon,
  title,
  description,
  actions,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed",
        "border-[var(--border-default)] bg-[var(--surface-card)] px-6 py-12 text-center",
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden="true"
          className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-[var(--text-muted)]"
        >
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">{title}</p>
        {description && (
          <p className="mx-auto max-w-md text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}
