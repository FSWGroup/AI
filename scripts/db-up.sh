#!/usr/bin/env bash
# Start PostgreSQL for local development.
#
# Prefers Docker Compose. Falls back to a system PostgreSQL install when no
# Docker daemon is available (which is the case in some CI and cloud sandboxes).
set -euo pipefail

DB_NAME="${DB_NAME:-fsw_layer0}"
DB_TEST_NAME="${DB_TEST_NAME:-fsw_layer0_test}"
DB_USER="${DB_USER:-fsw}"
DB_PASSWORD="${DB_PASSWORD:-fsw_local_dev}"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "==> Starting PostgreSQL via Docker Compose"
  docker compose up -d postgres
  for _ in $(seq 1 30); do
    if docker compose exec -T postgres pg_isready -U "$DB_USER" >/dev/null 2>&1; then
      echo "==> PostgreSQL ready"
      exit 0
    fi
    sleep 1
  done
  echo "PostgreSQL did not become ready in time" >&2
  exit 1
fi

echo "==> No Docker daemon; using system PostgreSQL"
if ! command -v psql >/dev/null 2>&1; then
  echo "Neither Docker nor a system PostgreSQL client is available." >&2
  echo "Install Docker Desktop, or PostgreSQL 16+, then re-run." >&2
  exit 1
fi

if command -v pg_ctlcluster >/dev/null 2>&1; then
  pg_ctlcluster "$(ls /usr/lib/postgresql | sort -n | tail -1)" main start 2>/dev/null || true
fi

as_superuser() { if [ "$(id -u)" = "0" ]; then su postgres -c "$1"; else eval "$1"; fi }

as_superuser "psql -v ON_ERROR_STOP=1 -tAc \"SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'\"" \
  | grep -q 1 || as_superuser "psql -v ON_ERROR_STOP=1 -c \"CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}' CREATEDB\""

for db in "$DB_NAME" "$DB_TEST_NAME"; do
  as_superuser "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='${db}'\"" | grep -q 1 \
    || as_superuser "createdb -O ${DB_USER} ${db}"
done

echo "==> PostgreSQL ready (${DB_NAME}, ${DB_TEST_NAME})"
