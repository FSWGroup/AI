/**
 * Chrome for the six candidate-facing pages reached by a single-use link:
 * schedule, social check, interview consent, work sample, talent pool, offer.
 *
 * They are the only pages in the product a candidate sees without an account,
 * and they had drifted apart — two eyebrow trackings, four vertical paddings,
 * two heading sizes — so the same person moving between a scheduling link and
 * an offer link saw two different companies. One shell, one look.
 *
 * Server components: nothing here is interactive.
 */

import type { Metadata } from "next";
import type * as React from "react";

/**
 * Metadata for a page reached only by a token link.
 *
 * Behind every one of these is somebody's name, salary or interview time, so
 * none of them may ever be indexed. Routing all six through this helper means
 * the seventh cannot forget the robots directive.
 */
export function noIndexMetadata(title: string): Metadata {
  return { title, robots: { index: false, follow: false } };
}

/**
 * What a spent, wrong or withdrawn token lands on.
 *
 * Deliberately says nothing about which — these URLs are public, and "already
 * used" and "never existed" have to look the same from outside. The caller
 * supplies the sentence telling the candidate what to do next.
 */
export function LinkExpired({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">
          This link is no longer active
        </h1>
        <p className="mt-3 leading-relaxed text-navy-600">{children}</p>
      </div>
    </main>
  );
}

/**
 * `wide` is for the two pages holding a long document — the offer letter and
 * the work-sample brief. Everything else reads better at the narrower measure.
 */
export function TokenPageShell({
  company,
  title,
  subtitle,
  wide = false,
  children,
}: {
  company: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main
      className={`mx-auto min-h-screen w-full px-6 py-12 ${
        wide ? "max-w-3xl" : "max-w-2xl"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-fsw-600">
        {company}
      </p>
      <h1 className="mt-1 text-2xl font-bold text-navy-900">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-navy-500">{subtitle}</p>}
      {children}
    </main>
  );
}
