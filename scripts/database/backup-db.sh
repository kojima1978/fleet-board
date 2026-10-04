#!/bin/sh
set -eu

backup_once() {
  mkdir -p /backups
  target="/backups/fleet-$(date +%Y%m%d-%H%M%S).sql.gz"
  pg_dump -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges | gzip -9 > "$target"
  find /backups -type f -name 'fleet-*.sql.gz' -mtime +30 -delete
  echo "Backup completed: $target"
  if [ "${AUTO_VERIFY_BACKUP:-false}" = "true" ]; then
    sh /scripts/database/verify-backup.sh "$target"
  fi
}

backup_once
if [ "${1:-}" = "loop" ]; then
  while sleep 86400; do backup_once; done
fi
