/**
 * Asserting on refusals.
 *
 * `AppError.message` is the RFC 9457 *title* — a short, stable, generic string like
 * "Authentication required" — and the specific explanation lives in `publicDetail`,
 * which is what a client actually reads. `rejects.toThrow()` matches the message, so
 * asserting with it would only ever prove the title, and a test that passes whatever
 * the explanation says is not testing the explanation.
 */
import { expect } from 'vitest';
import { AppError } from '../../src/platform/errors.js';

/** The text a client would see: the public detail, falling back to the message. */
export function detailOf(error: unknown): string {
  if (error instanceof AppError) return error.publicDetail ?? error.message;
  return error instanceof Error ? error.message : String(error);
}

/** Assert that a promise rejects, and that what a client would read matches. */
export async function expectRefusal(
  work: Promise<unknown>,
  matching: RegExp,
): Promise<AppError | Error> {
  const error = await work.then(
    () => {
      throw new Error('Expected a refusal, but the call succeeded.');
    },
    (caught: unknown) => caught,
  );
  expect(detailOf(error), `refusal detail did not match ${String(matching)}`).toMatch(
    matching,
  );
  return error as AppError | Error;
}
