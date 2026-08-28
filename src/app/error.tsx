"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Glyph } from "@/components/icons";

/**
 * Global error boundary. Shows a understandable message and never exposes the
 * stack trace or internal detail — the technical error is logged server-side by
 * the framework and, when configured, forwarded to error monitoring.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest correlates this screen with the server log entry.
    console.error("[client-error]", { digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-5 py-12">
      <div className="w-full max-w-md text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-danger-50 text-danger-700"
        >
          <Glyph name="alert" className="h-6 w-6" />
        </div>
        <h1 className="text-[1.375rem] font-semibold tracking-[-0.015em]">Something went wrong</h1>
        <p className="mt-2.5 text-[0.875rem] leading-relaxed text-[var(--text-muted)]">
          This page couldn&apos;t load. The error has been logged. Try again, and if it keeps
          happening, let your administrator know.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[0.6875rem] text-[var(--text-muted)]">
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
        </div>
      </div>
    </div>
  );
}
