# ADR-0030: Managed PostgreSQL and container hosting; restore is tested, not assumed

- Status: Accepted (provisional) — depends on unanswered questions H1–H3
- Date: 2026-08-29

## Context

§70 requires defined RPO/RTO, automated backups, PITR, object-storage protection,
encryption, retention, and — above all — tested restoration. §84 requires a design a
small team can operate. Cloud preference is unanswered (H1) and Microsoft 365 usage would
point toward Azure.

## Decision

### Shape, deliberately provider-agnostic

- The application is a **container image** running two process types from one image: the
  API server and a background worker (dispatcher, ingestion, scheduled jobs). No
  Kubernetes.
- **Managed PostgreSQL** with automated backups and PITR. Not self-managed: backup
  automation and failover are precisely the operational load a small team should buy.
- **S3-compatible object storage** with versioning and lifecycle rules (ADR-0026).
- Secrets in the platform's secret manager. Never in the repository, seeds,
  `.env.example`, or logs. `.env.example` contains names and placeholders only.
- Database roles are separated: `fsw_app` (DML, no DDL, no `UPDATE`/`DELETE` on `audit`),
  `fsw_migrate` (DDL, used only by the migration job), `fsw_readonly` (analytics),
  `fsw_maintenance` (retention and erasure jobs).

Provisional target: **Azure Container Apps + Azure Database for PostgreSQL Flexible
Server + Azure Blob Storage (S3-compatible access via a gateway) or AWS App Runner + RDS
+ S3**, decided when H1 is answered. Nothing in the code depends on the answer.

### Environments

`local` → `ci` → `staging` → `production`. Staging is recommended and costs roughly double
the infrastructure; it halves deployment risk and is where restore drills run. Production
credentials never appear anywhere else, and connectors have a test mode with fixtures.

### Deployment

Migrations run as a **separate job before** the new image serves traffic, so a failed
migration never leaves a half-deployed application. Expand → backfill → validate →
contract for anything destructive (ADR-0006). Rolling replacement with health checks;
rollback is redeploying the previous image, which is safe because migrations are
forward-only and backward-compatible within a release pair.

### RPO / RTO

Provisional, pending H2: **RPO 5 minutes** (PITR), **RTO 4 hours**. These are assumptions
of record (A-018/A-019).

### Restore is a tested procedure

`docs/runbooks/restore.md` documents the full drill: provision a clean environment,
restore the database to a point in time, restore or re-point object storage, run schema
and data validation, verify application health, and verify a sample of critical data.
A **quarterly restore drill is scheduled and its result recorded**; an undrilled backup
is treated as no backup. Acceptance criterion 27 is this drill, automated as far as the
environment allows.

Backups are encrypted at rest and in transit; retention is 35 days of PITR plus monthly
archives for one year, pending K2.

## Alternatives considered

- **Kubernetes.** Forbidden by §80 and disproportionate.
- **Self-managed PostgreSQL on a VM.** Cheaper and a false economy — it makes a small
  team responsible for backup correctness and failover.
- **Serverless functions.** A poor fit for long-running ingestion, background dispatch,
  and connection pooling.
- **Heroku / Render / Fly.io.** Genuinely reasonable for this workload and lower
  operational effort than either hyperscaler; they remain viable if budget (A5) favours
  simplicity over enterprise alignment.

## Consequences

- Two process types from one image keeps the build simple and the deployment story short.
- Provider choice is deferred without blocking any code.

## Risks

Restore drills get skipped when busy. Mitigated by scheduling them and by recording the
result where its absence is visible.

## Reversal cost

Low — containers and managed PostgreSQL are portable.

## Revisit if

H1/H2/A5 arrive with constraints that change the calculus.
