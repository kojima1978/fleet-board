param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectDirectory,
  [switch]$NoUi
)

$ErrorActionPreference = "Stop"
$projectPath = [System.IO.Path]::GetFullPath($ProjectDirectory)
$environmentPath = Join-Path $projectPath ".env.production"
$composePath = Join-Path $projectPath "compose.production.yaml"
$messagesPath = Join-Path $projectPath "nfc-bridge\messages.ja.json"
$messages = ConvertFrom-Json ([System.IO.File]::ReadAllText($messagesPath, [System.Text.Encoding]::UTF8))
$diagnosticsRoot = Join-Path $projectPath "diagnostics"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$workPath = Join-Path $diagnosticsRoot "fleetflow-$stamp"
$archivePath = "$workPath.zip"
New-Item -ItemType Directory -Path $workPath -Force | Out-Null

(& docker compose --project-directory $projectPath --env-file $environmentPath -f $composePath ps --all 2>&1 | Out-String) | Set-Content -LiteralPath (Join-Path $workPath "containers.txt") -Encoding UTF8
(& docker compose --project-directory $projectPath --env-file $environmentPath -f $composePath logs --tail 500 2>&1 | Out-String) | Set-Content -LiteralPath (Join-Path $workPath "docker.log") -Encoding UTF8
try { (Invoke-RestMethod -Uri "http://localhost:3035/api/health" -TimeoutSec 5 | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath (Join-Path $workPath "app-health.json") -Encoding UTF8 } catch { $_.Exception.Message | Set-Content -LiteralPath (Join-Path $workPath "app-health-error.txt") -Encoding UTF8 }
try { (Invoke-RestMethod -Uri "http://127.0.0.1:17831/health" -TimeoutSec 5 | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath (Join-Path $workPath "nfc-health.json") -Encoding UTF8 } catch { $_.Exception.Message | Set-Content -LiteralPath (Join-Path $workPath "nfc-health-error.txt") -Encoding UTF8 }
Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free,Root | Format-Table -AutoSize | Out-String | Set-Content -LiteralPath (Join-Path $workPath "disk.txt") -Encoding UTF8
if (Test-Path -LiteralPath (Join-Path $projectPath "nfc-bridge\fleetflow-start.log")) { Copy-Item -LiteralPath (Join-Path $projectPath "nfc-bridge\fleetflow-start.log") -Destination $workPath }
Compress-Archive -Path (Join-Path $workPath "*") -DestinationPath $archivePath -Force
Remove-Item -LiteralPath $workPath -Recurse -Force
Get-ChildItem -LiteralPath $diagnosticsRoot -File -Filter "fleetflow-*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 10 | Remove-Item -Force
$message = $messages.diagnosticsCompleted -f $archivePath
if ($NoUi) { Write-Output $message }
else {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($message, $messages.diagnosticsTitle) | Out-Null
}
