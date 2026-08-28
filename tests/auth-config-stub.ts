/**
 * Test stub for `@/lib/auth/config`.
 *
 * The real module constructs the Auth.js handler at import time, which pulls in
 * framework internals that Vite cannot resolve outside a Next.js build. Any
 * service importing `@/lib/auth/guard` therefore drags the whole auth runtime
 * into the test process.
 *
 * Integration tests do not exercise session resolution — they build `Actor`
 * objects directly from real database rows via `actorFor()`, which is how the
 * authorization boundary is actually tested. Session handling is covered end to
 * end in `e2e/auth.spec.ts` against a running application.
 *
 * `auth()` therefore returns null here: a test that accidentally relied on an
 * ambient session would see an unauthenticated caller and fail loudly, rather
 * than silently passing with a fabricated one.
 */

export async function auth(): Promise<null> {
  return null;
}

export const handlers = {
  GET: () => new Response("not available in tests", { status: 501 }),
  POST: () => new Response("not available in tests", { status: 501 }),
};

export async function signIn(): Promise<never> {
  throw new Error("signIn() is not available in tests — build an Actor with actorFor() instead.");
}

export async function signOut(): Promise<never> {
  throw new Error("signOut() is not available in tests.");
}

export const authConfig = { providers: [] };

export function isPasswordAuthEnabled(): boolean {
  return true;
}

export function isMagicLinkEnabled(): boolean {
  return false;
}

export function isMicrosoftSsoEnabled(): boolean {
  return false;
}
