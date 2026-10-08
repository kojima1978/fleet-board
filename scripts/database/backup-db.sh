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
  # Docker Desktopの停止・PCスリープ中は長時間sleepが持ち越されるため、
  # 短い間隔で最終バックアップ時刻を確認して日次実行を保証する。
  while sleep "${BACKUP_CHECK_INTERVAL_SECONDS:-300}"; do
    if ! find /backups -type f -name 'fleet-*.sql.gz' -mmin "-${BACKUP_MAX_AGE_MINUTES:-1380}" -print -quit | grep -q .; then
      backup_once
    fi
  done
fi
