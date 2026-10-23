param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectDirectory,
  [switch]$NoUi
)

$ErrorActionPreference = "Stop"
$projectPath = [System.IO.Path]::GetFullPath($ProjectDirectory)
$environmentPath = Join-Path $projectPath ".env.production"
$messagesPath = Join-Path $projectPath "nfc-bridge\messages.ja.json"
$messages = ConvertFrom-Json ([System.IO.File]::ReadAllText($messagesPath, [System.Text.Encoding]::UTF8))
$deployedAt = (Get-Date).ToUniversalTime().ToString("o")

function New-HexSecret([int]$byteCount) {
  $bytes = New-Object byte[] $byteCount
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) }
  finally { $generator.Dispose() }
  return ([System.BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
}

if (Test-Path -LiteralPath $environmentPath) {
  $content = [System.IO.File]::ReadAllText($environmentPath, [System.Text.Encoding]::UTF8).TrimEnd()
  $defaults = @(
    "FLEETFLOW_BIND_ADDRESS=127.0.0.1"
    "FLEETFLOW_APP_VERSION=0.1.0"
    "FLEETFLOW_DEPLOYED_AT=$deployedAt"
    "FLEETFLOW_BACKUP_DESTINATION="
  )
  foreach ($setting in $defaults) {
    $name = ($setting -split '=', 2)[0]
    if ($content -notmatch "(?m)^$([regex]::Escape($name))=") { $content += [Environment]::NewLine + $setting }
  }
  [System.IO.File]::WriteAllText($environmentPath, $content + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "$($messages.productionEnvironmentExists) $environmentPath"
  exit 0
}

$databasePassword = New-HexSecret 24
$content = @(
  "POSTGRES_PASSWORD=$databasePassword"
  "FLEETFLOW_BIND_ADDRESS=127.0.0.1"
  "FLEETFLOW_PORT=3035"
  "FLEETFLOW_APP_VERSION=0.1.0"
  "FLEETFLOW_DEPLOYED_AT=$deployedAt"
  "FLEETFLOW_BACKUP_DESTINATION="
) -join [Environment]::NewLine
[System.IO.File]::WriteAllText($environmentPath, $content + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))

$message = $messages.productionInitialized -f $environmentPath
if ($NoUi) {
  Write-Output $message
}
else {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($message, $messages.productionTitle) | Out-Null
}
