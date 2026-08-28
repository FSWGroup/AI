import Link from "next/link";
import { Glyph } from "@/components/icons";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-md text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-[var(--text-muted)]"
        >
          <Glyph name="search" className="h-6 w-6" />
        </div>
        <h1 className="text-[1.375rem] font-semibold tracking-[-0.015em]">Page not found</h1>
        <p className="mt-2.5 text-[0.875rem] leading-relaxed text-[var(--text-muted)]">
          This page doesn&apos;t exist, or the content was moved or archived. If you followed a link
          from training material, the SOP owner may have archived it.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/home"
            className="inline-flex h-9.5 items-center justify-center rounded-md bg-[var(--brand-primary)] px-4 text-sm font-medium text-white hover:bg-[var(--brand-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            Back to home
          </Link>
          <Link
            href="/sops"
            className="inline-flex h-9.5 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-4 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            Search the SOP library
          </Link>
        </div>
      </div>
    </div>
  );
}
