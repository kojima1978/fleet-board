param(
  [Parameter(Mandatory = $true)][string]$ProjectDirectory,
  [switch]$NoUi
)

$ErrorActionPreference = "Stop"
$projectPath = [System.IO.Path]::GetFullPath($ProjectDirectory)
$environmentPath = Join-Path $projectPath ".env.production"
$composePath = Join-Path $projectPath "compose.production.yaml"
$logPath = Join-Path $projectPath "nfc-bridge\health-check.log"
$messagesPath = Join-Path $projectPath "nfc-bridge\messages.ja.json"
$messages = ConvertFrom-Json ([System.IO.File]::ReadAllText($messagesPath, [System.Text.Encoding]::UTF8))
$checks = [System.Collections.Generic.List[object]]::new()

function Add-Check([string]$name, [string]$status, [string]$detail) {
  $checks.Add([pscustomobject]@{ Name = $name; Status = $status; Detail = $detail })
}

function Get-EnvironmentValue([string]$name) {
  $line = Get-Content -LiteralPath $environmentPath | Where-Object { $_ -match "^$([regex]::Escape($name))=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -split "=", 2)[1].Trim()
}

try {
  if (-not (Test-Path -LiteralPath $environmentPath)) { throw "production environment file is missing" }
  if (-not (Test-Path -LiteralPath $composePath)) { throw "production compose file is missing" }
  $composeArguments = @("compose", "--project-directory", $projectPath, "--env-file", $environmentPath, "-f", $composePath)
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is unavailable" }
  Add-Check $messages.healthDocker "ok" $messages.healthDockerOk

  foreach ($service in @("app", "db", "db-backup")) {
    $containerId = (& docker @composeArguments ps -q $service | Select-Object -First 1)
    if (-not $containerId) { Add-Check $service "error" $messages.healthContainerMissing; continue }
    $containerState = (& docker inspect --format '{{.State.Status}}' $containerId).Trim()
    $healthState = (& docker inspect --format '{{.State.Health.Status}}' $containerId 2>$null).Trim()
    if ([string]::IsNullOrWhiteSpace($healthState) -or $healthState -eq '<no value>') { $healthState = "none" }
    $restarts = [int]((& docker inspect --format '{{.RestartCount}}' $containerId).Trim())
    $healthy = $containerState -eq "running" -and ($healthState -eq "healthy" -or $healthState -eq "none")
    $status = if (-not $healthy) { "error" } elseif ($restarts -gt 3) { "warning" } else { "ok" }
    Add-Check $service $status ($messages.healthContainerDetail -f $containerState, $healthState, $restarts)
  }

  $port = Get-EnvironmentValue "FLEETFLOW_PORT"
  if ($port -notmatch '^\d{2,5}$') { $port = "3035" }
  try {
    $health = Invoke-RestMethod -Uri "http://localhost:$port/api/health" -TimeoutSec 5
    $appOk = $health.status -eq "ok" -and $health.database -eq "ok"
    Add-Check $messages.healthAppResponse $(if ($appOk) { "ok" } else { "error" }) ($messages.healthAppDetail -f $health.status, $health.database)
    $now = Get-Date
    foreach ($item in @(@($messages.healthBackup, $health.backup.latestAt), @($messages.healthRestore, $health.backup.verifiedAt))) {
      if (-not $item[1]) { Add-Check $item[0] "error" $messages.healthTimeMissing; continue }
      $age = $now.ToUniversalTime() - ([datetime]$item[1]).ToUniversalTime()
      Add-Check $item[0] $(if ($age.TotalHours -le 26) { "ok" } else { "error" }) ($messages.healthHoursAgo -f $age.TotalHours)
    }
  }
  catch { Add-Check $messages.healthAppResponse "error" $_.Exception.Message }

  $driveName = [System.IO.Path]::GetPathRoot($projectPath).TrimEnd('\').TrimEnd(':')
  $drive = Get-PSDrive -Name $driveName -PSProvider FileSystem
  $freeGb = $drive.Free / 1GB
  Add-Check $messages.healthDisk $(if ($freeGb -ge 5) { "ok" } else { "warning" }) ($messages.healthDiskDetail -f $freeGb)

  $externalDestination = Get-EnvironmentValue "FLEETFLOW_BACKUP_DESTINATION"
  if ([string]::IsNullOrWhiteSpace($externalDestination)) {
    Add-Check $messages.healthExternalBackup "warning" $messages.healthExternalNotConfigured
  }
  elseif (-not (Test-Path -LiteralPath $externalDestination)) {
    Add-Check $messages.healthExternalBackup "warning" $messages.healthExternalUnavailable
  }
  else {
    $externalLatest = Get-ChildItem -LiteralPath $externalDestination -File -Filter "fleet-*.sql.gz" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $externalAge = if ($externalLatest) { (Get-Date) - $externalLatest.LastWriteTime } else { $null }
    Add-Check $messages.healthExternalBackup $(if ($externalAge -and $externalAge.TotalHours -le 26) { "ok" } else { "warning" }) $(if ($externalLatest) { $externalLatest.Name } else { $messages.healthExternalMissing })
  }
}
catch {
  Add-Check $messages.healthCheck "error" $_.Exception.Message
}

$statusLabels = @{ ok = $messages.healthStatusOk; warning = $messages.healthStatusWarning; error = $messages.healthStatusError }
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$summary = @(("{0} {1}" -f $messages.healthTitle, $stamp), "") + ($checks | ForEach-Object { "[$($statusLabels[$_.Status])] $($_.Name): $($_.Detail)" })
$message = $summary -join [Environment]::NewLine
Add-Content -LiteralPath $logPath -Value $message -Encoding UTF8
Add-Content -LiteralPath $logPath -Value "" -Encoding UTF8
if ($NoUi) { Write-Output $message }
else {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($message, $messages.healthTitle) | Out-Null
}
if ($checks.Status -contains "error") { exit 1 }
exit 0
