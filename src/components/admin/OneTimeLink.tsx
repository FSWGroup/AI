"use client";

import * as React from "react";

/**
 * A link that was returned once and cannot be looked up again.
 *
 * Every candidate-facing token in the product is stored only as a hash, so
 * the plaintext link exists exactly once — in this response. The default
 * wording says so, because a recruiter who closes the panel expecting to find
 * the link again will reissue one instead, invalidating the link the
 * candidate is already holding.
 */
export function OneTimeLink({
  url,
  children,
}: {
  url: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mt-3 rounded-lg bg-emerald-50 p-3">
      <p className="text-xs font-semibold text-emerald-900">
        {children ?? (
          <>
            Send this link to the candidate. It is shown once — the token is
            stored only as a hash, so a lost link is reissued rather than looked
            up.
          </>
        )}
      </p>
      <input
        readOnly
        className="mt-2 w-full rounded border border-emerald-200 bg-white px-2 py-1 font-mono text-xs text-navy-800"
        value={url}
        onFocus={(e) => e.currentTarget.select()}
      />
    </div>
  );
}
