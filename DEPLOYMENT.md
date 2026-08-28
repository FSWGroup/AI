# Deployment — FSW People

Exact steps to run FSW People in production, plus the backup and restore runbook.

---

## Target stack

| Component | Recommendation | Notes |
|---|---|---|
| Application | Vercel, or any Node 20+ host (Fly.io, Render, ECS, a VM) | Nothing is Vercel-specific |
| Database | Managed PostgreSQL 16+ with PITR | Neon, Supabase, RDS, Cloud SQL |
| Object storage | Private S3-compatible bucket | S3, R2, Spaces — public access blocked |
| Email | SMTP provider | SES, Postmark, SendGrid |
| Secrets | Platform secrets manager | Never a committed file |
| Scheduler | Vercel Cron, GitHub Actions, or systemd timer | One daily POST |

The storage and email layers sit behind driver interfaces, so switching provider is a
configuration change rather than a rewrite.

---

## 1. Provision

```bash
# Database — create an application role WITHOUT superuser or createdb
psql "$ADMIN_URL" <<'SQL'
CREATE ROLE fsw_people LOGIN PASSWORD '<strong-password>';
CREATE DATABASE fsw_people OWNER fsw_people;
SQL
```

Create the object storage bucket with **public access blocked** and versioning enabled.

## 2. Generate secrets

```bash
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # FIELD_ENCRYPTION_KEY   ← back this up separately
openssl rand -hex 32   # DOCUMENT_URL_SIGNING_KEY
openssl rand -hex 32   # CRON_SECRET
```

> **`FIELD_ENCRYPTION_KEY` is not recoverable.** If it is lost, every encrypted identifier
> and bank account becomes permanently unreadable. Store it in the secrets manager *and* in
> a separate offline escrow, held apart from database backups — so that a stolen database
> backup alone cannot decrypt them.

## 3. Configure the environment

Set every variable from [`.env.example`](.env.example) in the platform's secret store.
Required: `DATABASE_URL`, `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`,
`DOCUMENT_URL_SIGNING_KEY`, `APP_BASE_URL`, `STORAGE_DRIVER`.

For production storage:

```
STORAGE_DRIVER=s3
S3_ENDPOINT=…  S3_REGION=…  S3_BUCKET=…  S3_ACCESS_KEY_ID=…  S3_SECRET_ACCESS_KEY=…
```

> The S3 adapter in `src/lib/storage.ts` is an interface-complete stub. Before going live
> with `STORAGE_DRIVER=s3`, add `@aws-sdk/client-s3` and implement `put`/`get`/`delete` in
> `S3Driver` — the interface is identical to the working local driver, so nothing else
> changes. Until then, `local` storage works on a single node with a persistent volume.

For production email:

```
EMAIL_DRIVER=smtp
SMTP_HOST=…  SMTP_PORT=587  SMTP_USER=…  SMTP_PASSWORD=…
EMAIL_FROM="FSW People <people@fswelsford.com>"
```

`src/lib/env.ts` validates all of this at startup and fails fast with the specific variable
named, so a misconfiguration surfaces at deploy rather than at first use.

## 4. Build and migrate

```bash
npm ci
npx prisma migrate deploy     # applies schema + audit/cycle triggers
npm run build
```

Migrations are forward-only and idempotent. `migrate deploy` never prompts and never resets.

## 5. Seed the first administrator

For a **fresh production install** (no demo data):

```bash
npx tsx prisma/seed.ts
```

Then immediately:

1. Sign in as `admin@fswelsford.com` with the seed password.
2. Change that password, and enable MFA under Account → Security.
3. Work through the first-run setup wizard.
4. **Delete or suspend every demo account** in Settings → Users, and delete demo workers
   (they are flagged `isDemo` and labelled "demo" in the UI).

For a truly clean install, comment out the `seedDemoData(...)` call in `prisma/seed.ts`
before running it — roles, entities, holidays, PTO policies, templates and compliance rules
still seed, without the fictional people.

## 6. Schedule the daily sweep

```
0 7 * * *  curl -fsS -X POST https://people.fswelsford.com/api/internal/maintenance \
             -H "Authorization: Bearer $CRON_SECRET"
```

Vercel Cron equivalent (`vercel.json`):

```json
{ "crons": [{ "path": "/api/internal/maintenance", "schedule": "0 7 * * *" }] }
```

The sweep is idempotent — a double run in one day is a no-op.

## 7. Verify the deployment

```bash
# Security headers reach the browser through your CDN/proxy
curl -sI https://people.fswelsford.com/login | grep -iE 'strict-transport|x-frame|content-security|x-content-type'

# Unauthenticated requests are redirected, not served
curl -s -o /dev/null -w '%{http_code}\n' https://people.fswelsford.com/people   # expect 307

# Exports reject unauthenticated callers
curl -s -o /dev/null -w '%{http_code}\n' https://people.fswelsford.com/api/exports?report=headcount   # expect 401
```

Then sign in and confirm: MFA enrollment works, an email lands (check Admin → Email Outbox
if it does not), a document uploads and downloads, and the audit log records all of it.

---

## Backup and recovery

HR data must not depend on hoping the cloud provider has a backup.

### What must be backed up

| Asset | Method | Frequency | Retention |
|---|---|---|---|
| PostgreSQL | Managed automated backup **plus** an independent `pg_dump` to separate storage | Continuous PITR + nightly dump | 35 days PITR, 12 monthly dumps |
| Object storage | Bucket versioning + cross-region replication | Continuous | 90 days of versions |
| `FIELD_ENCRYPTION_KEY` | Secrets manager + offline escrow | On rotation | Indefinite |
| Other secrets | Secrets manager with versioning | On rotation | Indefinite |

### Nightly encrypted dump

```bash
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
pg_dump "$DATABASE_URL" --format=custom --no-owner \
  | gpg --encrypt --recipient "$BACKUP_GPG_RECIPIENT" \
  > "/tmp/fsw-people-${STAMP}.dump.gpg"
aws s3 cp "/tmp/fsw-people-${STAMP}.dump.gpg" "s3://$BACKUP_BUCKET/db/" --sse AES256
rm -f "/tmp/fsw-people-${STAMP}.dump.gpg"
```

Backups are encrypted before they leave the host, and stored in a bucket **separate from the
document bucket** with a different access policy.

### Restore runbook

Rehearse this quarterly against a scratch database. An untested backup is not a backup.

**1. Assess.** Identify what is lost and the target recovery point. If the database is
intact and only data was damaged, prefer point-in-time recovery over a full restore.

**2. Stop writes.** Put the application into maintenance (scale to zero or return 503) so
recovery is not racing live traffic.

**3. Restore the database.**

```bash
# Point-in-time (preferred — managed provider):
#   restore to a NEW instance at the chosen timestamp, then repoint DATABASE_URL

# From an encrypted dump:
gpg --decrypt fsw-people-20260828T070000Z.dump.gpg > restore.dump
createdb fsw_people_restored
pg_restore --dbname=fsw_people_restored --no-owner --clean --if-exists restore.dump
```

**4. Verify before cutting over.**

```bash
psql "$RESTORED_URL" -c 'SELECT COUNT(*) FROM "Worker";'
psql "$RESTORED_URL" -c 'SELECT MAX("createdAt") FROM "AuditEvent";'   # confirms recency
psql "$RESTORED_URL" -c "SELECT tgname FROM pg_trigger WHERE tgname LIKE '%append_only%';"
```

The trigger check matters: a restore that silently drops the append-only triggers would
leave the audit trail mutable.

**5. Confirm encrypted fields decrypt.** With the *current* `FIELD_ENCRYPTION_KEY`, open a
worker profile with a stored identifier and reveal it. If this fails, the key does not match
the restored data — stop and locate the correct key before proceeding.

**6. Restore documents.** Object storage versioning covers accidental deletion; for a
regional loss, promote the replica bucket and update `S3_BUCKET`.

**7. Cut over.** Repoint `DATABASE_URL`, run `npx prisma migrate deploy` (a restore from an
older dump may lag the current schema), redeploy, and re-enable traffic.

**8. Reconcile.** Any writes between the recovery point and the incident are lost. Use the
audit log to identify what happened in that window and re-enter it deliberately.

**9. Record.** Write down what was lost, the actual RTO/RPO achieved, and what to change.

### Recovery objectives

| | Target |
|---|---|
| RPO (data loss) | ≤ 5 minutes with PITR; ≤ 24 hours from nightly dumps |
| RTO (downtime) | ≤ 2 hours for database restore and cutover |

---

## Observability

Track, and alert on:

| Signal | Where |
|---|---|
| Unhandled errors and request IDs | Platform logs; each error page shows a digest that matches a server log entry |
| Failed background jobs | Maintenance endpoint returns 500 on failure — alert on a non-200 |
| Email delivery failures | `EmailMessage.status = 'FAILED'`; visible in Admin → Email Outbox |
| Workflow failures | `WorkflowRun.status = 'FAILED'` with the error; visible in Admin → Workflows |
| Authentication anomalies | `AuditEvent.action = 'auth.login_failed'` — alert on spikes per IP or account |
| High-risk data access | `pii.reveal`, `export.run`, `retention.destruction_approved` — review periodically |
| Database health | Managed provider metrics: connections, slow queries, storage |

**Never log PII.** Application logs carry ids and action names, never decrypted
identifiers, bank details or personal contact information.

---

## Scaling notes

- All pages are server-rendered on demand and paginate at the database; the directory,
  audit log and reports never load an unbounded set.
- The Prisma client is a singleton per process. Behind a connection-limited managed
  database, use a pooled connection string (PgBouncer / Neon pooler).
- Documents stream from object storage rather than through application memory.
- Large exports currently render synchronously. The `ImportJob` pattern is the model to
  follow if asynchronous exports become necessary at higher volume.

---

## Rollback

```bash
# Application: redeploy the previous build (platform-specific)
# Database: forward-only. To undo a schema change, write a new migration that reverses it.
```

Never hand-edit `_prisma_migrations`. If a migration fails mid-deploy, restore from backup
and re-apply rather than patching state.
