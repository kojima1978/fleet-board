param(
  [Parameter(Mandatory = $true)][string]$ProjectDirectory,
  [string]$Destination
)

$ErrorActionPreference = "Stop"
$projectPath = [System.IO.Path]::GetFullPath($ProjectDirectory)
$messages = ConvertFrom-Json ([System.IO.File]::ReadAllText((Join-Path $projectPath "nfc-bridge\messages.ja.json"), [System.Text.Encoding]::UTF8))
if ([string]::IsNullOrWhiteSpace($Destination)) { $Destination = Read-Host $messages.migrationDestinationPrompt }
if ([string]::IsNullOrWhiteSpace($Destination)) { throw $messages.migrationDestinationMissing }
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
if (-not (Test-Path -LiteralPath $destinationPath)) { New-Item -ItemType Directory -Path $destinationPath | Out-Null }

& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectPath "scripts\database\Backup-Now.ps1") -Production
if ($LASTEXITCODE -ne 0) { throw $messages.migrationBackupFailed }

$backupDirectory = Join-Path $projectPath "backups\production"
$backup = Get-ChildItem -LiteralPath $backupDirectory -File -Filter "fleet-*.sql.gz" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $backup) { throw $messages.migrationBackupMissing }

$packageDirectory = Join-Path $destinationPath ("FleetFlow-Migration-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $packageDirectory | Out-Null
$copiedBackup = Join-Path $packageDirectory $backup.Name
Copy-Item -LiteralPath $backup.FullName -Destination $copiedBackup
$manifest = [ordered]@{
  formatVersion = 1
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  backupFile = $backup.Name
  sha256 = (Get-FileHash -LiteralPath $copiedBackup -Algorithm SHA256).Hash.ToLowerInvariant()
  appCommit = (& git -C $projectPath rev-parse HEAD 2>$null | Select-Object -First 1)
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $packageDirectory "manifest.json") -Encoding UTF8
Write-Host ($messages.migrationExported -f $packageDirectory) -ForegroundColor Green
Write-Host $messages.migrationExportNext
