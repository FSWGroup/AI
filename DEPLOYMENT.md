# Deployment

Production deployment, operations, backup, and recovery for FSW Academy.

---

## Architecture in production

```
                    ┌──────────────────────┐
   Browsers ───────►│  Next.js application │  (stateless, scale horizontally)
                    └───────┬──────────────┘
                            │
        ┌───────────────────┼────────────────────┐
        ▼                   ▼                    ▼
┌───────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  PostgreSQL   │  │ Object storage  │  │  Worker(s)      │
│  16 + pgvector│  │ S3-compatible   │  │  npm run worker │
└───────────────┘  └─────────────────┘  └─────────────────┘
```

Two processes are required:

1. **Web** — the Next.js application, stateless, any number of instances
2. **Worker** — at least one `npm run worker` process

Without a worker the web application still serves, but reminders, overdue
sweeps, recertification, content indexing for AI retrieval, AI generation, video
rendering, email, and webhooks stay queued.

---

## Prerequisites

| Component | Requirement |
|---|---|
| Node.js | 22 or later |
| PostgreSQL | 16 or later with `pgvector`, `pg_trgm`, `unaccent` |
| Object storage | S3-compatible (AWS S3, Cloudflare R2, MinIO, Supabase Storage) |
| ffmpeg | Required on the **worker** host for AI video rendering |
| TLS | Terminated at the edge |

Managed Postgres options with pgvector: Supabase, Neon, AWS RDS/Aurora
(`CREATE EXTENSION vector`), Google Cloud SQL, Azure Database for PostgreSQL.

---

## Option A — Vercel plus managed Postgres

The recommended target for the web tier.

### 1. Database

Provision managed Postgres and confirm the extensions are available:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

Migrations create these too, but confirming first avoids a failed first deploy.
Use a **pooled** connection string for the application (Vercel functions open
many short-lived connections) and a **direct** connection for migrations.

**Size the Prisma pool explicitly.** Prisma defaults `connection_limit` to
`(CPU cores × 2) + 1` — only 9 on a 4-core host. That is low for this
application: rendering a page issues several queries in parallel, and the App
Router prefetches the links on a page, each prefetch server-rendering a whole
route. A single navigation can therefore need dozens of connections at once, and
requests beyond the limit queue until `pool_timeout` (10s by default) and then
fail. Set it deliberately, keeping the total across all instances below the
database's `max_connections`:

```
DATABASE_URL="postgresql://…?schema=public&connection_limit=25&pool_timeout=20"
```

### 2. Environment variables

Set these in the Vercel project (Production scope). Full documentation in
[`.env.example`](.env.example).

**Required**

```
DATABASE_URL           pooled connection string
AUTH_SECRET            openssl rand -base64 32
FIELD_ENCRYPTION_KEY   openssl rand -base64 32   (32 bytes — see the warning below)
APP_URL                https://academy.fswelsford.com
AUTH_URL               https://academy.fswelsford.com
```

**Strongly recommended**

```
AUTH_MICROSOFT_ENTRA_ID_ID / _SECRET / _ISSUER    SSO with your existing MFA policies
RESEND_API_KEY + EMAIL_FROM                       notification email
S3_BUCKET / S3_REGION / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
STORAGE_DRIVER=s3
ANTHROPIC_API_KEY                                 AI authoring and Ask FSW AI
OPENAI_API_KEY                                    embeddings, TTS, images
```

> ### FIELD_ENCRYPTION_KEY
>
> This key encrypts sensitive profile fields. **If it is lost, those values
> cannot be recovered — a database backup is not enough.** Store it in a secrets
> manager, back it up independently of the database, and record who has access.
> Rotation requires re-encrypting existing values; plan it deliberately.

### 3. Deploy

```bash
git push        # Vercel builds automatically
```

Vercel runs `npm ci` then `npm run build`. The `postinstall` script generates the
Prisma client.

### 4. Migrate

Run migrations against the **direct** (non-pooled) connection:

```bash
DATABASE_URL="<direct-connection-string>" npx prisma migrate deploy
```

Never run `prisma db push` or `prisma migrate dev` against production.
Never run `npm run db:seed` against production — it creates demonstration
accounts with a known password.

### 5. Worker

Vercel does not run long-lived processes. Deploy the worker separately —
Railway, Render, Fly.io, AWS ECS, or a small VM:

```bash
git clone <repo> && cd <repo>
npm ci
npm run build          # the worker imports built server modules
npm run worker
```

Give the worker the same environment variables plus `FFMPEG_PATH`, and run it
under a supervisor (systemd, or the platform's process manager) so it restarts on
exit. It handles `SIGTERM` cleanly, finishing the current job before stopping.

### 6. Entra ID SSO

In the Entra ID app registration, add the redirect URI:

```
https://academy.fswelsford.com/api/auth/callback/microsoft-entra-id
```

Set the three `AUTH_MICROSOFT_ENTRA_ID_*` variables. "Continue with Microsoft"
appears on the sign-in page automatically — no code change.

Note that **SSO does not auto-provision**: a person who authenticates but has no
FSW Academy record is refused. Create people through Admin → People or CSV
import first.

---

## Option B — Container deployment

Set `BUILD_STANDALONE=true` at build time and `next.config.ts` emits a
self-contained server. It is off by default because standalone output is
incompatible with `next start`, which is how the production build is served
locally and in the end-to-end harness.

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Standalone output is required for the runner stage below.
ENV BUILD_STANDALONE=true
RUN npx prisma generate && npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# ffmpeg is only needed by the worker; openssl is needed by Prisma.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1001 fsw
COPY --from=builder --chown=fsw:fsw /app/.next/standalone ./
COPY --from=builder --chown=fsw:fsw /app/.next/static ./.next/static
COPY --from=builder --chown=fsw:fsw /app/public ./public
COPY --from=builder --chown=fsw:fsw /app/prisma ./prisma
COPY --from=builder --chown=fsw:fsw /app/node_modules/.prisma ./node_modules/.prisma
USER fsw
EXPOSE 3000
CMD ["node", "server.js"]
```

Run the same image for the worker with a different command:

```yaml
services:
  web:
    image: fsw-academy:latest
    command: ["node", "server.js"]
    ports: ["3000:3000"]
    env_file: .env.production

  worker:
    image: fsw-academy:latest
    command: ["npx", "tsx", "src/worker/index.ts"]
    env_file: .env.production

  migrate:
    image: fsw-academy:latest
    command: ["npx", "prisma", "migrate", "deploy"]
    env_file: .env.production
    restart: "no"
```

Run `migrate` to completion before starting `web`.

---

## First-run setup

Once deployed and migrated, the database has no users — and no one can sign in.
Bootstrap the first administrator:

```bash
# 1. Create the roles and permission rows (no demonstration people or content)
DATABASE_URL="<direct>" npx tsx -e "
import { PrismaClient } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS, ROLE_KEYS, ROLE_LABELS, ROLE_DESCRIPTIONS } from './src/lib/permissions';
const prisma = new PrismaClient();
for (const key of Object.values(ROLE_KEYS)) {
  const role = await prisma.role.upsert({
    where: { key },
    create: { key, name: ROLE_LABELS[key], description: ROLE_DESCRIPTIONS[key], isSystem: true },
    update: {}, select: { id: true },
  });
  await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
  await prisma.rolePermission.createMany({
    data: DEFAULT_ROLE_PERMISSIONS[key].map(p => ({ roleId: role.id, permission: p })),
    skipDuplicates: true,
  });
}
console.log('Roles created.');
await prisma.\$disconnect();
"
```

Then create the first Super Administrator, either with a one-off script using
`bcrypt.hash(password, 12)` on a password you generate, or — preferably — by
creating the person with no password and having them sign in through Entra ID SSO.

After that, everything else is done in the interface: Admin → People (or CSV
import) for staff, Admin → Organization for structure, Admin → Settings for
branding and defaults.

Set the real product name, logo, and colors in **Admin → Settings → Brand**.
Renaming "FSW Academy" needs no code change.

---

## Backup and recovery

### What must be backed up

| Asset | Contains | If lost |
|---|---|---|
| **PostgreSQL** | All records, training evidence, audit trail | Catastrophic — compliance history is gone |
| **Object storage** | Videos, documents, images, certificate PDFs | Content loss; records survive but reference missing media |
| **`FIELD_ENCRYPTION_KEY`** | Nothing itself — decrypts sensitive fields | Encrypted sensitive fields become unrecoverable |
| **`AUTH_SECRET`** | Nothing itself | Sessions invalidate; users re-authenticate |

The encryption key must be backed up **separately** from the database. A backup
containing both offers no protection against the backup itself leaking.

### Database backups

Enable point-in-time recovery on your managed provider. Recommended:

- Continuous WAL archiving with a **30-day** PITR window
- Daily full backups retained **90 days**
- Monthly backups retained per your record-retention policy — training and
  compliance evidence commonly needs multi-year retention (the platform's own
  default is 7 years, configurable in Admin → Settings → Privacy)

Verify restores quarterly. A backup that has never been restored is a hypothesis.

Manual backup:

```bash
pg_dump --format=custom --no-owner --no-acl \
  --file="fsw-academy-$(date +%Y%m%d).dump" "$DATABASE_URL"
```

Restore:

```bash
createdb fsw_academy_restored
pg_restore --dbname="postgresql://…/fsw_academy_restored" \
  --no-owner --no-acl fsw-academy-20260828.dump
```

### Object storage backups

Enable versioning and cross-region replication on the bucket. Set a lifecycle
policy that transitions old renders to infrequent access rather than deleting
them — a video referenced by a completed training record should outlive the
course.

### Recovery assumptions

- **RPO** — under 5 minutes with WAL archiving
- **RTO** — 1 to 4 hours: restore the database, verify, redeploy the web tier and
  worker
- **Evidence integrity** — because completion records, acknowledgements, and
  certificates carry snapshots, a database restore reconstructs full training
  history even if content was subsequently edited
- **Media** — restored independently; a missing asset degrades a lesson but does
  not invalidate the completion record, which stores its own snapshot

### Records outlive content

Deleting a course does not delete its completion history. Published courses with
completions are **archived, never deleted** — an attempted delete is refused with
an explanation. Retention sweeps honor the configured retention period and never
remove evidence inside it.

---

## Monitoring

### Health

The application exposes no unauthenticated health endpoint by design. Point your
monitor at `GET /sign-in` and expect `200`.

For the database:

```sql
SELECT 1;
```

### What to watch

| Signal | Query or metric | Concern |
|---|---|---|
| Failed jobs | `SELECT count(*) FROM "Job" WHERE status = 'FAILED'` | A growing count means the worker is failing repeatedly |
| Queue depth | `SELECT count(*) FROM "Job" WHERE status = 'QUEUED' AND "runAt" <= now()` | Sustained growth means the worker is down or undersized |
| Stuck jobs | `status = 'RUNNING' AND "lockedAt" < now() - interval '20 minutes'` | Worker crashed mid-job; stale locks are reclaimed automatically after 15 minutes |
| Overdue training | `SELECT count(*) FROM "Assignment" WHERE status = 'OVERDUE'` | Business signal, not a fault |
| Auth failures | `AuditEvent` where `action = 'auth.failed'` | Spike suggests credential stuffing |
| Sensitive field reads | `AuditEvent` where `action = 'person.sensitive_view'` | Unusual volume warrants review |

### Logging

Structured single-line JSON with request IDs (`src/lib/logger.ts`). The
`x-request-id` header is echoed on responses and shown to users on the error page
as a reference, so a support report maps to a log entry.

Set `LOG_LEVEL` to `info` in production. Secrets, tokens, sensitive field values,
and full content bodies are redacted before write.

### Error monitoring

Set `SENTRY_DSN` to forward exceptions. Training content and personal data are
not included in reports.

---

## Scaling

**Web tier** — stateless; add instances. Sessions are JWT-based, so no shared
session store is required.

**Worker tier** — add processes. `FOR UPDATE SKIP LOCKED` prevents double
processing, and recurring work uses idempotency keys so extra workers do not
multiply it. Video rendering is the CPU-heavy path; give render workers more CPU
or run a dedicated pool.

**Database** — the dominant cost at scale is reporting. Add a read replica and
point report queries at it before considering anything more exotic. All list
endpoints paginate server-side, so the query shapes stay bounded as headcount
grows.

**Storage** — S3-compatible storage scales without intervention. Serve video
through a CDN in front of the bucket if bandwidth becomes material; media is
still authorized through the application, so cache only with signed, short-lived
URLs.

---

## Production checklist

Before announcing the platform:

**Security**
- [ ] `AUTH_SECRET` and `FIELD_ENCRYPTION_KEY` generated independently, stored in a secrets manager
- [ ] `FIELD_ENCRYPTION_KEY` backed up separately from the database
- [ ] TLS enforced; HSTS enabled at the edge
- [ ] Entra ID SSO configured; MFA enforced by conditional access
- [ ] `AUTH_ENABLE_PASSWORD=false` once SSO is verified working
- [ ] Storage bucket is private; no public read
- [ ] Malware scanning at the storage layer (the platform does not scan uploads)
- [ ] Public certificate verification left disabled unless deliberately wanted

**Data**
- [ ] `prisma migrate deploy` run; no `db push`
- [ ] Demonstration seed **not** run against production
- [ ] PITR enabled and a test restore completed
- [ ] Object storage versioning and replication enabled
- [ ] Retention periods set in Admin → Settings → Privacy

**Operations**
- [ ] At least one worker running under a supervisor
- [ ] ffmpeg present on worker hosts
- [ ] Monitoring on failed jobs and queue depth
- [ ] `SENTRY_DSN` set
- [ ] `LOG_LEVEL=info`

**Content and configuration**
- [ ] Brand, product name, and logo set
- [ ] Demonstration SOPs and courses replaced with reviewed FSW content
- [ ] Compliance rules entered, with owners and verified dates
- [ ] Real people imported; roles assigned deliberately
- [ ] Assignment rules reviewed before enabling — they will assign training immediately
- [ ] Notification defaults and reminder cadence reviewed

**Verification**
- [ ] Sign in as a learner, a manager, and an administrator
- [ ] Complete a course end to end and confirm the certificate generates
- [ ] Publish an SOP and confirm the version snapshot and audit event
- [ ] Confirm a learner cannot reach an admin route (expect the `/forbidden` page)
- [ ] Confirm Ask FSW AI cites sources and refuses when unsupported
- [ ] Check the platform on a phone

---

## Rollback

Application code:

```bash
# Vercel
vercel rollback <deployment-url>

# Containers
docker service update --image fsw-academy:<previous-tag> web
```

Database migrations have no automatic down path — a rollback that must undo a
schema change requires either a forward-fixing migration or a PITR restore. This
is why migrations should be additive where possible: add a nullable column,
backfill, then switch reads. Because evidence tables are append-only, a code
rollback alone is nearly always sufficient.
