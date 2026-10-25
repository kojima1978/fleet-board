$ErrorActionPreference = "Stop"
$installDir = Join-Path $env:LOCALAPPDATA "FleetFlow\NfcBridge"
$watchdogPidPath = Join-Path $installDir "watchdog.pid"
if (Test-Path -LiteralPath $watchdogPidPath) {
  $watchdogPid = 0
  if ([int]::TryParse((Get-Content -LiteralPath $watchdogPidPath -Raw).Trim(), [ref]$watchdogPid)) {
    $watchdog = Get-CimInstance Win32_Process -Filter "ProcessId = $watchdogPid" -ErrorAction SilentlyContinue
    if ($watchdog -and $watchdog.Name -match "powershell" -and $watchdog.CommandLine -like "*launch.ps1*" -and $watchdog.CommandLine -like "*-Watch*") {
      Stop-Process -Id $watchdogPid -Force -ErrorAction SilentlyContinue
    }
  }
}
$running = Get-Process -Name "FleetFlow.NfcBridge" -ErrorAction SilentlyContinue
if ($running) {
  $running | Stop-Process -Force
  $running | Wait-Process -Timeout 5 -ErrorAction SilentlyContinue
}
Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "FleetFlowNfcBridge" -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath "HKCU:\Software\Classes\fleetflow-nfc") { Remove-Item -LiteralPath "HKCU:\Software\Classes\fleetflow-nfc" -Recurse -Force }
if (Test-Path -LiteralPath $installDir) { Remove-Item -LiteralPath $installDir -Recurse -Force }
Write-Host "FleetFlow NFC Bridge uninstalled."
