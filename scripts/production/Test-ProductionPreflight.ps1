param(
  [Parameter(Mandatory = $true)][string]$ProjectDirectory,
  [switch]$NoUi
)

$ErrorActionPreference = "Stop"
$projectPath = [System.IO.Path]::GetFullPath($ProjectDirectory)
$environmentPath = Join-Path $projectPath ".env.production"
$composePath = Join-Path $projectPath "compose.production.yaml"
$messagesPath = Join-Path $projectPath "nfc-bridge\messages.ja.json"
$messages = ConvertFrom-Json ([System.IO.File]::ReadAllText($messagesPath, [System.Text.Encoding]::UTF8))
$results = [System.Collections.Generic.List[object]]::new()
. (Join-Path $PSScriptRoot "FleetFlow-Network.ps1")

function Add-Result([string]$Name, [string]$Status, [string]$Detail) {
  $results.Add([pscustomobject]@{ Name = $Name; Status = $Status; Detail = $Detail })
}

function Get-Setting([string]$Name) {
  $line = Get-Content -LiteralPath $environmentPath | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -First 1
  if (-not $line) { return "" }
  return ($line -split "=", 2)[1].Trim()
}

try {
  if (-not (Test-Path -LiteralPath $environmentPath)) { throw $messages.preflightEnvironmentMissing }
  if (-not (Test-Path -LiteralPath $composePath)) { throw $messages.preflightComposeMissing }
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw $messages.preflightDockerMissing }
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw $messages.preflightDockerUnavailable }
  Add-Result $messages.healthDocker "ok" $messages.healthDockerOk

  & docker compose --project-directory $projectPath --env-file $environmentPath -f $composePath config --quiet
  if ($LASTEXITCODE -ne 0) { throw $messages.preflightComposeInvalid }
  Add-Result $messages.preflightCompose "ok" $messages.preflightComposeOk

  $pin = Get-Setting "FLEETFLOW_ADMIN_PIN"
  $secret = Get-Setting "FLEETFLOW_SESSION_SECRET"
  $password = Get-Setting "POSTGRES_PASSWORD"
  if ($pin -notmatch '^\d{4,12}$') { Add-Result $messages.preflightAdminPin "error" $messages.preflightAdminPinInvalid } else { Add-Result $messages.preflightAdminPin "ok" $messages.preflightConfigured }
  if ($secret.Length -lt 32) { Add-Result $messages.preflightSessionSecret "error" $messages.preflightSessionSecretInvalid } else { Add-Result $messages.preflightSessionSecret "ok" $messages.preflightConfigured }
  if ($password.Length -lt 24) { Add-Result $messages.preflightDatabasePassword "error" $messages.preflightDatabasePasswordInvalid } else { Add-Result $messages.preflightDatabasePassword "ok" $messages.preflightConfigured }

  $port = Get-Setting "FLEETFLOW_PORT"
  if ($port -notmatch '^\d{2,5}$' -or [int]$port -gt 65535) { Add-Result $messages.preflightPort "error" $messages.preflightPortInvalid } else { Add-Result $messages.preflightPort "ok" $port }
  $bindAddress = Get-Setting "FLEETFLOW_BIND_ADDRESS"
  if ([string]::IsNullOrWhiteSpace($bindAddress)) { Add-Result $messages.preflightAddress "error" $messages.preflightAddressMissing }
  elseif ($bindAddress -eq "0.0.0.0") { Add-Result $messages.preflightAddress "error" $messages.preflightAddressAll }
  else {
    $parsedAddress = $null
    if (-not [System.Net.IPAddress]::TryParse($bindAddress, [ref]$parsedAddress)) {
      Add-Result $messages.preflightAddress "error" $messages.preflightAddressInvalid
    }
    elseif ($bindAddress -ne "127.0.0.1" -and -not (Get-NetIPAddress -IPAddress $bindAddress -ErrorAction SilentlyContinue)) {
      Add-Result $messages.preflightAddress "error" $messages.preflightAddressNotLocal
    }
    else {
      Add-Result $messages.preflightAddress "ok" $bindAddress
      if ($bindAddress -ne "127.0.0.1" -and (Test-FleetFlowPublicNetwork -Address $bindAddress)) {
        Add-Result $messages.preflightNetworkProfile "warning" $messages.preflightNetworkProfilePublic
      }
    }
  }

  $driveName = [System.IO.Path]::GetPathRoot($projectPath).TrimEnd('\').TrimEnd(':')
  $freeGb = (Get-PSDrive -Name $driveName -PSProvider FileSystem).Free / 1GB
  Add-Result $messages.healthDisk $(if ($freeGb -ge 5) { "ok" } else { "warning" }) ("{0:N1}GB" -f $freeGb)
}
catch {
  Add-Result $messages.preflightCheck "error" $_.Exception.Message
}

$labels = @{ ok = $messages.healthStatusOk; warning = $messages.healthStatusWarning; error = $messages.healthStatusError }
$message = @($messages.preflightTitle, "") + ($results | ForEach-Object { "[$($labels[$_.Status])] $($_.Name): $($_.Detail)" })
$text = $message -join [Environment]::NewLine
if ($NoUi) { Write-Output $text }
else { Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show($text, $messages.preflightTitle) | Out-Null }
if ($results.Status -contains "error") { exit 1 }
exit 0
