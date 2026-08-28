import Link from "next/link";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { Glyph } from "@/components/icons";

export const metadata = { title: "Access not permitted" };

/**
 * Authenticated-but-unauthorized page. Deliberately explains which capability
 * is missing so a person can ask for the right thing, without revealing
 * anything about the content they tried to reach.
 */
export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ permission?: string }>;
}) {
  const { permission } = await searchParams;
  const description =
    permission && permission in PERMISSIONS
      ? PERMISSIONS[permission as Permission]
      : null;

  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-md text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-warning-50 text-warning-700"
        >
          <Glyph name="lock" className="h-6 w-6" />
        </div>

        <h1 className="text-[1.375rem] font-semibold tracking-[-0.015em]">Access not permitted</h1>
        <p className="mt-2.5 text-[0.875rem] leading-relaxed text-[var(--text-muted)]">
          Your account doesn&apos;t have the permission required for this page.
        </p>

        {description && (
          <div className="mt-4 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-3 text-left">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Required permission
            </p>
            <p className="mt-1 font-mono text-[0.8125rem] text-[var(--text-primary)]">{permission}</p>
            <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--text-muted)]">
              {description}
            </p>
          </div>
        )}

        <div className="mt-6 flex items-center justify-center gap-2">
          <Link
            href="/home"
            className="inline-flex h-9.5 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-4 text-sm font-medium text-[var(--text-primary)] shadow-xs hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            Back to home
          </Link>
        </div>

        <p className="mt-5 text-[0.75rem] text-[var(--text-muted)]">
          If you need this access, contact your administrator or HR.
        </p>
      </div>
    </div>
  );
}
