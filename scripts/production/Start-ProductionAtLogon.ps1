param(
  [Parameter(Mandatory = $true)][string]$ProjectDirectory,
  [int]$AddressTimeoutSeconds = 300,
  [int]$DockerTimeoutSeconds = 600,
  [int]$StartAttempts = 3,
  [switch]$NoUi
)

$ErrorActionPreference = "Stop"
$projectPath = [System.IO.Path]::GetFullPath($ProjectDirectory)
$environmentPath = Join-Path $projectPath ".env.production"
$launcherPath = Join-Path $projectPath "nfc-bridge\start-fleetflow.ps1"
$logPath = Join-Path $projectPath "nfc-bridge\fleetflow-start.log"
$messagesPath = Join-Path $projectPath "nfc-bridge\messages.ja.json"
$messages = ConvertFrom-Json ([System.IO.File]::ReadAllText($messagesPath, [System.Text.Encoding]::UTF8))
. (Join-Path $PSScriptRoot "FleetFlow-Network.ps1")

function Write-AutostartLog([string]$Message) {
  $line = "{0} Autostart: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Test-DockerReady {
  & docker info *> $null
  return $LASTEXITCODE -eq 0
}

try {
  if (-not (Test-Path -LiteralPath $environmentPath)) {
    Write-AutostartLog "Skipped because production is not initialized."
    exit 0
  }
  Write-AutostartLog "Started."

  $bindAddress = Get-FleetFlowEnvironmentValue -Path $environmentPath -Name "FLEETFLOW_BIND_ADDRESS"
  if (-not [string]::IsNullOrWhiteSpace($bindAddress) -and $bindAddress -ne "127.0.0.1") {
    Write-AutostartLog "Waiting for $bindAddress."
    if (-not (Wait-FleetFlowLocalAddress -Address $bindAddress -TimeoutSeconds $AddressTimeoutSeconds)) { throw "AUTOSTART_ADDRESS_TIMEOUT" }
  }

  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "DOCKER_NOT_INSTALLED" }
  $dockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
  $dockerDeadline = (Get-Date).AddSeconds($DockerTimeoutSeconds)
  $dockerLaunched = $false
  while (-not (Test-DockerReady)) {
    if ((Get-Date) -ge $dockerDeadline) { throw "DOCKER_TIMEOUT" }
    # Docker Desktop normally starts itself at sign-in; launch it only when it is not configured to.
    if (-not $dockerLaunched -and -not (Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $dockerDesktop)) {
      Write-AutostartLog "Launching Docker Desktop."
      Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
      $dockerLaunched = $true
    }
    Start-Sleep -Seconds 5
  }

  for ($attempt = 1; $attempt -le $StartAttempts; $attempt++) {
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $launcherPath -ProjectDirectory $projectPath -Production -NoUi | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-AutostartLog "Completed on attempt $attempt."
      exit 0
    }
    Write-AutostartLog "Attempt $attempt failed with exit code $LASTEXITCODE."
    if ($attempt -lt $StartAttempts) { Start-Sleep -Seconds 30 }
  }
  throw "AUTOSTART_FAILED"
}
catch {
  $errorCode = $_.Exception.Message
  Write-AutostartLog "Failed: $errorCode"
  if (-not $NoUi) {
    $errorText = $messages.$errorCode
    if ($null -eq $errorText) { $errorText = $messages.UNKNOWN_ERROR }
    $text = $messages.autostartErrorIntro + [Environment]::NewLine + [Environment]::NewLine + $errorText + [Environment]::NewLine + [Environment]::NewLine + $messages.logLabel + ": " + $logPath
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($text, $messages.autostartErrorTitle) | Out-Null
  }
  exit 1
}
