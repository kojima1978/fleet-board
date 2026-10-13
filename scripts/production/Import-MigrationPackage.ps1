param(
  [Parameter(Mandatory = $true)][string]$ProjectDirectory,
  [string]$PackageDirectory
)

$ErrorActionPreference = "Stop"
$projectPath = [System.IO.Path]::GetFullPath($ProjectDirectory)
$messages = ConvertFrom-Json ([System.IO.File]::ReadAllText((Join-Path $projectPath "nfc-bridge\messages.ja.json"), [System.Text.Encoding]::UTF8))
if ([string]::IsNullOrWhiteSpace($PackageDirectory)) { $PackageDirectory = Read-Host $messages.migrationPackagePrompt }
if ([string]::IsNullOrWhiteSpace($PackageDirectory)) { throw $messages.migrationPackageMissing }
$packagePath = [System.IO.Path]::GetFullPath($PackageDirectory)
$manifestPath = Join-Path $packagePath "manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath)) { throw $messages.migrationManifestMissing }
if (-not (Test-Path -LiteralPath (Join-Path $projectPath ".env.production"))) { throw $messages.migrationStartFirst }

$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.formatVersion -ne 1 -or $manifest.backupFile -notmatch '^fleet-\d{8}-\d{6}\.sql\.gz$') { throw $messages.migrationUnsupported }
$source = Join-Path $packagePath $manifest.backupFile
if (-not (Test-Path -LiteralPath $source)) { throw $messages.migrationBackupFileMissing }
$actualHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne [string]$manifest.sha256) { throw $messages.migrationHashMismatch }

$backupDirectory = Join-Path $projectPath "backups\production"
if (-not (Test-Path -LiteralPath $backupDirectory)) { New-Item -ItemType Directory -Path $backupDirectory | Out-Null }
Copy-Item -LiteralPath $source -Destination (Join-Path $backupDirectory $manifest.backupFile) -Force
Write-Host $messages.migrationVerifying -ForegroundColor Cyan
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectPath "scripts\database\Verify-Backup.ps1") -Production -FileName $manifest.backupFile
if ($LASTEXITCODE -ne 0) { throw $messages.migrationVerifyFailed }
Write-Host $messages.migrationRestorePrompt -ForegroundColor Yellow
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectPath "scripts\database\Restore-Backup.ps1") -Production -FileName $manifest.backupFile
if ($LASTEXITCODE -ne 0) { throw $messages.migrationRestoreFailed }
