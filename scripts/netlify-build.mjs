/**
 * Netlify build pipeline: migrate → seed (idempotent) → next build.
 *
 * NODE_ENV is forced to "production" for the seed so dev accounts with a
 * known password can never be created on a hosted database; the first admin
 * comes from BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD instead.
 */

import { execSync } from "node:child_process";

process.env.DATABASE_URL ||= process.env.NETLIFY_DATABASE_URL || "";

if (!process.env.DATABASE_URL) {
  console.error(
    "\nFSW WorkFit build failed: no database configured.\n" +
      "Set DATABASE_URL in Site settings → Environment variables (any hosted\n" +
      "Postgres such as Neon or Supabase), or install Netlify DB, which\n" +
      "provides NETLIFY_DATABASE_URL automatically.\n",
  );
  process.exit(1);
}
if (!process.env.APP_SECRET) {
  console.error(
    "\nFSW WorkFit build failed: APP_SECRET is not set.\n" +
      "Generate one with `openssl rand -hex 32` and add it to the site's\n" +
      "environment variables.\n",
  );
  process.exit(1);
}

const env = { ...process.env, NODE_ENV: "production" };
const run = (cmd) => {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { stdio: "inherit", env });
};

run("npx prisma migrate deploy");
run("npx tsx prisma/seed.ts");
run("npx next build");
