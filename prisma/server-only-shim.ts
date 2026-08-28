/**
 * Seed-time stub for the `server-only` package.
 *
 * The seed materialises demonstration state by calling the same services the
 * running application uses, so that seeded assignments, completions and
 * certificates are produced by real business logic rather than hand-forged
 * rows. Those services carry `import "server-only"`, which throws when it is
 * imported outside a React Server Component.
 *
 * `prisma/tsconfig.seed.json` maps the package to this empty module for the
 * seed process only. The production import guard is untouched: the application
 * build still resolves the real package, so a server module accidentally
 * imported into a client bundle still fails loudly.
 */
export {};
