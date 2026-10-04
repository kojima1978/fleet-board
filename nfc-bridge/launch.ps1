param(
  [switch]$ShowStatus
)

$ErrorActionPreference = "Stop"
$bridgeName = "FleetFlow.NfcBridge"
$bridgeExe = Join-Path $PSScriptRoot "$bridgeName.exe"
if (-not (Test-Path -LiteralPath $bridgeExe)) {
  $bridgeExe = Join-Path $PSScriptRoot "dist\$bridgeName.exe"
}
$healthUrl = "http://127.0.0.1:17831/health"

function Test-BridgeHealth {
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    return $health.status -eq "ok"
  }
  catch {
    return $false
  }
}

function Show-BridgeMessage([string]$message, [string]$title = "FleetFlow NFC") {
  if (-not $ShowStatus) { return }
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($message, $title) | Out-Null
}

if (Test-BridgeHealth) {
  Show-BridgeMessage "NFC bridge is already running."
  exit 0
}

if (-not (Test-Path -LiteralPath $bridgeExe)) {
  Show-BridgeMessage "NFC bridge was not found. Please reinstall it."
  exit 1
}

Get-Process -Name $bridgeName -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process -FilePath $bridgeExe -WorkingDirectory $PSScriptRoot -WindowStyle Hidden

foreach ($attempt in 1..20) {
  Start-Sleep -Milliseconds 250
  if (Test-BridgeHealth) {
    Show-BridgeMessage "NFC bridge started. Cards can now be scanned."
    exit 0
  }
}

Show-BridgeMessage "NFC bridge could not be started. Reconnect the reader and try again."
exit 1
