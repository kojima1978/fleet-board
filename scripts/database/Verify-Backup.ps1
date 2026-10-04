param([switch]$Production)
$ErrorActionPreference = "Stop"
$projectDirectory = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$backupDirectory = Join-Path $projectDirectory $(if ($Production) { "backups\production" } else { "backups" })
$composeArguments = @("compose")
if ($Production) {
  $composeArguments += @("--env-file", (Join-Path $projectDirectory ".env.production"), "-f", (Join-Path $projectDirectory "compose.production.yaml"))
}
$latest = Get-ChildItem -LiteralPath $backupDirectory -Filter "fleet-*.sql.gz" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $latest) { throw "No backup file was found." }
Push-Location $projectDirectory
try {
  & docker @composeArguments run --rm --no-deps db-backup sh /scripts/database/verify-backup.sh "/backups/$($latest.Name)"
  if ($LASTEXITCODE -ne 0) { throw "Backup restore verification failed." }
  Write-Host "Backup restore verification completed: $($latest.Name)" -ForegroundColor Green
} finally { Pop-Location }
