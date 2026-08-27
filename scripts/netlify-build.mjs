/**
 * Netlify build pipeline: preflight → migrate → seed (idempotent) → next build.
 *
 * The preflight validates EVERY required environment variable up front and
 * prints one complete checklist, so a misconfigured site fails a single
 * cheap build instead of one build per missing variable.
 *
 * NODE_ENV is forced to "production" for the seed so dev accounts with a
 * known password can never be created on a hosted database; the first admin
 * comes from BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD instead.
 */

import { execSync } from "node:child_process";

process.env.DATABASE_URL ||= process.env.NETLIFY_DATABASE_URL || "";

const problems = [];
const warnings = [];

if (!process.env.DATABASE_URL) {
  problems.push(
    "DATABASE_URL is not set. Add it in Site configuration → Environment\n" +
      "    variables (any hosted Postgres connection string, e.g. from\n" +
      "    neon.tech), or install the Netlify DB / Neon extension on this\n" +
      "    site, which provides NETLIFY_DATABASE_URL automatically.",
  );
}
if (!process.env.APP_SECRET) {
  problems.push(
    "APP_SECRET is not set. Generate one locally with `openssl rand -hex 32`\n" +
      "    and add it as an environment variable.",
  );
} else if (process.env.APP_SECRET.length < 32) {
  problems.push("APP_SECRET is too short — use `openssl rand -hex 32` output.");
}

const storage = process.env.STORAGE_PROVIDER;
if (storage !== "netlify" && storage !== "s3") {
  warnings.push(
    `STORAGE_PROVIDER is "${storage ?? "(unset)"}". On Netlify set it to "netlify"\n` +
      "    (recordings in private Netlify Blobs) or \"s3\" with bucket credentials.\n" +
      "    Without it, webcam invitations stay disabled in production.",
  );
}
if (!process.env.BOOTSTRAP_ADMIN_EMAIL || !process.env.BOOTSTRAP_ADMIN_PASSWORD) {
  warnings.push(
    "BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD are not both set.\n" +
      "    On a fresh database no admin account will exist and nobody can\n" +
      "    sign in. Set both (password 12+ characters) unless an admin user\n" +
      "    was already created.",
  );
} else if (process.env.BOOTSTRAP_ADMIN_PASSWORD.length < 12) {
  problems.push("BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.");
}

if (warnings.length > 0) {
  console.warn("\n⚠ FSW WorkFit build warnings:\n");
  for (const w of warnings) console.warn(`  • ${w}\n`);
}
if (problems.length > 0) {
  console.error("\n✖ FSW WorkFit build failed — fix ALL of the following, then");
  console.error("  trigger a fresh deploy (Deploys → Trigger deploy → Clear cache");
  console.error("  and deploy site):\n");
  for (const p of problems) console.error(`  • ${p}\n`);
  console.error(
    "  Full runbook: docs/DEPLOY-NETLIFY.md in the repository.\n",
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
