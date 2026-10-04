param([switch]$Production)
$ErrorActionPreference = "Stop"
$projectDirectory = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$composeArguments = @("compose")
if ($Production) {
  $composeArguments += @("--env-file", (Join-Path $projectDirectory ".env.production"), "-f", (Join-Path $projectDirectory "compose.production.yaml"))
}
Push-Location $projectDirectory
try {
  & docker @composeArguments run --rm --no-deps db-backup sh /scripts/database/backup-db.sh
  if ($LASTEXITCODE -ne 0) { throw "Database backup failed." }
  Write-Host "Database backup completed." -ForegroundColor Green
} finally { Pop-Location }
