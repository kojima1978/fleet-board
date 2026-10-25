#!/bin/sh
set -eu

# ソースはWindowsから共有し、node_modulesはDockerボリュームに保持している。
# pullでpackage-lock.jsonだけ更新された場合に古い依存が残らないよう、変更時だけ同期する。
dependency_stamp="node_modules/.fleetflow-package-lock.sha256"
lock_hash="$(sha256sum package-lock.json | awk '{print $1}')"
installed_hash="$(cat "$dependency_stamp" 2>/dev/null || true)"
if [ "$lock_hash" != "$installed_hash" ]; then
  echo "package-lock.json changed; synchronizing development dependencies..."
  npm ci --no-audit --no-fund
  printf '%s\n' "$lock_hash" > "$dependency_stamp"
fi

# Prisma Client generation never requires application tables and is safe first.
npm run db:generate

schema_state="$(node scripts/development/schema-state.mjs)"
if [ "$schema_state" = "existing" ]; then
  # Upgrade legacy columns before Prisma reconciles an existing database.
  npm run db:migrate:employee-numbers
  npm run db:migrate:vehicle-numbers
  npm run db:migrate:nfc-uids
  npm run db:migrate:employee-normalization
  npm run db:migrate:unified-nfc
  npm run db:migrate:operation-ids
  npm run db:migrate:qr-tokens
  npm run db:migrate:employee-emails
elif [ "$schema_state" != "empty" ]; then
  echo "Unknown database state: $schema_state" >&2
  exit 1
fi

# Creates every table on a fresh database and reconciles an upgraded database.
npm run db:push

# Idempotent post-schema checks ensure indexes and normalized data exist.
npm run db:migrate:employee-numbers
npm run db:migrate:vehicle-numbers
npm run db:migrate:employee-normalization
npm run db:migrate:unified-nfc
npm run db:migrate:nfc-uids
npm run db:migrate:operation-ids
npm run db:migrate:record-codes
npm run db:migrate:qr-tokens
npm run db:migrate:employee-emails
npm run db:seed
