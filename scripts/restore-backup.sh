#!/bin/sh
set -eu

source_file="${1:-}"
case "$source_file" in /backups/fleet-*.sql.gz) ;; *) echo "Invalid backup path" >&2; exit 2 ;; esac
test -f "$source_file"
PGPASSWORD="$POSTGRES_PASSWORD" dropdb -h db -U "$POSTGRES_USER" --if-exists fleet
PGPASSWORD="$POSTGRES_PASSWORD" createdb -h db -U "$POSTGRES_USER" fleet
gzip -dc "$source_file" | PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h db -U "$POSTGRES_USER" -d fleet >/dev/null
echo "Database restored: $source_file"
