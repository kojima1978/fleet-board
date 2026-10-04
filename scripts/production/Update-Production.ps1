param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectDirectory,
  [switch]$NoUi
)

$ErrorActionPreference = "Stop"
$projectPath = [System.IO.Path]::GetFullPath($ProjectDirectory)
$composePath = Join-Path $projectPath "compose.production.yaml"
$environmentPath = Join-Path $projectPath ".env.production"
$logPath = Join-Path $projectPath "nfc-bridge\fleetflow-start.log"
$messagesPath = Join-Path $projectPath "nfc-bridge\messages.ja.json"
$messages = ConvertFrom-Json ([System.IO.File]::ReadAllText($messagesPath, [System.Text.Encoding]::UTF8))
$composeArguments = @("compose", "--project-directory", $projectPath, "--env-file", $environmentPath, "-f", $composePath)
$rollbackAvailable = $false
$previousEnvironment = $null

function Write-UpdateLog([string]$message) {
  Add-Content -LiteralPath $logPath -Value ("{0} Production update: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message) -Encoding UTF8
}

function Invoke-Docker([string[]]$arguments) {
  & docker @arguments
  if ($LASTEXITCODE -ne 0) { throw "docker $($arguments -join ' ') failed with exit code $LASTEXITCODE" }
}

function Show-Message([string]$message, [string]$title) {
  if ($NoUi) { Write-Output $message; return }
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($message, $title) | Out-Null
}

try {
  if (-not (Test-Path -LiteralPath $environmentPath)) { throw $messages.productionConfigMissing }
  Write-UpdateLog "Started."

  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectPath "scripts\database\Backup-Now.ps1") -Production
  if ($LASTEXITCODE -ne 0) { throw "Pre-update backup failed." }

  $appContainer = (& docker @composeArguments ps -q app | Select-Object -First 1)
  if ($appContainer) {
    $appImage = (& docker inspect --format "{{.Image}}" $appContainer | Select-Object -First 1)
    if ($appImage) {
      Invoke-Docker @("image", "tag", $appImage, "fleetflow-production-app:rollback")
      $rollbackAvailable = $true
    }
  }

  Invoke-Docker ($composeArguments + @("build", "app", "migrate"))
  Invoke-Docker ($composeArguments + @("run", "--rm", "--no-deps", "migrate", "npm", "run", "lint"))
  Invoke-Docker ($composeArguments + @("run", "--rm", "--no-deps", "migrate", "sh", "scripts/production/prepare-db.sh"))
  $previousEnvironment = [System.IO.File]::ReadAllText($environmentPath, [System.Text.Encoding]::UTF8)
  $deployedAt = (Get-Date).ToUniversalTime().ToString("o")
  $nextEnvironment = [regex]::Replace($previousEnvironment, '(?m)^FLEETFLOW_DEPLOYED_AT=.*$', "FLEETFLOW_DEPLOYED_AT=$deployedAt")
  [System.IO.File]::WriteAllText($environmentPath, $nextEnvironment, (New-Object System.Text.UTF8Encoding($false)))
  Invoke-Docker ($composeArguments + @("up", "-d", "--no-deps", "--force-recreate", "app"))

  $ready = $false
  foreach ($attempt in 1..60) {
    try {
      if ((Invoke-WebRequest -Uri "http://localhost:3035/api/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { $ready = $true; break }
    }
    catch { }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) { throw "Updated application did not become healthy." }
  Invoke-Docker ($composeArguments + @("run", "--rm", "--no-deps", "-e", "APP_URL=http://app:3000", "migrate", "npm", "run", "test:integration"))
  Write-UpdateLog "Completed."
  Show-Message $messages.productionUpdateCompleted $messages.productionUpdateTitle
  exit 0
}
catch {
  Write-UpdateLog "Failed: $($_.Exception.Message)"
  if ($rollbackAvailable) {
    if ($null -ne $previousEnvironment) { [System.IO.File]::WriteAllText($environmentPath, $previousEnvironment, (New-Object System.Text.UTF8Encoding($false))) }
    & docker image tag fleetflow-production-app:rollback fleetflow-production-app:current
    & docker @composeArguments up -d --no-deps --force-recreate app
    Show-Message $messages.productionUpdateFailed $messages.productionUpdateTitle
  }
  else {
    Show-Message $messages.productionUpdateNoRollback $messages.productionUpdateTitle
  }
  exit 1
}
