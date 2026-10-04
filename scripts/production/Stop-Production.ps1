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

try {
  if (-not (Test-Path -LiteralPath $environmentPath)) { throw $messages.productionConfigMissing }
  & docker compose --project-directory $projectPath --env-file $environmentPath -f $composePath stop
  if ($LASTEXITCODE -ne 0) { throw $messages.productionStopFailed }
  $message = $messages.productionStopped
  if ($NoUi) { Write-Output $message }
  else {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($message, $messages.productionTitle) | Out-Null
  }
  exit 0
}
catch {
  Add-Content -LiteralPath $logPath -Value ("{0} Production stop failed: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $_.Exception.Message) -Encoding UTF8
  if ($NoUi) { Write-Error $_.Exception.Message }
  else {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message, $messages.productionStopErrorTitle) | Out-Null
  }
  exit 1
}
