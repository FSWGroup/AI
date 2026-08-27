# Deploying FSW WorkFit on Netlify (same-day runbook)

Total time: roughly 15-20 minutes of clicking. You need: a Netlify account,
this GitHub repo (FSWGroup/AI), and a hosted Postgres database.

## 1. Get a Postgres database (~3 min)

Pick one:

- **Netlify DB (easiest)** — after creating the site in step 2, open the
  site's **Extensions → Neon database** (Netlify DB) and install it. It
  provisions Postgres and sets `NETLIFY_DATABASE_URL` on the site
  automatically; the build uses it without further configuration.
- **Neon directly** — neon.tech → New project → copy the connection string
  (it ends in `?sslmode=require`). You'll paste it as `DATABASE_URL` below.
- Supabase/RDS/any hosted Postgres also works — you just need the URL.

## 2. Create the Netlify site (~3 min)

1. Netlify → **Add new site → Import an existing project → GitHub** →
   pick **FSWGroup/AI**.
2. Branch to deploy: `main` after merging, or deploy the working branch
   `claude/fsw-workfit-assessment-e0ykd4` directly.
3. Build settings are read from `netlify.toml` automatically (build command
   `node scripts/netlify-build.mjs`, Next.js runtime plugin). Don't start
   the first deploy until the environment variables below are set.

## 3. Set environment variables (~5 min)

Site configuration → Environment variables:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | your Postgres URL (skip if using Netlify DB — `NETLIFY_DATABASE_URL` is detected automatically) |
| `APP_SECRET` | run `openssl rand -hex 32` and paste the output |
| `STORAGE_PROVIDER` | `netlify` (webcam recordings go to private Netlify Blobs) |
| `BOOTSTRAP_ADMIN_EMAIL` | your admin email, e.g. `jwelsford@fswelsford.com` |
| `BOOTSTRAP_ADMIN_PASSWORD` | a strong password, 12+ characters |

Optional: `APP_BASE_URL` — only needed if you use a custom domain; otherwise
the app uses Netlify's site URL automatically.

## 4. Deploy (~5 min build)

Trigger the deploy. The build runs migrations, seeds the question bank
(834 items), the assessment form, the **Welsford Inside Technical Sales**
benchmark profile, and creates your admin account from the bootstrap
variables. The seed is idempotent — later deploys skip what already exists.
Dev accounts (`*@fsw.local`) are **never** created on production builds.

The seed also creates the fictional **Alex Sample** fixture so you can see a
finished report immediately; invalidate it from its Administration tab if
you'd rather not keep it.

## 5. One-time settings (~2 min)

Sign in at `https://<your-site>.netlify.app/admin` with your bootstrap
credentials, open **Settings**, and:

1. Set **Webcam recordings** retention days (e.g. 180) — production refuses
   webcam invitations until this exists.
2. Confirm privacy/accommodation contact emails.

Storage and HTTPS checks pass automatically on Netlify with
`STORAGE_PROVIDER=netlify`.

## 6. Invite your candidate (~1 min)

**Candidates → Invite candidate** → name, email, the Welsford opening,
expiry. The result screen shows the **secure launch link** — copy it and
send it to the candidate yourself (no email provider is required; the
built-in provider records the message in the database outbox only). The
link expires on the date you chose and works only for that candidate.

If the candidate loses their session mid-assessment, open their
**Administration** tab → **Issue resume link** and send them the fresh link;
it restores their exact session and remaining time.

## 7. Reviewing results

When the candidate finishes, their row shows **Completed** with the report
ready: score sheet vs. the Welsford ranges, narratives, sales analysis,
interview guide, integrity log, and the recording (HR/Super Admin only,
audited). For a PDF, open the report and use **Print / Save as PDF** —
Netlify Functions don't ship a Chromium runtime, so the server-side
`Download PDF` button responds with that guidance there. The print output
is the same paginated, footered document.

## Platform notes and limits

- **Recordings on Netlify Blobs**: chunks (~0.5 MB / 10 s of video) upload
  through the app's signed endpoints into site-scoped private storage.
  Fine for normal hiring volume; for heavy concurrent use switch to
  `STORAGE_PROVIDER=s3` with a private R2/S3 bucket (browser-direct
  presigned uploads) — no code changes needed.
- **Retention job**: Netlify has no built-in cron for this app; run
  `npm run retention:run` on a schedule from any machine with `DATABASE_URL`
  (and blob credentials `NETLIFY_BLOBS_SITE_ID`/`NETLIFY_BLOBS_TOKEN` if
  deleting recordings), or add a Netlify Scheduled Function later.
- **Function timeouts**: completion (scoring + report) runs in a few
  seconds; item statistics are batched into a single SQL statement to keep
  well inside the default 10 s function budget.
- Keep the **admin-only disclaimer** in mind: results are decision support,
  one input among many — see `docs/VALIDATION-ROADMAP.md` before relying on
  them heavily for selection.
