param(
  [string]$AllowedOrigins = "http://localhost:3035;http://127.0.0.1:3035",
  [string]$QrComPort = "",
  [ValidateRange(1200, 115200)]
  [int]$QrBaudRate = 9600,
  [string]$ProjectDirectory = (Split-Path $PSScriptRoot -Parent),
  [switch]$SkipAutostart,
  [switch]$KeepExistingConfiguration
)

$ErrorActionPreference = "Stop"
$detectedQrPort = $null
if (-not $QrComPort) {
  try {
    $densoPorts = @(Get-CimInstance Win32_SerialPort -ErrorAction Stop | Where-Object {
      "$($_.Name) $($_.Manufacturer) $($_.PNPDeviceID)" -match "DENSO|QK30|VID_076D&PID_0006"
    })
    if ($densoPorts.Count -eq 1) {
      $detectedQrPort = $densoPorts[0].DeviceID
      $QrComPort = $detectedQrPort
    }
  }
  catch {
    # COM can be supplied explicitly, so NFC-only installation may continue when detection is unavailable.
  }
}
$source = Join-Path $PSScriptRoot "dist\FleetFlow.NfcBridge.exe"
if (-not (Test-Path -LiteralPath $source)) { throw "Build the NFC bridge before installation." }
$launcherSource = Join-Path $PSScriptRoot "launch.ps1"
if (-not (Test-Path -LiteralPath $launcherSource)) { throw "NFC bridge launcher is missing." }
$fleetFlowLauncherSource = Join-Path $PSScriptRoot "start-fleetflow.ps1"
if (-not (Test-Path -LiteralPath $fleetFlowLauncherSource)) { throw "FleetFlow launcher is missing." }
$messagesSource = Join-Path $PSScriptRoot "messages.ja.json"
if (-not (Test-Path -LiteralPath $messagesSource)) { throw "FleetFlow Japanese messages are missing." }
$uninstallerSource = Join-Path $PSScriptRoot "uninstall.ps1"
if (-not (Test-Path -LiteralPath $uninstallerSource)) { throw "FleetFlow uninstaller is missing." }
$restartCommandSource = Join-Path $PSScriptRoot "FleetFlow NFC-QR Restart.cmd"
if (-not (Test-Path -LiteralPath $restartCommandSource)) { throw "FleetFlow restart command is missing." }
$uninstallCommandSource = Join-Path $PSScriptRoot "FleetFlow NFC-QR Uninstall.cmd"
if (-not (Test-Path -LiteralPath $uninstallCommandSource)) { throw "FleetFlow uninstall command is missing." }

$installDir = Join-Path $env:LOCALAPPDATA "FleetFlow\NfcBridge"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$configPath = Join-Path $installDir "bridge.json"
if ($KeepExistingConfiguration -and (Test-Path -LiteralPath $configPath)) {
  $existing = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $AllowedOrigins = (@($existing.allowedOrigins) + $AllowedOrigins.Split(';') | Where-Object { $_ } | Select-Object -Unique) -join ';'
  if ($existing.qrComPort) { $QrComPort = $existing.qrComPort }
  if ($existing.qrBaudRate) { $QrBaudRate = $existing.qrBaudRate }
}
$watchdogPidPath = Join-Path $installDir "watchdog.pid"
if (Test-Path -LiteralPath $watchdogPidPath) {
  $watchdogPid = 0
  if ([int]::TryParse((Get-Content -LiteralPath $watchdogPidPath -Raw).Trim(), [ref]$watchdogPid)) {
    $watchdog = Get-CimInstance Win32_Process -Filter "ProcessId = $watchdogPid" -ErrorAction SilentlyContinue
    if ($watchdog -and $watchdog.Name -match "powershell" -and $watchdog.CommandLine -like "*launch.ps1*" -and $watchdog.CommandLine -like "*-Watch*") {
      Stop-Process -Id $watchdogPid -Force -ErrorAction SilentlyContinue
      Wait-Process -Id $watchdogPid -Timeout 5 -ErrorAction SilentlyContinue
    }
  }
  Remove-Item -LiteralPath $watchdogPidPath -Force -ErrorAction SilentlyContinue
}
# The old watchdog can restart the bridge while it is shutting down, so verify repeatedly.
foreach ($attempt in 1..10) {
  $running = Get-Process -Name "FleetFlow.NfcBridge" -ErrorAction SilentlyContinue
  if (-not $running) { break }
  $running | Stop-Process -Force -ErrorAction SilentlyContinue
  $running | Wait-Process -Timeout 2 -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 250
}
$bridgeDestination = Join-Path $installDir "FleetFlow.NfcBridge.exe"
foreach ($attempt in 1..10) {
  try {
    Copy-Item -LiteralPath $source -Destination $bridgeDestination -Force
    break
  }
  catch {
    if ($attempt -eq 10) { throw }
    Start-Sleep -Milliseconds 500
  }
}
Copy-Item -LiteralPath $launcherSource -Destination (Join-Path $installDir "launch.ps1") -Force
Copy-Item -LiteralPath $fleetFlowLauncherSource -Destination (Join-Path $installDir "start-fleetflow.ps1") -Force
Copy-Item -LiteralPath $messagesSource -Destination (Join-Path $installDir "messages.ja.json") -Force
Copy-Item -LiteralPath $uninstallerSource -Destination (Join-Path $installDir "uninstall.ps1") -Force
Copy-Item -LiteralPath $restartCommandSource -Destination (Join-Path $installDir "FleetFlow NFC-QR Restart.cmd") -Force
Copy-Item -LiteralPath $uninstallCommandSource -Destination (Join-Path $installDir "FleetFlow NFC-QR Uninstall.cmd") -Force
$config = @{ allowedOrigins = $AllowedOrigins.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries); qrComPort = $(if ($QrComPort) { $QrComPort.Trim().ToUpperInvariant() } else { $null }); qrBaudRate = $QrBaudRate } | ConvertTo-Json
Set-Content -LiteralPath (Join-Path $installDir "bridge.json") -Value $config -Encoding UTF8

$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$powerShell = Join-Path $PSHOME "powershell.exe"
$launcher = Join-Path $installDir "launch.ps1"
$startupCommand = '"' + $powerShell + '" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '" -Watch'
if (-not $SkipAutostart) {
  New-ItemProperty -Path $runKey -Name "FleetFlowNfcBridge" -Value $startupCommand -PropertyType String -Force | Out-Null
}

# Remove the custom URL handler registered by earlier versions. Recovery now
# uses the management CMD files documented in the FleetFlow connection guide.
$protocolKey = "HKCU:\Software\Classes\fleetflow-nfc"
if (Test-Path -LiteralPath $protocolKey) {
  Remove-Item -LiteralPath $protocolKey -Recurse -Force
}

# Notify the Windows Shell so the removed legacy association is not cached.
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
Start-Sleep -Milliseconds 1000

# Remove shortcuts created by earlier FleetFlow Bridge versions. Recovery and
# removal are now run explicitly from the installation directory.
$startMenuDirectory = Join-Path ([Environment]::GetFolderPath("Programs")) "FleetFlow"
$shortcutName = ConvertFrom-Json '"FleetFlow NFC\u30fbQR \u63a5\u7d9a\u30fb\u518d\u63a5\u7d9a.lnk"'
$startMenuShortcut = Join-Path $startMenuDirectory $shortcutName
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) $shortcutName
foreach ($shortcutPath in @($startMenuShortcut, $desktopShortcut, (Join-Path $startMenuDirectory "FleetFlow NFC Start.lnk"))) {
  Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
}
if ((Test-Path -LiteralPath $startMenuDirectory) -and -not (Get-ChildItem -LiteralPath $startMenuDirectory -Force)) {
  Remove-Item -LiteralPath $startMenuDirectory -Force
}

Start-Process -FilePath $powerShell -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", ('"' + $launcher + '"'), "-Watch") -WindowStyle Hidden
if ($SkipAutostart) { Write-Host "FleetFlow NFC/QR Bridge installed. Windows startup settings were not changed." }
else { Write-Host "FleetFlow NFC/QR Bridge installed and added to Windows startup." }
if ($detectedQrPort) { Write-Host "DENSO QR scanner was detected automatically on $detectedQrPort." }
elseif (-not $QrComPort) { Write-Host "QR scanner is not configured. Re-run with -QrComPort COM3 after checking Device Manager." }
Write-Host "Use the launch files in the project directory."
Write-Host "Recovery commands are available in $installDir."
