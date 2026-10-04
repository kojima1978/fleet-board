param([Parameter(Mandatory = $true)][string]$ProjectDirectory)

$ErrorActionPreference = "Stop"
$projectPath = [System.IO.Path]::GetFullPath($ProjectDirectory)
$logPath = Join-Path $projectPath "nfc-bridge\backup-sync.log"
try {
  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectPath "scripts\database\Backup-Now.ps1") -Production
  if ($LASTEXITCODE -ne 0) { throw "Production backup failed." }
  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectPath "scripts\production\Sync-ProductionBackup.ps1") -ProjectDirectory $projectPath
  if ($LASTEXITCODE -ne 0) { throw "Production backup sync failed." }
  Add-Content -LiteralPath $logPath -Value ("{0} Backup and sync completed." -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss")) -Encoding UTF8
}
catch {
  Add-Content -LiteralPath $logPath -Value ("{0} Backup and sync failed: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $_.Exception.Message) -Encoding UTF8
  exit 1
}
