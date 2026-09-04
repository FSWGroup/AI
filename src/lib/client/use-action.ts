"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { errorMessage } from "./api";

/**
 * The shape every admin action was writing out by hand.
 *
 * Disable the control, clear the last error, do the thing, refresh the server
 * components so the page shows the result, and put a plain-English message on
 * screen if it failed — releasing `busy` either way. Written out per button,
 * the piece most often dropped was the `finally`, which leaves a control
 * disabled forever after one failed request.
 *
 * `fallback` is what the person sees when the failure was not an ApiError — a
 * dropped connection, say. It is required rather than defaulted, because the
 * developer writing the button always knows something more useful than
 * "Something went wrong".
 *
 * `refresh` defaults to true. Pass false where the action navigates instead
 * (`router` is returned for exactly that), or where a refresh would discard
 * what the user is looking at.
 */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (
      fn: () => Promise<void>,
      opts: { fallback: string; refresh?: boolean },
    ): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        if (opts.refresh !== false) router.refresh();
        return true;
      } catch (err) {
        setError(errorMessage(err, opts.fallback));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  return { busy, error, setError, run, router };
}
