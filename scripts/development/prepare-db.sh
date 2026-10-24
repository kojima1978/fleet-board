#!/bin/sh
set -eu

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
npm run db:seed
