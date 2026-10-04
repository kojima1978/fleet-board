param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectDirectory,
  [switch]$StatusOnly,
  [switch]$NoUi
)

$ErrorActionPreference = "Stop"
$appUrl = "http://localhost:3035/"
$nfcUrl = "http://127.0.0.1:17831/health"
$nfcLauncher = Join-Path $PSScriptRoot "launch.ps1"
$logPath = Join-Path $PSScriptRoot "fleetflow-start.log"
$messagesPath = Join-Path $PSScriptRoot "messages.ja.json"
$messages = ConvertFrom-Json ([System.IO.File]::ReadAllText($messagesPath, [System.Text.Encoding]::UTF8))

function Get-Message([string]$name) {
  return $messages.$name
}

function Write-LauncherLog([string]$message) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Show-Result([string]$message, [string]$title = "FleetFlow") {
  if ($NoUi) {
    Write-Output $message
    return
  }
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($message, $title) | Out-Null
}

function Test-App {
  try {
    return (Invoke-WebRequest -Uri $appUrl -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200
  }
  catch { return $false }
}

function Get-NfcHealth {
  try { return Invoke-RestMethod -Uri $nfcUrl -TimeoutSec 2 }
  catch { return $null }
}

function Invoke-Docker([string[]]$arguments) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  try {
    & $docker.Source @arguments *> $null
    return $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Get-StatusText {
  $appReady = Test-App
  $nfc = Get-NfcHealth
  $readerReady = $null -ne $nfc -and $nfc.readerConnected
  $readerName = if ($readerReady) { ($nfc.readers -join ", ") } else { Get-Message "unknownReader" }
  return @(
    "$(Get-Message 'appLabel'): $(if ($appReady) { Get-Message 'running' } else { Get-Message 'stopped' })"
    "$(Get-Message 'nfcLabel'): $(if ($null -ne $nfc) { Get-Message 'running' } else { Get-Message 'stopped' })"
    "$(Get-Message 'readerLabel'): $(if ($readerReady) { Get-Message 'connected' } else { Get-Message 'notConnected' })"
    "$(Get-Message 'readerNameLabel'): $readerName"
  ) -join [Environment]::NewLine
}

function Get-ErrorText([string]$errorCode) {
  $knownMessage = $messages.$errorCode
  if ($null -ne $knownMessage) { return $knownMessage }
  return Get-Message "UNKNOWN_ERROR"
}

if ($StatusOnly) {
  Show-Result (Get-StatusText) (Get-Message "statusTitle")
  exit 0
}

try {
  Write-LauncherLog "Start requested."
  if (-not (Test-Path -LiteralPath $ProjectDirectory)) {
    throw "PROJECT_NOT_FOUND"
  }
  if (-not (Test-Path -LiteralPath $nfcLauncher)) {
    throw "NFC_LAUNCHER_NOT_FOUND"
  }

  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if ($null -eq $docker) { throw "DOCKER_NOT_INSTALLED" }

  $dockerExitCode = Invoke-Docker @("info")
  if ($dockerExitCode -ne 0) {
    $dockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
    if (-not (Test-Path -LiteralPath $dockerDesktop)) { throw "DOCKER_NOT_RUNNING" }
    Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
    foreach ($attempt in 1..60) {
      Start-Sleep -Seconds 2
      $dockerExitCode = Invoke-Docker @("info")
      if ($dockerExitCode -eq 0) { break }
    }
    if ($dockerExitCode -ne 0) { throw "DOCKER_TIMEOUT" }
  }

  $dockerExitCode = Invoke-Docker @("compose", "--project-directory", $ProjectDirectory, "up", "-d")
  if ($dockerExitCode -ne 0) { throw "DOCKER_SERVICES_FAILED" }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $nfcLauncher
  if ($LASTEXITCODE -ne 0) { Write-LauncherLog "NFC bridge start returned exit code $LASTEXITCODE." }

  $appReady = $false
  foreach ($attempt in 1..60) {
    if (Test-App) { $appReady = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $appReady) { throw "APP_TIMEOUT" }

  $nfc = Get-NfcHealth
  Write-LauncherLog "Start completed. App ready: $appReady. NFC ready: $($null -ne $nfc). Reader connected: $($nfc.readerConnected)."
  if (-not $NoUi) { Start-Process $appUrl }
  if ($null -eq $nfc) {
    Show-Result ((Get-Message "nfcBridgeWarning") + [Environment]::NewLine + [Environment]::NewLine + (Get-Message "logLabel") + ": " + $logPath) (Get-Message "warningTitle")
  }
  elseif (-not $nfc.readerConnected) {
    Show-Result ((Get-Message "nfcReaderWarning") + [Environment]::NewLine + [Environment]::NewLine + (Get-Message "logLabel") + ": " + $logPath) (Get-Message "warningTitle")
  }
  exit 0
}
catch {
  $errorCode = $_.Exception.Message
  Write-LauncherLog "Start failed: $errorCode"
  $errorMessage = (Get-Message "errorIntro") + [Environment]::NewLine + [Environment]::NewLine + (Get-ErrorText $errorCode) + [Environment]::NewLine + [Environment]::NewLine + (Get-Message "logLabel") + ": " + $logPath
  Show-Result $errorMessage (Get-Message "errorTitle")
  exit 1
}
