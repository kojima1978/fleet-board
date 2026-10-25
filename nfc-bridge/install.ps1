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
$config = @{ allowedOrigins = $AllowedOrigins.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries) } | ConvertTo-Json
Set-Content -LiteralPath (Join-Path $installDir "bridge.json") -Value $config -Encoding UTF8

$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$powerShell = Join-Path $PSHOME "powershell.exe"
$launcher = Join-Path $installDir "launch.ps1"
$startupCommand = '"' + $powerShell + '" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '" -Watch'
$protocolCommand = '"' + $powerShell + '" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '"'
New-ItemProperty -Path $runKey -Name "FleetFlowNfcBridge" -Value $startupCommand -PropertyType String -Force | Out-Null

# Let the FleetFlow screen start the bridge through fleetflow-nfc://. The URL itself is never passed to the launcher.
$protocolKey = "HKCU:\Software\Classes\fleetflow-nfc"
New-Item -Path "$protocolKey\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path $protocolKey -Name "(default)" -Value "URL:FleetFlow NFC"
New-ItemProperty -Path $protocolKey -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
Set-ItemProperty -Path "$protocolKey\shell\open\command" -Name "(default)" -Value $protocolCommand

Start-Process -FilePath $powerShell -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", $launcher, "-Watch") -WindowStyle Hidden
Write-Host "FleetFlow NFC Bridge installed and added to Windows startup. Use the launch files in the project directory."
