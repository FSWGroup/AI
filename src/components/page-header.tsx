import Link from "next/link";
import { Glyph } from "@/components/icons";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Standard page header with breadcrumbs, title, description, and actions.
 * Every page uses this so heading levels and landmark structure stay consistent
 * for screen-reader users.
 */
export function PageHeader({
  title,
  description,
  crumbs,
  actions,
  meta,
  className,
}: {
  title: string;
  description?: string;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-b border-[var(--border-subtle)] bg-[var(--surface-card)]", className)}>
      <div className="mx-auto w-full max-w-[88rem] px-4 py-5 sm:px-6">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-2">
            <ol className="flex flex-wrap items-center gap-1 text-[0.75rem] text-[var(--text-muted)]">
              {crumbs.map((crumb, index) => (
                <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                  {index > 0 && (
                    <Glyph name="chevron-right" className="h-3 w-3 shrink-0 opacity-60" />
                  )}
                  {crumb.href ? (
                    <Link
                      href={crumb.href}
                      className="hover:text-[var(--text-secondary)] hover:underline"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="text-[var(--text-secondary)]">
                      {crumb.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="text-[1.375rem] font-semibold tracking-[-0.015em] text-[var(--text-primary)]">
              {title}
            </h1>
            {description && (
              <p className="mt-1 max-w-3xl text-[0.875rem] leading-relaxed text-[var(--text-muted)]">
                {description}
              </p>
            )}
            {meta && <div className="mt-2.5 flex flex-wrap items-center gap-2">{meta}</div>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

/** Standard content container so every page shares the same measure and gutters. */
export function PageBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[88rem] px-4 py-6 sm:px-6", className)}>{children}</div>
  );
}

/** Section heading used inside page bodies. */
export function SectionHeading({
  title,
  description,
  actions,
  level = 2,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <Heading className="text-[1rem] font-semibold text-[var(--text-primary)]">{title}</Heading>
        {description && (
          <p className="mt-0.5 text-[0.8125rem] text-[var(--text-muted)]">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
