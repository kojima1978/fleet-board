param(
  [switch]$ShowStatus,
  [switch]$Watch,
  [ValidateRange(5, 60)]
  [int]$StartupTimeoutSeconds = 15
)

$ErrorActionPreference = "Stop"
$bridgeName = "FleetFlow.NfcBridge"
$bridgeExe = Join-Path $PSScriptRoot "$bridgeName.exe"
if (-not (Test-Path -LiteralPath $bridgeExe)) {
  $bridgeExe = Join-Path $PSScriptRoot "dist\$bridgeName.exe"
}
$healthUrl = "http://127.0.0.1:17831/health"
$logPath = Join-Path $PSScriptRoot "nfc-bridge-launch.log"
$watchdogPidPath = Join-Path $PSScriptRoot "watchdog.pid"

function Write-BridgeLog([string]$message) {
  try {
    if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 1MB) {
      $previous = "$logPath.previous"
      Remove-Item -LiteralPath $previous -Force -ErrorAction SilentlyContinue
      Move-Item -LiteralPath $logPath -Destination $previous -Force
    }
    Add-Content -LiteralPath $logPath -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message) -Encoding UTF8
  }
  catch { }
}

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

function Start-Bridge {
  if (Test-BridgeHealth) { return $true }
  if (-not (Test-Path -LiteralPath $bridgeExe)) {
    Write-BridgeLog "Bridge executable was not found: $bridgeExe"
    return $false
  }

  $stale = Get-Process -Name $bridgeName -ErrorAction SilentlyContinue
  if ($stale) {
    Write-BridgeLog "Stopping unresponsive bridge process."
    $stale | Stop-Process -Force
    $stale | Wait-Process -Timeout 5 -ErrorAction SilentlyContinue
  }

  try {
    $process = Start-Process -FilePath $bridgeExe -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
    Write-BridgeLog "Bridge start requested. PID=$($process.Id)"
  }
  catch {
    Write-BridgeLog "Bridge process could not be started: $($_.Exception.Message)"
    return $false
  }

  $attempts = $StartupTimeoutSeconds * 4
  foreach ($attempt in 1..$attempts) {
    Start-Sleep -Milliseconds 250
    if (Test-BridgeHealth) {
      Write-BridgeLog "Bridge health check passed. PID=$($process.Id)"
      return $true
    }
    if ($process.HasExited) {
      Write-BridgeLog "Bridge process exited before becoming ready. ExitCode=$($process.ExitCode)"
      return $false
    }
  }

  Write-BridgeLog "Bridge health check timed out after $StartupTimeoutSeconds seconds."
  return $false
}

if ($Watch) {
  $createdNew = $false
  $mutex = New-Object System.Threading.Mutex($true, "Local\FleetFlowNfcBridgeWatchdog", [ref]$createdNew)
  if (-not $createdNew) {
    Write-BridgeLog "Another watchdog is already running."
    $mutex.Dispose()
    exit 0
  }

  Set-Content -LiteralPath $watchdogPidPath -Value $PID -Encoding ASCII
  Write-BridgeLog "Watchdog started. PID=$PID"
  try {
    while ($true) {
      if (-not (Test-BridgeHealth)) {
        Write-BridgeLog "Bridge is unavailable; automatic restart begins."
        $null = Start-Bridge
      }
      Start-Sleep -Seconds 5
    }
  }
  finally {
    Remove-Item -LiteralPath $watchdogPidPath -Force -ErrorAction SilentlyContinue
    $mutex.ReleaseMutex()
    $mutex.Dispose()
    Write-BridgeLog "Watchdog stopped."
  }
}

if (Start-Bridge) {
  Show-BridgeMessage "NFC bridge started. Cards can now be scanned."
  exit 0
}

Show-BridgeMessage "NFC bridge could not be started. Reconnect the reader and try again."
exit 1
