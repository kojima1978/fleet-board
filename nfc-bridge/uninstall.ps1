$ErrorActionPreference = "Stop"
$installDir = Join-Path $env:LOCALAPPDATA "FleetFlow\NfcBridge"
$running = Get-Process -Name "FleetFlow.NfcBridge" -ErrorAction SilentlyContinue
if ($running) {
  $running | Stop-Process -Force
  $running | Wait-Process -Timeout 5 -ErrorAction SilentlyContinue
}
Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "FleetFlowNfcBridge" -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $installDir) { Remove-Item -LiteralPath $installDir -Recurse -Force }
Write-Host "FleetFlow NFC Bridge uninstalled."
