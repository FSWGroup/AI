/**
 * Resolve the database connection string across hosting providers and set
 * process.env.DATABASE_URL for Prisma (whose datasource reads that name).
 *
 * Accepted sources, in order:
 *   DATABASE_URL                    — explicit configuration (wins)
 *   NETLIFY_DATABASE_URL_UNPOOLED   — Netlify Neon extension (direct)
 *   NETLIFY_DB_URL                  — current Netlify DB
 *   NETLIFY_DATABASE_URL            — legacy Netlify DB / Neon extension
 *
 * Neon "pooled" endpoints (host contains "-pooler.") run PgBouncer in
 * transaction mode; Prisma needs pgbouncer=true there or prepared
 * statements break, so the flag is appended automatically when missing.
 */

export function resolveDatabaseUrl(): string | undefined {
  let url =
    process.env.DATABASE_URL ||
    process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
    process.env.NETLIFY_DB_URL ||
    process.env.NETLIFY_DATABASE_URL;
  if (!url) return undefined;

  if (url.includes("-pooler.") && !url.includes("pgbouncer=")) {
    url += (url.includes("?") ? "&" : "?") + "pgbouncer=true";
  }
  process.env.DATABASE_URL = url;
  return url;
}
