param(
  [switch]$ShowStatus,
  [switch]$Watch,
  [switch]$Reconnect,
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
$messagesPath = Join-Path $PSScriptRoot "messages.ja.json"
$bridgeMessages = $null
try {
  if (Test-Path -LiteralPath $messagesPath) {
    $bridgeMessages = Get-Content -LiteralPath $messagesPath -Raw | ConvertFrom-Json
  }
}
catch { }

function Get-BridgeMessage([string]$name, [string]$fallback) {
  if ($bridgeMessages -and $bridgeMessages.PSObject.Properties.Name -contains $name) {
    return $bridgeMessages.$name
  }
  return $fallback
}

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

function Test-WatchdogRunning {
  if (-not (Test-Path -LiteralPath $watchdogPidPath)) { return $false }
  $watchdogPid = 0
  if (-not [int]::TryParse((Get-Content -LiteralPath $watchdogPidPath -Raw).Trim(), [ref]$watchdogPid)) { return $false }
  $watchdog = Get-CimInstance Win32_Process -Filter "ProcessId = $watchdogPid" -ErrorAction SilentlyContinue
  return $watchdog -and $watchdog.Name -match "powershell" -and $watchdog.CommandLine -like "*launch.ps1*" -and $watchdog.CommandLine -like "*-Watch*"
}

function Ensure-Watchdog {
  if (Test-WatchdogRunning) { return }
  $powerShell = Join-Path $PSHOME "powershell.exe"
  Start-Process -FilePath $powerShell -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", ('"' + $PSCommandPath + '"'), "-Watch") -WindowStyle Hidden
  Write-BridgeLog "Watchdog start requested by the recovery launcher."
}

function Request-BridgeReconnect {
  $configPath = Join-Path $PSScriptRoot "bridge.json"
  $origin = "http://localhost:3035"
  try {
    if (Test-Path -LiteralPath $configPath) {
      $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
      $configuredOrigin = @($config.allowedOrigins | Where-Object { $_ }) | Select-Object -First 1
      if ($configuredOrigin) { $origin = $configuredOrigin.TrimEnd('/') }
    }
    Invoke-RestMethod -Uri "http://127.0.0.1:17831/reconnect" -Headers @{ Origin = $origin } -TimeoutSec 2 | Out-Null
    Write-BridgeLog "NFC/QR device reconnect was requested."
    return $true
  }
  catch {
    Write-BridgeLog "NFC/QR device reconnect request failed: $($_.Exception.Message)"
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

Ensure-Watchdog

if ($Reconnect -and (Test-BridgeHealth)) {
  $requested = Request-BridgeReconnect
  if ($requested) {
    # Give the watchdog enough time to observe the intentional Bridge exit and
    # restart it. Fall back to a direct start if the watchdog is not running.
    $sawOffline = $false
    foreach ($attempt in 1..32) {
      Start-Sleep -Milliseconds 250
      $healthy = Test-BridgeHealth
      if (-not $healthy) { $sawOffline = $true }
      if ($sawOffline -and $healthy) {
        Show-BridgeMessage (Get-BridgeMessage "scannerReconnectSucceeded" "NFC/QR devices were reconnected.") (Get-BridgeMessage "scannerShortcutTitle" "FleetFlow NFC/QR")
        exit 0
      }
    }
  }
}

if (Start-Bridge) {
  Show-BridgeMessage (Get-BridgeMessage "scannerConnectionReady" "NFC/QR connection is ready.") (Get-BridgeMessage "scannerShortcutTitle" "FleetFlow NFC/QR")
  exit 0
}

Show-BridgeMessage (Get-BridgeMessage "scannerConnectionFailed" "NFC/QR connection could not be prepared. Reconnect the reader and try again.") (Get-BridgeMessage "scannerShortcutTitle" "FleetFlow NFC/QR")
exit 1
