param(
  [string]$AllowedOrigins = "http://localhost:3035;http://127.0.0.1:3035",
  [string]$ProjectDirectory = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = "Stop"
$source = Join-Path $PSScriptRoot "dist\FleetFlow.NfcBridge.exe"
if (-not (Test-Path -LiteralPath $source)) { throw "Build the NFC bridge before installation." }
$launcherSource = Join-Path $PSScriptRoot "launch.ps1"
if (-not (Test-Path -LiteralPath $launcherSource)) { throw "NFC bridge launcher is missing." }
$fleetFlowLauncherSource = Join-Path $PSScriptRoot "start-fleetflow.ps1"
if (-not (Test-Path -LiteralPath $fleetFlowLauncherSource)) { throw "FleetFlow launcher is missing." }
$messagesSource = Join-Path $PSScriptRoot "messages.ja.json"
if (-not (Test-Path -LiteralPath $messagesSource)) { throw "FleetFlow Japanese messages are missing." }

$installDir = Join-Path $env:LOCALAPPDATA "FleetFlow\NfcBridge"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$running = Get-Process -Name "FleetFlow.NfcBridge" -ErrorAction SilentlyContinue
if ($running) {
  $running | Stop-Process -Force
  $running | Wait-Process -Timeout 5 -ErrorAction SilentlyContinue
}
Copy-Item -LiteralPath $source -Destination (Join-Path $installDir "FleetFlow.NfcBridge.exe") -Force
Copy-Item -LiteralPath $launcherSource -Destination (Join-Path $installDir "launch.ps1") -Force
Copy-Item -LiteralPath $fleetFlowLauncherSource -Destination (Join-Path $installDir "start-fleetflow.ps1") -Force
Copy-Item -LiteralPath $messagesSource -Destination (Join-Path $installDir "messages.ja.json") -Force
$config = @{ allowedOrigins = $AllowedOrigins.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries) } | ConvertTo-Json
Set-Content -LiteralPath (Join-Path $installDir "bridge.json") -Value $config -Encoding UTF8

$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$powerShell = Join-Path $PSHOME "powershell.exe"
$launcher = Join-Path $installDir "launch.ps1"
$command = '"' + $powerShell + '" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '"'
New-ItemProperty -Path $runKey -Name "FleetFlowNfcBridge" -Value $command -PropertyType String -Force | Out-Null

Start-Process -FilePath $powerShell -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", $launcher) -WindowStyle Hidden
Write-Host "FleetFlow NFC Bridge installed and added to Windows startup. Use the launch files in the project directory."
