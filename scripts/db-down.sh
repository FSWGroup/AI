#!/usr/bin/env bash
set -euo pipefail
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker compose down
elif command -v pg_ctlcluster >/dev/null 2>&1; then
  pg_ctlcluster "$(ls /usr/lib/postgresql | sort -n | tail -1)" main stop || true
fi
