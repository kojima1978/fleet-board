#!/bin/sh
set -eu

# Upgrade legacy schemas before and after Prisma applies the current schema.
npm run db:migrate:employee-numbers
npm run db:migrate:vehicle-numbers
npm run db:migrate:nfc-uids
npm run db:migrate:employee-normalization
npm run db:migrate:unified-nfc
npm run db:generate
node scripts/production/prepare-migrations.mjs
npm run db:migrate:deploy
npm run db:migrate:employee-numbers
npm run db:migrate:vehicle-numbers
npm run db:migrate:employee-normalization
npm run db:migrate:unified-nfc
npm run db:migrate:nfc-uids
npm run db:migrate:operation-ids
npm run db:seed:production
