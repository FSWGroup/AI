import { AuthenticationError, AuthorizationError } from "@/lib/auth/guard";
import { CapabilityUnavailableError } from "@/lib/ai/types";

/**
 * Standard server-action result.
 *
 * Actions return this instead of throwing, so the client always has a
 * user-presentable message and never sees a stack trace or internal detail.
 */
export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function ok(): ActionResult;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T> {
  return { ok: true, data } as ActionResult<T>;
}

export function fail(error: string, fieldErrors?: Record<string, string>): ActionResult<never> {
  return { ok: false, error, ...(fieldErrors ? { fieldErrors } : {}) };
}

/**
 * Convert a thrown error into a safe ActionResult. Logs the technical detail
 * server-side and returns a message a person can act on.
 */
export function toActionError(error: unknown, context: string): ActionResult<never> {
  if (error instanceof AuthenticationError) {
    return fail("Your session has expired. Please sign in again.");
  }

  if (error instanceof AuthorizationError) {
    return fail("You don't have permission to do that.");
  }

  if (error instanceof CapabilityUnavailableError) {
    return fail(error.message);
  }

  // Prisma unique constraint violation.
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2002"
  ) {
    const target = (error as { meta?: { target?: string[] } }).meta?.target?.join(", ");
    return fail(
      target
        ? `That ${target} is already in use. Choose a different value.`
        : "That value is already in use.",
    );
  }

  // Prisma record-not-found.
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2025"
  ) {
    return fail("That record no longer exists. Reload the page and try again.");
  }

  console.error(`[action:${context}]`, error);
  return fail("Something went wrong. The error has been logged — please try again.");
}

/** Wrap an action body so every failure path produces a safe result. */
export async function runAction<T>(
  context: string,
  body: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await body();
  } catch (error) {
    return toActionError(error, context) as ActionResult<T>;
  }
}

/** Flatten a zod error into field-level messages for form display. */
export function fieldErrorsFromZod(error: {
  issues: { path: (string | number)[]; message: string }[];
}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !result[key]) result[key] = issue.message;
  }
  return result;
}
