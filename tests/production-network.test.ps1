$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "..\scripts\production\FleetFlow-Network.ps1")

function Assert-Equal($Expected, $Actual, [string]$Message) {
  if ($Expected -ne $Actual) { throw "$Message`nExpected: $Expected`nActual: $Actual" }
}

$testDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("fleetflow-network-test-" + [guid]::NewGuid())
$environmentPath = Join-Path $testDirectory ".env.production"
New-Item -ItemType Directory -Path $testDirectory | Out-Null
try {
  [System.IO.File]::WriteAllText($environmentPath, "FLEETFLOW_BIND_ADDRESS=127.0.0.1`nFLEETFLOW_PORT=3035`n", (New-Object System.Text.UTF8Encoding($false)))
  Assert-Equal "http://127.0.0.1:3035/api/health" (Get-FleetFlowAppUrl -EnvironmentPath $environmentPath -Path "/api/health") "ローカルURLを作成できる"
  Set-FleetFlowEnvironmentValue -Path $environmentPath -Name "FLEETFLOW_BIND_ADDRESS" -Value "192.168.10.25"
  Assert-Equal "http://192.168.10.25:3035/" (Get-FleetFlowAppUrl -EnvironmentPath $environmentPath) "LAN URLを作成できる"
  $developmentEnvironmentPath = Join-Path $testDirectory ".env"
  Assert-Equal "http://127.0.0.1:3035/" (Get-FleetFlowAppUrl -EnvironmentPath $developmentEnvironmentPath -Development) "開発設定がなくてもローカルへ接続する"
  Set-FleetFlowEnvironmentValue -Path $developmentEnvironmentPath -Name "FLEETFLOW_DEV_BIND_ADDRESS" -Value "192.168.10.26"
  Assert-Equal "http://192.168.10.26:3035/api/health" (Get-FleetFlowAppUrl -EnvironmentPath $developmentEnvironmentPath -Development -Path "/api/health") "開発LAN設定を起動確認にも使用する"
  Assert-Equal "http://192.168.10.25:3035/" (Get-FleetFlowAppUrl -EnvironmentPath $environmentPath) "開発設定で本番設定が変更されない"
  Assert-Equal "192.168.10.0/24" (Get-FleetFlowNetworkCidr -Address "192.168.10.25" -PrefixLength 24) "LAN CIDRを計算できる"
  Assert-Equal $true (Test-FleetFlowPrivateIPv4 "10.20.30.40") "プライベートIPv4を許可する"
  Assert-Equal $false (Test-FleetFlowPrivateIPv4 "8.8.8.8") "公開IPv4を拒否する"
  Assert-Equal $false (Test-FleetFlowPublicNetwork "192.0.2.1") "このPCにないアドレスはパブリック判定しない"
  Assert-Equal $true (Wait-FleetFlowLocalAddress -Address "127.0.0.1" -TimeoutSeconds 1 -IntervalSeconds 1) "割り当て済みのアドレスはすぐ使える"
  Assert-Equal $false (Wait-FleetFlowLocalAddress -Address "192.0.2.1" -TimeoutSeconds 1 -IntervalSeconds 1) "割り当てられないアドレスは時間切れにする"
  Write-Output "Production network tests passed"
}
finally {
  Remove-Item -LiteralPath $testDirectory -Recurse -Force
}
