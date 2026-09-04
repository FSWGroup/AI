"use client";

/** Client fetch helper with consistent error surface. */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * The sentence to show a person for a failed request.
 *
 * An ApiError already carries the server's plain-English message, which is
 * written for the person reading it. Anything else — a dropped connection, a
 * parse failure — has a message written for a developer, so the caller's
 * fallback is used instead.
 */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers:
      options.body !== undefined ? { "Content-Type": "application/json" } : {},
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      (data as { error?: string }).error ?? "Something went wrong.",
      res.status,
    );
  }
  return data as T;
}
