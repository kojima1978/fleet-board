param([switch]$Production, [string]$FileName)
$ErrorActionPreference = "Stop"
$projectDirectory = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$backupDirectory = Join-Path $projectDirectory $(if ($Production) { "backups\production" } else { "backups" })
$composeArguments = @("compose")
if ($Production) {
  $composeArguments += @("--env-file", (Join-Path $projectDirectory ".env.production"), "-f", (Join-Path $projectDirectory "compose.production.yaml"))
}
$latest = if ($FileName) {
  if ($FileName -notmatch '^fleet-\d{8}-\d{6}\.sql\.gz$') { throw "Specify a valid backup file name." }
  Get-Item -LiteralPath (Join-Path $backupDirectory $FileName) -ErrorAction Stop
} else {
  Get-ChildItem -LiteralPath $backupDirectory -Filter "fleet-*.sql.gz" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if (-not $latest) { throw "No backup file was found." }
Push-Location $projectDirectory
try {
  & docker @composeArguments run --rm --no-deps db-backup sh /scripts/database/verify-backup.sh "/backups/$($latest.Name)"
  if ($LASTEXITCODE -ne 0) { throw "Backup restore verification failed." }
  Write-Host "Backup restore verification completed: $($latest.Name)" -ForegroundColor Green
} finally { Pop-Location }
