param([switch]$Force)

$ErrorActionPreference = "Stop"
$installDir = Join-Path $env:LOCALAPPDATA "FleetFlow\NfcBridge"
$messagesPath = Join-Path $installDir "messages.ja.json"
$messages = $null
try {
  if (Test-Path -LiteralPath $messagesPath) {
    $messages = Get-Content -LiteralPath $messagesPath -Raw | ConvertFrom-Json
  }
}
catch { }
if (-not $Force) {
  Add-Type -AssemblyName PresentationFramework
  $title = if ($messages.uninstallConfirmTitle) { $messages.uninstallConfirmTitle } else { "FleetFlow NFC/QR" }
  $message = if ($messages.uninstallConfirm) { $messages.uninstallConfirm } else { "Uninstall FleetFlow NFC/QR Bridge?" }
  $answer = [System.Windows.MessageBox]::Show($message, $title, "YesNo", "Warning")
  if ($answer -ne "Yes") { exit 0 }
  # The CMD entry point exits immediately. Give cmd.exe time to release the
  # batch file before this script removes the installation directory.
  Start-Sleep -Milliseconds 500
}
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
$startMenuDirectory = Join-Path ([Environment]::GetFolderPath("Programs")) "FleetFlow"
$shortcutName = ConvertFrom-Json '"FleetFlow NFC\u30fbQR \u63a5\u7d9a\u30fb\u518d\u63a5\u7d9a.lnk"'
$startMenuShortcut = Join-Path $startMenuDirectory $shortcutName
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) $shortcutName
$legacyStartMenuShortcut = Join-Path $startMenuDirectory "FleetFlow NFC Start.lnk"
foreach ($shortcutPath in @($startMenuShortcut, $desktopShortcut, $legacyStartMenuShortcut)) {
  Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
}
if ((Test-Path -LiteralPath $startMenuDirectory) -and -not (Get-ChildItem -LiteralPath $startMenuDirectory -Force)) {
  Remove-Item -LiteralPath $startMenuDirectory -Force
}

if (-not ("FleetFlowShellAssociation" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class FleetFlowShellAssociation
{
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(
        uint eventId,
        uint flags,
        IntPtr item1,
        IntPtr item2);
}
"@
}
[FleetFlowShellAssociation]::SHChangeNotify(0x08000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)
if (Test-Path -LiteralPath $installDir) { Remove-Item -LiteralPath $installDir -Recurse -Force }
if (-not $Force) {
  $complete = if ($messages.uninstallComplete) { $messages.uninstallComplete } else { "FleetFlow NFC/QR Bridge was uninstalled." }
  [System.Windows.MessageBox]::Show($complete, $title) | Out-Null
}
Write-Host "FleetFlow NFC/QR Bridge uninstalled."
