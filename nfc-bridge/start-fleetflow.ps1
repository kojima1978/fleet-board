param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectDirectory,
  [switch]$StatusOnly,
  [switch]$Production,
  [switch]$NoUi
)

$ErrorActionPreference = "Stop"
$appUrl = "http://localhost:3035/"
$nfcUrl = "http://127.0.0.1:17831/health"
$nfcLauncher = Join-Path $PSScriptRoot "launch.ps1"
$logPath = Join-Path $PSScriptRoot "fleetflow-start.log"
$messagesPath = Join-Path $PSScriptRoot "messages.ja.json"
$messages = ConvertFrom-Json ([System.IO.File]::ReadAllText($messagesPath, [System.Text.Encoding]::UTF8))
$script:lastDockerOutput = ""

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
    $output = (& $docker.Source @arguments 2>&1 | Out-String).Trim()
    $exitCode = $LASTEXITCODE
    $script:lastDockerOutput = $output
    if ($exitCode -ne 0) {
      $commandText = "docker " + ($arguments -join " ")
      Write-LauncherLog "$commandText failed with exit code $exitCode."
      if (-not [string]::IsNullOrWhiteSpace($output)) {
        Write-LauncherLog "Docker output: $output"
      }
    }
    return $exitCode
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

try {
  $ProjectDirectory = [System.IO.Path]::GetFullPath($ProjectDirectory)
  if (-not (Test-Path -LiteralPath $ProjectDirectory)) {
    throw "PROJECT_NOT_FOUND"
  }
  if (-not (Test-Path -LiteralPath $nfcLauncher)) {
    throw "NFC_LAUNCHER_NOT_FOUND"
  }

  $composeArguments = @("compose", "--project-directory", $ProjectDirectory)
  if ($Production) {
    $productionComposePath = Join-Path $ProjectDirectory "compose.production.yaml"
    $productionEnvironmentPath = Join-Path $ProjectDirectory ".env.production"
    if (-not (Test-Path -LiteralPath $productionComposePath)) { throw "PRODUCTION_COMPOSE_NOT_FOUND" }
    if (-not (Test-Path -LiteralPath $productionEnvironmentPath)) { throw "PRODUCTION_CONFIG_NOT_FOUND" }
    $portSetting = Get-Content -LiteralPath $productionEnvironmentPath | Where-Object { $_ -match '^FLEETFLOW_PORT=' } | Select-Object -First 1
    if ($portSetting) {
      $productionPort = ($portSetting -split '=', 2)[1].Trim()
      if ($productionPort -match '^\d{2,5}$') { $appUrl = "http://localhost:$productionPort/" }
    }
    $composeArguments += @("--env-file", $productionEnvironmentPath, "-f", $productionComposePath)
  }

  if ($StatusOnly) {
    Show-Result (Get-StatusText) (Get-Message "statusTitle")
    exit 0
  }

  $modeName = if ($Production) { "production" } else { "development" }
  Write-LauncherLog "Start requested. Mode: $modeName. Project directory: $ProjectDirectory"

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

  if ($Production) {
    $null = Invoke-Docker @("compose", "--project-directory", $ProjectDirectory, "stop")
  }
  else {
    $productionComposePath = Join-Path $ProjectDirectory "compose.production.yaml"
    $productionEnvironmentPath = Join-Path $ProjectDirectory ".env.production"
    if ((Test-Path -LiteralPath $productionComposePath) -and (Test-Path -LiteralPath $productionEnvironmentPath)) {
      $null = Invoke-Docker @("compose", "--project-directory", $ProjectDirectory, "--env-file", $productionEnvironmentPath, "-f", $productionComposePath, "stop")
    }
  }

  $upArguments = @("up", "-d")
  $dockerExitCode = Invoke-Docker ($composeArguments + $upArguments)
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
