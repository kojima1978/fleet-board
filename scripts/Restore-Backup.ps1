param([Parameter(Mandatory = $true)][string]$FileName)
$ErrorActionPreference = "Stop"
if ($FileName -notmatch '^fleet-\d{8}-\d{6}\.sql\.gz$') { throw "Specify a valid file name from the backups directory." }
$fullPath = Join-Path (Join-Path $PSScriptRoot "..\backups") $FileName
if (-not (Test-Path -LiteralPath $fullPath)) { throw "Backup file not found: $FileName" }
$confirmation = Read-Host "This replaces the current database. Type RESTORE to continue"
if ($confirmation -cne "RESTORE") { Write-Host "Restore cancelled."; exit 0 }
docker compose stop app
try {
  docker compose run --rm db-backup sh /scripts/restore-backup.sh "/backups/$FileName"
  if ($LASTEXITCODE -ne 0) { throw "Database restore failed." }
} finally {
  docker compose start app
}
Write-Host "Database restore completed: $FileName" -ForegroundColor Green
