$ErrorActionPreference = "Stop"
$latest = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot "..\backups") -Filter "fleet-*.sql.gz" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $latest) { throw "No backup file was found." }
docker compose run --rm db-backup sh /scripts/verify-backup.sh "/backups/$($latest.Name)"
if ($LASTEXITCODE -ne 0) { throw "Backup restore verification failed." }
Write-Host "Backup restore verification completed: $($latest.Name)" -ForegroundColor Green
