#!/bin/sh
set -eu

source_file="${1:-}"
case "$source_file" in /backups/fleet-*.sql.gz) ;; *) echo "Invalid backup path" >&2; exit 2 ;; esac
test -f "$source_file"
PGPASSWORD="$POSTGRES_PASSWORD" dropdb -h db -U "$POSTGRES_USER" --if-exists fleet_restore_check
PGPASSWORD="$POSTGRES_PASSWORD" createdb -h db -U "$POSTGRES_USER" fleet_restore_check
gzip -dc "$source_file" | PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h db -U "$POSTGRES_USER" -d fleet_restore_check >/dev/null
PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h db -U "$POSTGRES_USER" -d fleet_restore_check -tAc 'SELECT COUNT(*) FROM "Vehicle"; SELECT COUNT(*) FROM "Employee";' >/dev/null
PGPASSWORD="$POSTGRES_PASSWORD" dropdb -h db -U "$POSTGRES_USER" fleet_restore_check
touch /backups/.last-verified
echo "Restore verification completed: $source_file"
