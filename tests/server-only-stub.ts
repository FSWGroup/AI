/**
 * Test stub for the `server-only` package.
 *
 * `server-only` throws on import outside a React Server Component, which breaks
 * Vitest when testing server modules directly. Aliasing it to this empty module
 * keeps the production import guard intact while letting tests exercise the same
 * code paths the server runs.
 */
export {};
