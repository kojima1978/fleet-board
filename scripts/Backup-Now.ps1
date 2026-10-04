$ErrorActionPreference = "Stop"
docker compose run --rm db-backup sh /scripts/backup-db.sh
if ($LASTEXITCODE -ne 0) { throw "Database backup failed." }
Write-Host "Database backup completed." -ForegroundColor Green
