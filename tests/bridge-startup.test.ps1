$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\nfc-bridge\prepare-bridge.ps1')

function Assert-Equal($Expected, $Actual, [string]$Message) {
  if ($Expected -ne $Actual) { throw "$Message (expected=$Expected, actual=$Actual)" }
}

$testDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('fleetflow-bridge-test-' + [guid]::NewGuid())
$previousLocalAppData = $env:LOCALAPPDATA
New-Item -ItemType Directory -Path $testDirectory | Out-Null
try {
  $project = Join-Path $testDirectory 'project with spaces'
  $env:LOCALAPPDATA = Join-Path $testDirectory 'local'
  $install = Join-Path $env:LOCALAPPDATA 'FleetFlow\NfcBridge'
  $dist = Join-Path $project 'nfc-bridge\dist'
  New-Item -ItemType Directory -Path $dist -Force | Out-Null
  New-Item -ItemType Directory -Path $install -Force | Out-Null
  $exe = Join-Path $dist 'FleetFlow.NfcBridge.exe'
  $installedExe = Join-Path $install 'FleetFlow.NfcBridge.exe'
  $launcher = Join-Path $install 'launch.ps1'

  Assert-Equal 'Skip' (Get-FleetFlowBridgeSetupPlan $project $install $false).Action 'No reader must not trigger installation'
  Assert-Equal 'BuildAndInstall' (Get-FleetFlowBridgeSetupPlan $project $install $true).Action 'Missing executable must trigger build'
  Assert-Equal 'http://localhost:3035;http://127.0.0.1:3035;http://192.168.0.246:3035' (Get-FleetFlowBridgeOrigins 'http://192.168.0.246:3035/') 'Allow exact LAN Origin'
  Assert-Equal 'http://localhost:3035;http://127.0.0.1:3035' (Get-FleetFlowBridgeOrigins 'http://localhost:3035/') 'Origins must be deduplicated'
  $invalidRejected = $false
  try { Get-FleetFlowBridgeOrigins 'file:///tmp/bridge' } catch { $invalidRejected = $true }
  Assert-Equal $true $invalidRejected 'Reject non HTTP origins'
  Assert-Equal $true (Test-FleetFlowNfcDriverMissing -Devices @([pscustomobject]@{ FriendlyName = 'RC-S380/P'; Problem = 28 })) 'Detect missing Sony driver'
  Assert-Equal $true (Test-FleetFlowNfcDriverMissing -Devices @([pscustomobject]@{ FriendlyName = 'RC-S300'; Problem = 'CM_PROB_FAILED_INSTALL' })) 'Detect named Windows problem code'
  Assert-Equal $false (Test-FleetFlowNfcDriverMissing -Devices @([pscustomobject]@{ FriendlyName = 'RC-S380/P'; Problem = 0 })) 'Do not report working reader'
  Assert-Equal $false (Test-FleetFlowNfcDriverMissing -Devices @([pscustomobject]@{ FriendlyName = 'Other USB device'; Problem = 28 })) 'Do not report unrelated USB device'
  Assert-Equal $false (Test-FleetFlowNfcDriverMissing -Devices @()) 'Do not report an absent reader'

  # USB/ビルド/インストールを代替し、実機・レジストリ・自動起動設定は変更しない。
  function Test-FleetFlowScannerPresent { return $true }
  $script:built = 0
  $script:installed = 0
  $build = { $script:built++; New-Item -ItemType File -Path $exe -Force | Out-Null }
  $installer = {
    param($origins)
    $script:installed++
    Assert-Equal 'http://localhost:3035;http://127.0.0.1:3035;http://192.168.0.246:3035' $origins 'Installer receives LAN Origin'
    New-Item -ItemType File -Path $installedExe -Force | Out-Null
    New-Item -ItemType File -Path $launcher -Force | Out-Null
    Write-Output 'Installer progress must not become the launcher path'
  }
  $actual = Initialize-FleetFlowBridge $project 'http://192.168.0.246:3035/' $build $installer
  Assert-Equal $launcher $actual 'Return only installed launcher'
  Assert-Equal 1 $script:built 'First startup builds once'
  Assert-Equal 1 $script:installed 'First startup installs once'
  $actual = Initialize-FleetFlowBridge $project 'http://192.168.0.246:3035/' { throw 'Unexpected build' } { throw 'Unexpected install' }
  Assert-Equal $launcher $actual 'Later startup reuses installation'

  Remove-Item -LiteralPath $installedExe, $launcher
  Assert-Equal 'Install' (Get-FleetFlowBridgeSetupPlan $project $install $true).Action 'Existing build must not rebuild'
  $actual = Initialize-FleetFlowBridge $project 'http://192.168.0.246:3035/' { throw 'Unexpected build' } $installer
  Assert-Equal $launcher $actual 'Existing build installs successfully'
  Remove-Item -LiteralPath $installedExe, $launcher, $exe
  $failed = $false
  try { Initialize-FleetFlowBridge $project 'http://localhost:3035/' { throw 'Simulated build failure' } { throw 'Must not install' } } catch { $failed = $_.Exception.Message -eq 'Simulated build failure' }
  Assert-Equal $true $failed 'Build failure must not proceed to installation'
  function Test-FleetFlowScannerPresent { return $false }
  $actual = Initialize-FleetFlowBridge $project 'http://localhost:3035/' { throw 'Unexpected build' } { throw 'Unexpected install' }
  Assert-Equal (Join-Path $project 'nfc-bridge\launch.ps1') $actual 'No reader preserves manual-only startup'

  # 自動起動登録は新オプションで必ず抑制される構造を検査。
  $installerSource = Get-Content (Join-Path $PSScriptRoot '..\nfc-bridge\install.ps1') -Raw
  Assert-Equal $true ($installerSource -match 'if \(-not \$SkipAutostart\)\s*\{\s*New-ItemProperty -Path \$runKey') 'SkipAutostart guards Windows startup registration'
  Write-Host 'Bridge startup tests passed: first setup, reuse, no reader, exact Origins, failure handling and no startup registration'
}
finally {
  $env:LOCALAPPDATA = $previousLocalAppData
  # 自分で作成した一意なテスト用ディレクトリだけを削除する。
  $resolved = [System.IO.Path]::GetFullPath($testDirectory)
  $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  if ($resolved.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -like 'fleetflow-bridge-test-*') {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
