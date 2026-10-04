param(
  [Parameter(Mandatory = $true)][string]$FileName,
  [switch]$Production
)
$ErrorActionPreference = "Stop"
if ($FileName -notmatch '^fleet-\d{8}-\d{6}\.sql\.gz$') { throw "Specify a valid file name from the backups directory." }
$projectDirectory = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$backupDirectory = Join-Path $projectDirectory $(if ($Production) { "backups\production" } else { "backups" })
$fullPath = Join-Path $backupDirectory $FileName
$composeArguments = @("compose")
if ($Production) {
  $composeArguments += @("--env-file", (Join-Path $projectDirectory ".env.production"), "-f", (Join-Path $projectDirectory "compose.production.yaml"))
}
if (-not (Test-Path -LiteralPath $fullPath)) { throw "Backup file not found: $FileName" }
$confirmation = Read-Host "This replaces the current database. Type RESTORE to continue"
if ($confirmation -cne "RESTORE") { Write-Host "Restore cancelled."; exit 0 }
Push-Location $projectDirectory
& docker @composeArguments stop app
try {
  & docker @composeArguments run --rm --no-deps db-backup sh /scripts/database/restore-backup.sh "/backups/$FileName"
  if ($LASTEXITCODE -ne 0) { throw "Database restore failed." }
} finally {
  & docker @composeArguments start app
  Pop-Location
}
Write-Host "Database restore completed: $FileName" -ForegroundColor Green
