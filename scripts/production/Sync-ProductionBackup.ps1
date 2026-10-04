param(
  [Parameter(Mandatory = $true)][string]$ProjectDirectory,
  [string]$Destination
)

$ErrorActionPreference = "Stop"
$projectPath = [System.IO.Path]::GetFullPath($ProjectDirectory)
$environmentPath = Join-Path $projectPath ".env.production"
$backupPath = Join-Path $projectPath "backups\production"
$settings = @{}
foreach ($line in [System.IO.File]::ReadAllLines($environmentPath, [System.Text.Encoding]::UTF8)) {
  if ($line -match '^([^#=]+)=(.*)$') { $settings[$matches[1].Trim()] = $matches[2].Trim() }
}
if ([string]::IsNullOrWhiteSpace($Destination)) { $Destination = $settings["FLEETFLOW_BACKUP_DESTINATION"] }
if ([string]::IsNullOrWhiteSpace($Destination)) { throw "Set FLEETFLOW_BACKUP_DESTINATION in .env.production first." }
$latest = Get-ChildItem -LiteralPath $backupPath -File -Filter "fleet-*.sql.gz" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $latest) { throw "No production backup was found." }
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
Copy-Item -LiteralPath $latest.FullName -Destination (Join-Path $Destination $latest.Name) -Force
$hash = (Get-FileHash -LiteralPath $latest.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText((Join-Path $Destination "$($latest.Name).sha256"), "$hash  $($latest.Name)`n", (New-Object System.Text.UTF8Encoding($false)))
Get-ChildItem -LiteralPath $Destination -File -Filter "fleet-*.sql.gz" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item -Force
Write-Output "Production backup copied to $Destination"
