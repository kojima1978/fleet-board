param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectDirectory,
  [switch]$StatusOnly,
  [switch]$Production,
  [switch]$Build,
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

function Start-NfcBridge([int]$Attempts = 3) {
  foreach ($attempt in 1..$Attempts) {
    $null = & powershell.exe -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $nfcLauncher
    $exitCode = $LASTEXITCODE
    $health = Get-NfcHealth
    if ($null -ne $health) {
      Write-LauncherLog "NFC bridge ready on attempt $attempt. Reader connected: $($health.readerConnected)."
      return $health
    }
    Write-LauncherLog "NFC bridge attempt $attempt failed with exit code $exitCode."
    if ($attempt -lt $Attempts) { Start-Sleep -Seconds (2 * $attempt) }
  }
  return $null
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
  . (Join-Path $ProjectDirectory "scripts\production\FleetFlow-Network.ps1")
  if ($Production) {
    $productionComposePath = Join-Path $ProjectDirectory "compose.production.yaml"
    $productionEnvironmentPath = Join-Path $ProjectDirectory ".env.production"
    if (-not (Test-Path -LiteralPath $productionComposePath)) { throw "PRODUCTION_COMPOSE_NOT_FOUND" }
    if (-not (Test-Path -LiteralPath $productionEnvironmentPath)) { throw "PRODUCTION_CONFIG_NOT_FOUND" }
    $appUrl = Get-FleetFlowAppUrl -EnvironmentPath $productionEnvironmentPath
    $composeArguments += @("--env-file", $productionEnvironmentPath, "-f", $productionComposePath)
  }
  else {
    $developmentEnvironmentPath = Join-Path $ProjectDirectory ".env"
    $appUrl = Get-FleetFlowAppUrl -EnvironmentPath $developmentEnvironmentPath -Development
    if (Test-Path -LiteralPath $developmentEnvironmentPath) { $composeArguments += @("--env-file", $developmentEnvironmentPath) }
    $composeArguments += @("-f", (Join-Path $ProjectDirectory "compose.yaml"))
  }

  if ($StatusOnly) {
    Show-Result (Get-StatusText) (Get-Message "statusTitle")
    exit 0
  }

  $modeName = if ($Production) { "production" } else { "development" }
  if ($Build -and $Production) { throw "Use FleetFlow Production Update.cmd to build production." }
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

  if (-not $Production) {
    $env:FLEETFLOW_DEV_ALLOWED_ORIGINS = (Get-FleetFlowDevelopmentOriginHosts) -join ","
    Write-LauncherLog "Detected development Origin hosts: $env:FLEETFLOW_DEV_ALLOWED_ORIGINS"
  }

  if ($Production) {
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProjectDirectory "scripts\production\Test-ProductionPreflight.ps1") -ProjectDirectory $ProjectDirectory -NoUi
    if ($LASTEXITCODE -ne 0) { throw "PRODUCTION_PREFLIGHT_FAILED" }
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
  if ($Build) { $upArguments += "--build" }
  $dockerExitCode = Invoke-Docker ($composeArguments + $upArguments)
  if ($dockerExitCode -ne 0) { throw "DOCKER_SERVICES_FAILED" }

  # Dockerと並行して一度起動し、WindowsやUSBの準備が遅い場合はアプリ起動後に再試行する。
  try {
    . (Join-Path $ProjectDirectory "nfc-bridge\prepare-bridge.ps1")
    if (Test-FleetFlowNfcDriverMissing) {
      $driverUrl = Get-Message "sonyNfcDriverUrl"
      Write-Warning "Sony NFC driver is not installed. Download: $driverUrl"
      Write-LauncherLog "Sony NFC driver is missing. Download: $driverUrl"
      # NoUiでの自動起動・診断ではブラウザーを開かない。インストーラーは実行しない。
      if (-not $NoUi) { Start-Process $driverUrl }
    }
    $nfcLauncher = Initialize-FleetFlowBridge -ProjectDirectory $ProjectDirectory -AppUrl $appUrl -BuildBridge {
      # ビルダーだけを起動する。本番・開発アプリやDBの再ビルドは行わない。
      $buildResult = Invoke-Docker @("compose", "--project-directory", $ProjectDirectory, "-f", (Join-Path $ProjectDirectory "compose.yaml"), "--profile", "tools", "run", "--rm", "--no-deps", "nfc-bridge-build")
      if ($buildResult -ne 0) { throw "NFC Bridge build failed. See fleetflow-start.log." }
    } -InstallBridge {
      param($origins)
      $installer = Join-Path $ProjectDirectory "nfc-bridge\install.ps1"
      & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $installer -AllowedOrigins $origins -SkipAutostart -KeepExistingConfiguration
      if ($LASTEXITCODE -ne 0) { throw "NFC Bridge installation failed." }
    }
  }
  catch {
    # 連携ソフトの準備失敗で、手動操作できるアプリ本体を止めない。
    Write-LauncherLog "NFC Bridge preparation failed: $($_.Exception.Message)"
    Write-Warning "NFC/QR setup failed. See $logPath. Manual operation remains available."
  }
  $nfc = Start-NfcBridge -Attempts 1

  $appReady = $false
  foreach ($attempt in 1..60) {
    if (Test-App) { $appReady = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $appReady) { throw "APP_TIMEOUT" }

  if ($null -eq $nfc) { $nfc = Start-NfcBridge -Attempts 2 }
  else { $nfc = Get-NfcHealth }
  if ($Production) {
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProjectDirectory "scripts\production\Test-ProductionHealth.ps1") -ProjectDirectory $ProjectDirectory -NoUi
    if ($LASTEXITCODE -ne 0) { throw "PRODUCTION_HEALTH_CHECK_FAILED" }
  }
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
