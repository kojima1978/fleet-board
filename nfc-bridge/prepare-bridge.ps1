# Windows用起動ファイルからのみ呼ぶ。ブラウザー・状態確認・監視ループでは導入しない。
function Test-FleetFlowScannerPresent {
  $readers = @(Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object {
    $_.FriendlyName -match 'RC-S300|RC-S380|PaSoRi|QK30' -or $_.InstanceId -match 'VID_076D&PID_0006'
  })
  return $readers.Count -gt 0
}

function Test-FleetFlowNfcDriverMissing {
  param([object[]]$Devices = @(Get-PnpDevice -PresentOnly -ErrorAction Stop))
  return @($Devices | Where-Object {
    ($_.FriendlyName -match 'RC-S300|RC-S380|PaSoRi') -and ([string]$_.Problem -in @('28', 'CM_PROB_FAILED_INSTALL'))
  }).Count -gt 0
}

function Get-FleetFlowBridgeSetupPlan {
  param([string]$ProjectDirectory, [string]$InstallDirectory, [bool]$ScannerPresent)
  $installedLauncher = Join-Path $InstallDirectory 'launch.ps1'
  $installedExe = Join-Path $InstallDirectory 'FleetFlow.NfcBridge.exe'
  if ((Test-Path -LiteralPath $installedLauncher) -and (Test-Path -LiteralPath $installedExe)) {
    return [pscustomobject]@{ Action = 'StartInstalled'; Launcher = $installedLauncher }
  }
  $sourceLauncher = Join-Path $ProjectDirectory 'nfc-bridge\launch.ps1'
  if (-not $ScannerPresent) {
    return [pscustomobject]@{ Action = 'Skip'; Launcher = $sourceLauncher }
  }
  $sourceExe = Join-Path $ProjectDirectory 'nfc-bridge\dist\FleetFlow.NfcBridge.exe'
  $action = if (Test-Path -LiteralPath $sourceExe) { 'Install' } else { 'BuildAndInstall' }
  return [pscustomobject]@{ Action = $action; Launcher = $installedLauncher }
}

function Get-FleetFlowBridgeOrigins([string]$AppUrl) {
  $uri = [uri]$AppUrl
  if (-not $uri.IsAbsoluteUri -or $uri.Scheme -notin @('http', 'https')) {
    throw 'Invalid FleetFlow application URL.'
  }
  return (@('http://localhost:3035', 'http://127.0.0.1:3035', $uri.GetLeftPart([System.UriPartial]::Authority)) | Select-Object -Unique) -join ';'
}

function Initialize-FleetFlowBridge {
  param(
    [string]$ProjectDirectory,
    [string]$AppUrl,
    [scriptblock]$BuildBridge,
    [scriptblock]$InstallBridge
  )
  $installDirectory = Join-Path $env:LOCALAPPDATA 'FleetFlow\NfcBridge'
  # 導入済みならUSB未接続でも起動し、その後の差し込みを待つ。
  $plan = Get-FleetFlowBridgeSetupPlan -ProjectDirectory $ProjectDirectory -InstallDirectory $installDirectory -ScannerPresent $false
  if ($plan.Action -eq 'StartInstalled') { return $plan.Launcher }
  $plan = Get-FleetFlowBridgeSetupPlan -ProjectDirectory $ProjectDirectory -InstallDirectory $installDirectory -ScannerPresent (Test-FleetFlowScannerPresent)
  if ($plan.Action -eq 'Skip') { return $plan.Launcher }
  if ($plan.Action -eq 'BuildAndInstall') {
    Write-Host 'Preparing FleetFlow NFC/QR Bridge (first startup may take several minutes)...'
    & $BuildBridge | Out-Host
  }
  $sourceExe = Join-Path $ProjectDirectory 'nfc-bridge\dist\FleetFlow.NfcBridge.exe'
  if (-not (Test-Path -LiteralPath $sourceExe)) { throw 'NFC Bridge build did not produce FleetFlow.NfcBridge.exe.' }
  $origins = Get-FleetFlowBridgeOrigins $AppUrl
  & $InstallBridge $origins | Out-Host
  if (-not (Test-Path -LiteralPath $plan.Launcher)) { throw 'NFC Bridge installation did not produce launch.ps1.' }
  return $plan.Launcher
}
